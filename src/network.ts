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

export type BsvNetwork = 'testnet' | 'mainnet'

export function parseBsvNetwork(raw?: string): BsvNetwork {
  const v = (raw ?? 'testnet').trim().toLowerCase()
  if (v === '' || v === 'test' || v === 'testnet') return 'testnet'
  if (v === 'main' || v === 'mainnet') return 'mainnet'
  throw new Error('NETWORK must be testnet or mainnet')
}
