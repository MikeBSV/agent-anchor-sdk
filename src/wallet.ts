import {
  P2PKH,
  PrivateKey,
  SatoshisPerKilobyte,
  Transaction,
  isBroadcastFailure
} from '@bsv/sdk'
import { DEFAULT_SATOSHIS_PER_KB, type ChainIndexer, type TxBroadcaster, type Utxo } from './network'

export type NetworkName = 'testnet' | 'mainnet'

export class AgentWallet {
  readonly fundingKey: PrivateKey
  readonly network: NetworkName
  readonly satoshisPerKb: number

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

  async listUtxos(): Promise<Utxo[]> {
    return this.indexer.getUtxos(this.address)
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

  async addFundingInputs(tx: Transaction, selected: Utxo[]): Promise<void> {
    for (const utxo of selected) {
      const hex = await this.indexer.getRawTxHex(utxo.txid)
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
    return result.txid
  }
}
