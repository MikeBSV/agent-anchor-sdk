import { readFileSync } from 'fs'
import { join } from 'path'
import {
  AIP_ALGORITHM,
  AIP_PREFIX,
  AIP_SEPARATOR,
  CIPHER_MODE,
  EMPTY_PREV_TXID,
  HASH_MODE,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  RECORD_FIELD_ORDER
} from '../src/protocol'

const protocolMd = readFileSync(join(__dirname, '..', 'PROTOCOL.md'), 'utf8')

describe('protocol constants', () => {
  it('match PROTOCOL.md', () => {
    expect(PROTOCOL_ID).toBe('AGENTANCHOR')
    expect(PROTOCOL_VERSION).toBe('1')
    expect(AIP_PREFIX).toBe('15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva')
    expect(AIP_ALGORITHM).toBe('BITCOIN_ECDSA')
    expect(AIP_SEPARATOR).toBe('|')
    expect(HASH_MODE).toBe('hash')
    expect(CIPHER_MODE).toBe('cipher')
    expect(EMPTY_PREV_TXID).toBe('')
    expect(protocolMd).toContain('`AGENTANCHOR`')
    expect(protocolMd).toContain('`15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva`')
    expect(protocolMd).toContain('`BITCOIN_ECDSA`')
    expect(protocolMd).toContain('The signature covers every push **before** `|`')
  })

  it('lists record fields in wire order', () => {
    expect(RECORD_FIELD_ORDER).toEqual([
      'protocolId',
      'version',
      'identityAddress',
      'sessionId',
      'sequence',
      'prevTxid',
      'contentHash',
      'mode',
      'nonce',
      'ciphertext'
    ])
    expect(protocolMd).toContain('Identity address')
    expect(protocolMd).toContain('zero-length')
  })
})
