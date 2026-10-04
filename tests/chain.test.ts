import { parseBsvNetwork } from '../src/network'
import {
  DEFAULT_MAINNET_ARC_URL,
  DEFAULT_TESTNET_ARC_URL,
  defaultArcUrl,
  loadChainEnv
} from '../src/indexer'
import { DEFAULT_INDEXER_BASE_URL, DEFAULT_MAINNET_INDEXER_BASE_URL } from '../src/protocol'

describe('chain env', () => {
  it('defaults to testnet', () => {
    expect(parseBsvNetwork()).toBe('testnet')
    expect(parseBsvNetwork('')).toBe('testnet')
    expect(parseBsvNetwork('TEST')).toBe('testnet')
    expect(loadChainEnv({})).toMatchObject({
      network: 'testnet',
      arcUrl: DEFAULT_TESTNET_ARC_URL,
      indexerBase: DEFAULT_INDEXER_BASE_URL,
      explorerOrigin: 'https://test.whatsonchain.com',
      wocBroadcast: 'test'
    })
  })

  it('selects mainnet ARC and indexer', () => {
    expect(parseBsvNetwork('mainnet')).toBe('mainnet')
    expect(defaultArcUrl('mainnet')).toBe(DEFAULT_MAINNET_ARC_URL)
    expect(loadChainEnv({ NETWORK: 'main' })).toMatchObject({
      network: 'mainnet',
      arcUrl: DEFAULT_MAINNET_ARC_URL,
      indexerBase: DEFAULT_MAINNET_INDEXER_BASE_URL,
      explorerOrigin: 'https://whatsonchain.com',
      wocBroadcast: 'main'
    })
  })

  it('rejects an unknown NETWORK', () => {
    expect(() => parseBsvNetwork('regtest')).toThrow(/testnet or mainnet/)
  })
})
