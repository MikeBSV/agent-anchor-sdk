import { ARC, type Transaction } from '@bsv/sdk'
import type { ChainIndexer, TxBroadcaster, Utxo } from './network'
import { DEFAULT_INDEXER_BASE_URL } from './protocol'

interface WoCUnspent {
  tx_hash?: string
  tx_pos?: number
  value?: number
  txid?: string
  outputIndex?: number
  satoshis?: number
}

function asList(data: unknown): WoCUnspent[] {
  if (Array.isArray(data)) return data as WoCUnspent[]
  if (data && typeof data === 'object' && Array.isArray((data as { result?: unknown }).result)) {
    return (data as { result: WoCUnspent[] }).result
  }
  throw new Error('Unexpected UTXO response from indexer')
}

export class WhatsOnChainIndexer implements ChainIndexer {
  constructor(private readonly baseUrl: string = DEFAULT_INDEXER_BASE_URL) {}

  async getUtxos(address: string): Promise<Utxo[]> {
    const response = await fetch(`${this.baseUrl}/address/${encodeURIComponent(address)}/unspent/all`)
    if (!response.ok) {
      throw new Error(`Indexer UTXO fetch failed: ${response.status} ${response.statusText}`)
    }
    const rows = asList(await response.json())
    return rows.map((item) => ({
      txid: item.tx_hash ?? item.txid ?? '',
      outputIndex: item.tx_pos ?? item.outputIndex ?? 0,
      satoshis: item.value ?? item.satoshis ?? 0
    }))
  }

  async getRawTxHex(txid: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/tx/${txid}/hex`)
    if (!response.ok) {
      throw new Error(`Indexer raw tx fetch failed: ${response.status} ${response.statusText}`)
    }
    return (await response.text()).trim()
  }
}

export function createArcBroadcaster(url: string, apiKey?: string): TxBroadcaster {
  const arc = apiKey ? new ARC(url, apiKey) : new ARC(url)
  return {
    broadcast: (tx: Transaction) => arc.broadcast(tx)
  }
}
