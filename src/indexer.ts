import { ARC, WhatsOnChainBroadcaster, isBroadcastFailure, type Transaction } from '@bsv/sdk'
import type { BsvNetwork, ChainIndexer, TxBroadcaster, Utxo } from './network'
import { parseBsvNetwork } from './network'
import { DEFAULT_INDEXER_BASE_URL, DEFAULT_MAINNET_INDEXER_BASE_URL } from './protocol'

interface WoCUnspent {
  tx_hash?: string
  tx_pos?: number
  value?: number
  txid?: string
  outputIndex?: number
  satoshis?: number
  height?: number
  status?: string
}

function asList(data: unknown): WoCUnspent[] {
  if (Array.isArray(data)) return data as WoCUnspent[]
  if (data && typeof data === 'object' && Array.isArray((data as { result?: unknown }).result)) {
    return (data as { result: WoCUnspent[] }).result
  }
  throw new Error('Unexpected UTXO response from indexer')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class WhatsOnChainIndexer implements ChainIndexer {
  constructor(private readonly baseUrl: string = DEFAULT_INDEXER_BASE_URL) {}

  async getUtxos(address: string): Promise<Utxo[]> {
    const response = await fetch(`${this.baseUrl}/address/${encodeURIComponent(address)}/unspent/all`)
    if (!response.ok) {
      throw new Error(`Indexer UTXO fetch failed: ${response.status} ${response.statusText}`)
    }
    const rows = asList(await response.json())
    const byOutpoint = new Map<string, Utxo>()
    for (const item of rows) {
      const txid = item.tx_hash ?? item.txid ?? ''
      if (!txid) continue
      const outputIndex = item.tx_pos ?? item.outputIndex ?? 0
      const confirmed = item.status === 'confirmed' || (typeof item.height === 'number' && item.height > 0)
      const key = `${txid}:${outputIndex}`
      if (!byOutpoint.has(key) || confirmed) {
        byOutpoint.set(key, {
          txid,
          outputIndex,
          satoshis: item.value ?? item.satoshis ?? 0
        })
      }
    }
    return [...byOutpoint.values()]
  }

  async getRawTxHex(txid: string): Promise<string> {
    const url = `${this.baseUrl}/tx/${txid}/hex`
    let lastStatus = ''
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await fetch(url)
      if (response.ok) {
        return (await response.text()).trim()
      }
      lastStatus = `${response.status} ${response.statusText}`
      if (response.status !== 404) {
        throw new Error(`Indexer raw tx fetch failed: ${lastStatus}`)
      }
      await sleep(1500)
    }
    throw new Error(`Indexer raw tx fetch failed: ${lastStatus}`)
  }
}

/** Base URL only. @bsv/sdk posts to `{url}/v1/tx`. Do not append `/v1`. */
export const DEFAULT_TESTNET_ARC_URL = 'https://testnet.arc.gorillapool.io'

export const DEFAULT_MAINNET_ARC_URL = 'https://arc.gorillapool.io'

export function defaultArcUrl(network: BsvNetwork): string {
  return network === 'mainnet' ? DEFAULT_MAINNET_ARC_URL : DEFAULT_TESTNET_ARC_URL
}

export function defaultIndexerBaseUrl(network: BsvNetwork): string {
  return network === 'mainnet' ? DEFAULT_MAINNET_INDEXER_BASE_URL : DEFAULT_INDEXER_BASE_URL
}

export function explorerOrigin(network: BsvNetwork): string {
  return network === 'mainnet' ? 'https://whatsonchain.com' : 'https://test.whatsonchain.com'
}

export function loadChainEnv(env: NodeJS.ProcessEnv = process.env): {
  network: BsvNetwork
  arcUrl: string
  indexerBase: string
  explorerOrigin: string
  wocBroadcast: 'main' | 'test'
} {
  const network = parseBsvNetwork(env.NETWORK)
  return {
    network,
    arcUrl: env.ARC_URL ?? defaultArcUrl(network),
    indexerBase: env.INDEXER_BASE_URL ?? defaultIndexerBaseUrl(network),
    explorerOrigin: explorerOrigin(network),
    wocBroadcast: network === 'mainnet' ? 'main' : 'test'
  }
}

export function createArcBroadcaster(url: string, apiKey?: string): TxBroadcaster {
  const arc = apiKey ? new ARC(url, apiKey) : new ARC(url)
  return {
    async broadcast(tx: Transaction) {
      const result = await arc.broadcast(tx)
      if (
        isBroadcastFailure(result) &&
        result.code === 'ERR_INVALID_RESPONSE' &&
        /competing/i.test(result.description)
      ) {
        return {
          status: 'success',
          txid: tx.id('hex'),
          message: 'ARC accepted the tx; competingTxs field was ignored'
        }
      }
      return result
    }
  }
}

/** No API key. Useful if an ARC host is down. */
export function createWhatsOnChainBroadcaster(network: 'main' | 'test' = 'test'): TxBroadcaster {
  const woc = new WhatsOnChainBroadcaster(network)
  return {
    broadcast: (tx: Transaction) => woc.broadcast(tx)
  }
}
