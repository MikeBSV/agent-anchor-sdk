import {
  Hash,
  LockingScript,
  OP,
  P2PKH,
  PrivateKey,
  PublicKey,
  SatoshisPerKilobyte,
  Spend,
  Transaction,
  TransactionSignature,
  UnlockingScript
} from '@bsv/sdk'
import { AgentWallet } from './wallet'
import type { TxBroadcaster } from './network'

const COMPLETE_UNLOCK_LEN = 160
const REFUND_UNLOCK_LEN = 80
const REFUND_SEQUENCE = 0xfffffffe

export interface EscrowLockResult {
  txid: string
  outputIndex: number
  satoshis: number
}

function compressedPub(key: PublicKey): number[] {
  return key.encode(true) as number[]
}

function signInput(tx: Transaction, inputIndex: number, key: PrivateKey): number[] {
  const input = tx.inputs[inputIndex]
  const source = input.sourceTransaction
  if (!source) {
    throw new Error('Escrow input needs sourceTransaction')
  }
  const sourceOutput = source.outputs[input.sourceOutputIndex]
  const scope = TransactionSignature.SIGHASH_FORKID | TransactionSignature.SIGHASH_ALL
  const preimage = TransactionSignature.format({
    sourceTXID: source.id('hex'),
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: sourceOutput.satoshis ?? 0,
    transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, i) => i !== inputIndex),
    allInputs: tx.inputs,
    outputs: tx.outputs,
    inputIndex,
    subscript: sourceOutput.lockingScript,
    inputSequence: input.sequence ?? 0xffffffff,
    lockTime: tx.lockTime,
    scope
  })
  const raw = key.sign(Hash.sha256(preimage))
  return new TransactionSignature(raw.r, raw.s, scope).toChecksigFormat()
}

export function buildEscrowScript(
  buyerPub: PublicKey,
  sellerPub: PublicKey,
  locktime: number
): LockingScript {
  if (!Number.isInteger(locktime) || locktime < 0) {
    throw new Error('locktime must be a non-negative integer')
  }
  const buyer = compressedPub(buyerPub)
  const seller = compressedPub(sellerPub)
  return new LockingScript()
    .writeOpCode(OP.OP_IF)
    .writeOpCode(OP.OP_2)
    .writeBin(buyer)
    .writeBin(seller)
    .writeOpCode(OP.OP_2)
    .writeOpCode(OP.OP_CHECKMULTISIG)
    .writeOpCode(OP.OP_ELSE)
    .writeNumber(locktime)
    .writeOpCode(OP.OP_CHECKLOCKTIMEVERIFY)
    .writeOpCode(OP.OP_DROP)
    .writeBin(buyer)
    .writeOpCode(OP.OP_CHECKSIG)
    .writeOpCode(OP.OP_ENDIF) as LockingScript
}

function completeUnlockTemplate(buyerKey: PrivateKey, sellerKey: PrivateKey) {
  return {
    sign: async (tx: Transaction, inputIndex: number) => {
      const buyerSig = signInput(tx, inputIndex, buyerKey)
      const sellerSig = signInput(tx, inputIndex, sellerKey)
      return new UnlockingScript()
        .writeOpCode(OP.OP_0)
        .writeBin(buyerSig)
        .writeBin(sellerSig)
        .writeOpCode(OP.OP_TRUE)
    },
    estimateLength: async () => COMPLETE_UNLOCK_LEN
  }
}

function refundUnlockTemplate(buyerKey: PrivateKey) {
  return {
    sign: async (tx: Transaction, inputIndex: number) => {
      const buyerSig = signInput(tx, inputIndex, buyerKey)
      return new UnlockingScript().writeBin(buyerSig).writeOpCode(OP.OP_FALSE)
    },
    estimateLength: async () => REFUND_UNLOCK_LEN
  }
}

function decodeScriptNumber(bytes: number[]): number {
  if (!bytes.length) return 0
  let n = 0
  for (let i = 0; i < bytes.length; i++) {
    n += bytes[i] * 256 ** i
  }
  if (bytes[bytes.length - 1] & 0x80) {
    n -= 128 * 256 ** (bytes.length - 1)
    n = -n
  }
  return n
}

function scriptLocktime(script: LockingScript): number {
  const elseIndex = script.chunks.findIndex((chunk) => chunk.op === OP.OP_ELSE)
  const lockChunk = script.chunks[elseIndex + 1]
  if (elseIndex < 0 || !lockChunk) {
    throw new Error('Escrow script is missing a locktime')
  }
  if (lockChunk.data && lockChunk.data.length > 0) {
    return decodeScriptNumber(lockChunk.data)
  }
  if (lockChunk.op === OP.OP_0) return 0
  if (lockChunk.op >= OP.OP_1 && lockChunk.op <= OP.OP_16) {
    return lockChunk.op - OP.OP_1 + 1
  }
  throw new Error('Escrow script locktime is not a script number')
}

