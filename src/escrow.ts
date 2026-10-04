import {
  Hash,
  LockingScript,
  OP,
  P2PKH,
  PrivateKey,
  PublicKey,
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
  feeSatoshis: number
}

export interface EscrowSpendResult {
  txid: string
  paidSatoshis: number
  feeSatoshis: number
}

/** JSON agents exchange for two-party complete. Fee inputs are already signed by the builder. */
export interface CompleteOffer {
  version: 1
  txHex: string
  sourceTxHexes: string[]
  buyerSigHex?: string
  sellerSigHex?: string
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

function bytesToHex(bytes: number[]): string {
  return Buffer.from(bytes).toString('hex')
}

function hexToBytes(hex: string): number[] {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('signature hex is invalid')
  }
  return [...Buffer.from(hex, 'hex')]
}

function placeholderCompleteUnlock() {
  return {
    sign: async () => new UnlockingScript(),
    estimateLength: async () => COMPLETE_UNLOCK_LEN
  }
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

export const UNIX_LOCKTIME_THRESHOLD = 500_000_000
export const DEFAULT_ESCROW_LOCK_SECONDS = 7 * 24 * 60 * 60
export const MAX_ESCROW_LOCK_SECONDS = 90 * 24 * 60 * 60

export function escrowScriptLocktime(script: LockingScript): number {
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

export function assertEscrowLocktimeNotExcessive(
  locktime: number,
  options?: { now?: number; allowLong?: boolean; maxSeconds?: number }
): void {
  if (options?.allowLong) return
  const now = options?.now ?? Math.floor(Date.now() / 1000)
  const maxSeconds = options?.maxSeconds ?? MAX_ESCROW_LOCK_SECONDS
  if (locktime >= UNIX_LOCKTIME_THRESHOLD && locktime > now + maxSeconds) {
    const days = maxSeconds / 86400
    throw new Error(
      `Escrow locktime is more than ${days} days from now. Set ESCROW_ALLOW_LONG_LOCK=1 to override.`
    )
  }
}

export function refundNLockTime(
  scriptLocktime: number,
  now = Math.floor(Date.now() / 1000)
): number {
  if (scriptLocktime >= UNIX_LOCKTIME_THRESHOLD) {
    return Math.max(scriptLocktime, now)
  }
  return scriptLocktime
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

function txFeeSatoshis(tx: Transaction): number {
  let incoming = 0
  for (const input of tx.inputs) {
    const source = input.sourceTransaction
    if (!source) {
      throw new Error('Escrow transaction is missing sourceTransaction')
    }
    incoming += source.outputs[input.sourceOutputIndex].satoshis ?? 0
  }
  const outgoing = tx.outputs.reduce((sum, output) => sum + (output.satoshis ?? 0), 0)
  return incoming - outgoing
}

async function payExactWithBuyerFee(
  buyerWallet: AgentWallet,
  tx: Transaction,
  satoshis: number,
  lockingScript: LockingScript
): Promise<void> {
  const feeCoins = await buyerWallet.selectUtxos(400)
  await buyerWallet.addFundingInputs(tx, feeCoins)
  tx.addOutput({ satoshis, lockingScript })
  buyerWallet.addChangeOutput(tx)
  await buyerWallet.applyFeeAndSign(tx)
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

function hydrateCompleteOffer(offer: CompleteOffer): Transaction {
  if (offer.version !== 1 || !offer.txHex || !Array.isArray(offer.sourceTxHexes)) {
    throw new Error('Complete offer is malformed')
  }
  const tx = Transaction.fromHex(offer.txHex)
  if (tx.inputs.length !== offer.sourceTxHexes.length) {
    throw new Error('Complete offer source txs do not match inputs')
  }
  tx.inputs.forEach((input, i) => {
    input.sourceTransaction = Transaction.fromHex(offer.sourceTxHexes[i])
  })
  return tx
}

function collectSourceHexes(tx: Transaction): string[] {
  return tx.inputs.map((input, i) => {
    if (!input.sourceTransaction) {
      throw new Error(`Complete input ${i} is missing sourceTransaction`)
    }
    return input.sourceTransaction.toHex()
  })
}

function attachCompleteUnlock(tx: Transaction, buyerSigHex: string, sellerSigHex: string): void {
  tx.inputs[0].unlockingScript = new UnlockingScript()
    .writeOpCode(OP.OP_0)
    .writeBin(hexToBytes(buyerSigHex))
    .writeBin(hexToBytes(sellerSigHex))
    .writeOpCode(OP.OP_TRUE)
}

export function inspectCompleteOffer(offer: CompleteOffer): {
  paidSatoshis: number
  sellerScriptHex: string
  feeSatoshis: number
  hasBuyerSig: boolean
  hasSellerSig: boolean
  inputCount: number
} {
  const tx = hydrateCompleteOffer(offer)
  const payout = tx.outputs[0]
  return {
    paidSatoshis: payout?.satoshis ?? 0,
    sellerScriptHex: payout?.lockingScript.toHex() ?? '',
    feeSatoshis: txFeeSatoshis(tx),
    hasBuyerSig: Boolean(offer.buyerSigHex),
    hasSellerSig: Boolean(offer.sellerSigHex),
    inputCount: tx.inputs.length
  }
}

export async function buildCompleteEscrow(args: {
  escrow: { txid: string; outputIndex: number }
  sellerAddress: string
  /** Fetches the lock tx (buyer after lock, or any indexer-backed wallet). */
  sourceWallet: AgentWallet
  /** Pays the complete fee and receives change. Buyer or seller. */
  feeWallet: AgentWallet
}): Promise<CompleteOffer> {
  const source = await loadEscrowSource(
    args.sourceWallet,
    args.escrow.txid,
    args.escrow.outputIndex
  )
  const paidSatoshis = source.outputs[args.escrow.outputIndex].satoshis ?? 0
  const tx = new Transaction()
  tx.addInput({
    sourceTransaction: source,
    sourceOutputIndex: args.escrow.outputIndex,
    unlockingScriptTemplate: placeholderCompleteUnlock(),
    sequence: 0xffffffff
  })
  await payExactWithBuyerFee(
    args.feeWallet,
    tx,
    paidSatoshis,
    new P2PKH().lock(args.sellerAddress)
  )
  return {
    version: 1,
    txHex: tx.toHex(),
    sourceTxHexes: collectSourceHexes(tx)
  }
}

export function signCompleteEscrow(
  offer: CompleteOffer,
  role: 'buyer' | 'seller',
  key: PrivateKey
): CompleteOffer {
  const tx = hydrateCompleteOffer(offer)
  const sigHex = bytesToHex(signInput(tx, 0, key))
  if (role === 'buyer') return { ...offer, buyerSigHex: sigHex }
  return { ...offer, sellerSigHex: sigHex }
}

export async function broadcastCompleteEscrow(
  wallet: AgentWallet,
  offer: CompleteOffer,
  broadcaster: TxBroadcaster
): Promise<EscrowSpendResult> {
  if (!offer.buyerSigHex || !offer.sellerSigHex) {
    throw new Error('Complete offer needs buyer and seller signatures')
  }
  const tx = hydrateCompleteOffer(offer)
  attachCompleteUnlock(tx, offer.buyerSigHex, offer.sellerSigHex)
  assertSpendValid(tx)
  const paidSatoshis = tx.outputs[0].satoshis ?? 0
  const txid = await wallet.broadcast(tx, broadcaster)
  return { txid, paidSatoshis, feeSatoshis: txFeeSatoshis(tx) }
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
  const lockedSatoshis = tx.outputs[outputIndex].satoshis ?? satoshis
  return { txid, outputIndex, satoshis: lockedSatoshis, feeSatoshis: txFeeSatoshis(tx) }
}

export async function completeEscrow(
  buyerWallet: AgentWallet,
  buyerKey: PrivateKey,
  sellerKey: PrivateKey,
  escrow: { txid: string; outputIndex: number },
  sellerAddress: string,
  broadcaster: TxBroadcaster
): Promise<EscrowSpendResult> {
  let offer = await buildCompleteEscrow({
    escrow,
    sellerAddress,
    sourceWallet: buyerWallet,
    feeWallet: buyerWallet
  })
  offer = signCompleteEscrow(offer, 'buyer', buyerKey)
  offer = signCompleteEscrow(offer, 'seller', sellerKey)
  return broadcastCompleteEscrow(buyerWallet, offer, broadcaster)
}

export async function refundEscrow(
  buyerWallet: AgentWallet,
  escrow: { txid: string; outputIndex: number },
  locktime: number,
  broadcaster: TxBroadcaster
): Promise<EscrowSpendResult> {
  const source = await loadEscrowSource(buyerWallet, escrow.txid, escrow.outputIndex)
  const requiredLocktime = escrowScriptLocktime(source.outputs[escrow.outputIndex].lockingScript)
  if (locktime < requiredLocktime) {
    throw new Error(
      `Refund nLockTime ${locktime} is before script locktime ${requiredLocktime}`
    )
  }
  const paidSatoshis = source.outputs[escrow.outputIndex].satoshis ?? 0
  const tx = new Transaction()
  tx.lockTime = locktime
  tx.addInput({
    sourceTransaction: source,
    sourceOutputIndex: escrow.outputIndex,
    unlockingScriptTemplate: refundUnlockTemplate(buyerWallet.fundingKey),
    sequence: REFUND_SEQUENCE
  })
  await payExactWithBuyerFee(
    buyerWallet,
    tx,
    paidSatoshis,
    new P2PKH().lock(buyerWallet.address)
  )
  assertSpendValid(tx)
  const txid = await buyerWallet.broadcast(tx, broadcaster)
  return { txid, paidSatoshis, feeSatoshis: txFeeSatoshis(tx) }
}
