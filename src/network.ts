import type { Transaction, BroadcastResponse, BroadcastFailure } from '@bsv/sdk'

export interface Utxo {
  txid: string
  outputIndex: number
  satoshis: number
}

export interface ChainIndexer {
  getUtxos(address: string): Promise<Utxo[]>
  getRawTxHex(txid: string): Promise<string>
}

export type TxBroadcaster = {
  broadcast(tx: Transaction): Promise<BroadcastResponse | BroadcastFailure>
}

export const DEFAULT_SATOSHIS_PER_KB = 1