function assertSpendValid(tx: Transaction, inputIndex = 0): void {
  const input = tx.inputs[inputIndex]
  const source = input.sourceTransaction
  if (!source || !input.unlockingScript) {
    throw new Error('Escrow spend is missing source transaction or unlocking script')
  }
  const sourceOutput = source.outputs[input.sourceOutputIndex]
  const spend = new Spend({
    sourceTXID: source.id('hex'),
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: sourceOutput.satoshis ?? 0,
    lockingScript: sourceOutput.lockingScript,
    transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, i) => i !== inputIndex),
    allInputs: tx.inputs,
    outputs: tx.outputs,
    unlockingScript: input.unlockingScript,
    inputSequence: input.sequence ?? 0xffffffff,
    inputIndex,
    lockTime: tx.lockTime
  })
  spend.validate()
}

async function loadEscrowSource(
  wallet: AgentWallet,
  escrowTxid: string,
  escrowOutputIndex: number
): Promise<Transaction> {
  const hex = await wallet.getRawTxHex(escrowTxid)
  const source = Transaction.fromHex(hex)
  if (!source.outputs[escrowOutputIndex]) {
    throw new Error(`No escrow output at index ${escrowOutputIndex}`)
  }
  return source
}

export async function lockEscrow(
  buyerWallet: AgentWallet,
  sellerPub: PublicKey,
  satoshis: number,
  locktime: number,
  broadcaster: TxBroadcaster
): Promise<EscrowLockResult> {
  if (!Number.isInteger(satoshis) || satoshis <= 0) {
    throw new Error('escrow satoshis must be a positive integer')
  }
  const script = buildEscrowScript(buyerWallet.fundingKey.toPublicKey(), sellerPub, locktime)
  const selected = await buyerWallet.selectUtxos(satoshis + 400)
  const tx = new Transaction()
  await buyerWallet.addFundingInputs(tx, selected)
  tx.addOutput({ satoshis, lockingScript: script })
  buyerWallet.addChangeOutput(tx)
  await buyerWallet.applyFeeAndSign(tx)
  const txid = await buyerWallet.broadcast(tx, broadcaster)
  const outputIndex = tx.outputs.findIndex((o) => o.lockingScript.toHex() === script.toHex())
  if (outputIndex < 0) {
    throw new Error('Escrow output missing after lock')
  }
  return { txid, outputIndex, satoshis: tx.outputs[outputIndex].satoshis ?? satoshis }
}

export async function completeEscrow(
  buyerWallet: AgentWallet,
  buyerKey: PrivateKey,
  sellerKey: PrivateKey,
  escrow: { txid: string; outputIndex: number },
  sellerAddress: string,
  broadcaster: TxBroadcaster
): Promise<string> {
  const source = await loadEscrowSource(buyerWallet, escrow.txid, escrow.outputIndex)
  const tx = new Transaction()
  tx.addInput({
    sourceTransaction: source,
    sourceOutputIndex: escrow.outputIndex,
    unlockingScriptTemplate: completeUnlockTemplate(buyerKey, sellerKey),
    sequence: 0xffffffff
  })
  tx.addOutput({
    lockingScript: new P2PKH().lock(sellerAddress),
    change: true
  })
  await tx.fee(new SatoshisPerKilobyte(buyerWallet.satoshisPerKb))
  await tx.sign()
  assertSpendValid(tx)
  return buyerWallet.broadcast(tx, broadcaster)
}

export async function refundEscrow(
  buyerWallet: AgentWallet,
  escrow: { txid: string; outputIndex: number },
  locktime: number,
  broadcaster: TxBroadcaster
): Promise<string> {
  const source = await loadEscrowSource(buyerWallet, escrow.txid, escrow.outputIndex)
  const requiredLocktime = scriptLocktime(source.outputs[escrow.outputIndex].lockingScript)
  if (locktime < requiredLocktime) {
    throw new Error(
      `Refund nLockTime ${locktime} is before script locktime ${requiredLocktime}`
    )
  }
  const tx = new Transaction()
  tx.lockTime = locktime
  tx.addInput({
    sourceTransaction: source,
    sourceOutputIndex: escrow.outputIndex,
    unlockingScriptTemplate: refundUnlockTemplate(buyerWallet.fundingKey),
    sequence: REFUND_SEQUENCE
  })
  tx.addOutput({
    lockingScript: new P2PKH().lock(buyerWallet.address),
    change: true
  })
  await tx.fee(new SatoshisPerKilobyte(buyerWallet.satoshisPerKb))
  await tx.sign()
  assertSpendValid(tx)
  return buyerWallet.broadcast(tx, broadcaster)
}
