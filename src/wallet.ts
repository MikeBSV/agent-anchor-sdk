import {
  P2PKH,
  PrivateKey,
  SatoshisPerKilobyte,
  Transaction,
  isBroadcastFailure
} from '@bsv/sdk'
import { DEFAULT_SATOSHIS_PER_KB, type ChainIndexer, type TxBroadcaster, type Utxo } from './network'

export type NetworkName = 'testnet' | 'mainnet'

function outpointKey(txid: string, outputIndex: number): string {
  return `${txid}:${outputIndex}`
}

export class AgentWallet {
  readonly fundingKey: PrivateKey
  readonly network: NetworkName
  readonly satoshisPerKb: number
  private readonly spent = new Set<string>()
  private readonly localUtxos = new Map<string, Utxo>()
  private readonly localTxHex = new Map<string, string>()

  constructor(
    fundingKey: PrivateKey,
    private readonly indexer: ChainIndexer,
    options?: { network?: NetworkName; satoshisPerKb?: number }
  ) {
    this.fundingKey = fundingKey
    this.network = options?.network ?? 'testnet'
    this.satoshisPerKb = options?.satoshisPerKb ?? DEFAULT_SATOSHIS_PER_KB
  }

  static fromWif(
    wif: string,
    indexer: ChainIndexer,
    options?: { network?: NetworkName; satoshisPerKb?: number }
  ): AgentWallet {
    return new AgentWallet(PrivateKey.fromWif(wif), indexer, options)
  }

  static fromRandom(
    indexer: ChainIndexer,
    options?: { network?: NetworkName; satoshisPerKb?: number }
  ): AgentWallet {
    return new AgentWallet(PrivateKey.fromRandom(), indexer, options)
  }

  get address(): string {
    return this.fundingKey.toAddress(this.network)
  }

  private get p2pkhHex(): string {
    return new P2PKH().lock(this.address).toHex()
  }

  async listUtxos(): Promise<Utxo[]> {
    const remote = await this.indexer.getUtxos(this.address)
    const merged = new Map<string, Utxo>()
    for (const utxo of remote) {
      const key = outpointKey(utxo.txid, utxo.outputIndex)
      if (!this.spent.has(key)) merged.set(key, utxo)
    }
    for (const [key, utxo] of this.localUtxos) {
      if (!this.spent.has(key)) merged.set(key, utxo)
    }
    return [...merged.values()]
  }

  async selectUtxos(neededSatoshis: number): Promise<Utxo[]> {
    const utxos = await this.listUtxos()
    const selected: Utxo[] = []
    let total = 0
    for (const utxo of utxos) {
      selected.push(utxo)
      total += utxo.satoshis
      if (total >= neededSatoshis) return selected
    }
    throw new Error(
      `Insufficient funds: have ${total} satoshis, need ${neededSatoshis}. Fund ${this.address}`
    )
  }

  async getRawTxHex(txid: string): Promise<string> {
    return this.localTxHex.get(txid) ?? this.indexer.getRawTxHex(txid)
  }

  async addFundingInputs(tx: Transaction, selected: Utxo[]): Promise<void> {
    for (const utxo of selected) {
      const hex = this.localTxHex.get(utxo.txid) ?? (await this.indexer.getRawTxHex(utxo.txid))
      tx.addInput({
        sourceTransaction: Transaction.fromHex(hex),
        sourceOutputIndex: utxo.outputIndex,
        unlockingScriptTemplate: new P2PKH().unlock(this.fundingKey),
        sequence: 0xffffffff
      })
    }
  }

  addChangeOutput(tx: Transaction): void {
    tx.addOutput({
      lockingScript: new P2PKH().lock(this.address),
      change: true
    })
  }

  async applyFeeAndSign(tx: Transaction): Promise<void> {
    await tx.fee(new SatoshisPerKilobyte(this.satoshisPerKb))
    await tx.sign()
  }

  async payP2pkh(
    recipientAddress: string,
    satoshis: number,
    broadcaster: TxBroadcaster
  ): Promise<string> {
    const selected = await this.selectUtxos(satoshis + 400)
    const tx = new Transaction()
    await this.addFundingInputs(tx, selected)
    tx.addOutput({
      satoshis,
      lockingScript: new P2PKH().lock(recipientAddress)
    })
    this.addChangeOutput(tx)
    await this.applyFeeAndSign(tx)
    return this.broadcast(tx, broadcaster)
  }

  async broadcast(tx: Transaction, broadcaster: TxBroadcaster): Promise<string> {
    const result = await broadcaster.broadcast(tx)
    if (isBroadcastFailure(result)) {
      throw new Error(`Broadcast failed: ${result.code} ${result.description}`)
    }
    this.noteBroadcast(tx, result.txid)
    return result.txid
  }

  /** Remember spends and change so the next tx does not wait on a stale indexer. */
  private noteBroadcast(tx: Transaction, txid: string): void {
    this.localTxHex.set(txid, tx.toHex())
    for (const input of tx.inputs) {
      const sourceId =
        input.sourceTXID ??
        (input.sourceTransaction ? input.sourceTransaction.id('hex') : undefined)
      if (sourceId === undefined) continue
      const key = outpointKey(sourceId, input.sourceOutputIndex)
      this.spent.add(key)
      this.localUtxos.delete(key)
    }
    const ours = this.p2pkhHex
    tx.outputs.forEach((output, outputIndex) => {
      if (!output.satoshis || output.satoshis <= 0) return
      if (output.lockingScript.toHex() !== ours) return
      const key = outpointKey(txid, outputIndex)
      this.localUtxos.set(key, { txid, outputIndex, satoshis: output.satoshis })
    })
  }
}
