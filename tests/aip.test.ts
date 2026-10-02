import { PrivateKey } from '@bsv/sdk'
import { protocolPushes } from '../src/record'
import { aipSignedMessage, signAip, verifyAip } from '../src/aip'
import { OP } from '@bsv/sdk'
import {
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  HASH_MODE,
  EMPTY_PREV_TXID,
  type AgentAnchorRecord
} from '../src/protocol'
import { contentHash, hashToBytes } from '../src/hash'

describe('AIP', () => {
  const identity = PrivateKey.fromRandom()
  const address = identity.toAddress('testnet')
  const record: AgentAnchorRecord = {
    protocolId: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    identityAddress: address,
    sessionId: 'sess-1',
    sequence: 1,
    prevTxid: EMPTY_PREV_TXID,
    contentHash: hashToBytes(contentHash(new Uint8Array([1, 2, 3]))),
    mode: HASH_MODE,
    nonce: new Uint8Array(0),
    ciphertext: new Uint8Array(0)
  }
  const pushes = protocolPushes(record)

  it('signs OP_RETURN plus protocol pushes plus pipe, per AIP implicit sign-all', () => {
    const message = aipSignedMessage(pushes)
    expect(message[0]).toBe(OP.OP_RETURN)
    expect(message.filter((b) => b === 0x7c).length).toBeGreaterThan(0)
    const sig = signAip(pushes, identity)
    expect(verifyAip(pushes, sig, address, 'testnet')).toBe(true)
  })

  it('rejects a different identity key', () => {
    const sig = signAip(pushes, identity)
    const other = PrivateKey.fromRandom().toAddress('testnet')
    expect(verifyAip(pushes, sig, other, 'testnet')).toBe(false)
  })
})
