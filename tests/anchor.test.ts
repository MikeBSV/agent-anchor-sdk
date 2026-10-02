import { OP, Transaction } from '@bsv/sdk'
import { AgentAnchor } from '../src/anchor'
import { AgentVerifier } from '../src/verify'
import { HASH_MODE } from '../src/protocol'
import { fundedWallet, MemoryBroadcaster } from './helpers'
import { encryptPayload, decryptPayload } from '../src/encrypt'
import { Random } from '@bsv/sdk'

describe('anchor and verify', () => {
  it('anchors a hash-mode record and verifies the plaintext', async () => {
    const { wallet, indexer, identityKey } = fundedWallet()
    const anchor = new AgentAnchor(wallet, identityKey)
    const broadcaster = new MemoryBroadcaster()
    const plaintext = new TextEncoder().encode('agent step one')
    const first = await anchor.anchor(
      { sessionId: 's1', sequence: 1, content: plaintext, mode: HASH_MODE },
      broadcaster
    )
    expect(first.txid).toHaveLength(64)
    indexer.txs.set(first.txid, broadcaster.lastTx!.toHex())
    indexer.utxos = [
      {
        txid: first.txid,
        outputIndex: broadcaster.lastTx!.outputs.findIndex((o) => (o.satoshis ?? 0) > 0),
        satoshis: broadcaster.lastTx!.outputs.find((o) => (o.satoshis ?? 0) > 0)!.satoshis!
      }
    ]

    const verifier = new AgentVerifier(indexer, 'testnet')
    const ok = await verifier.verify({
      txid: first.txid,
      plaintext,
      expectedPrevTxid: ''
    })
    expect(ok.reason ?? 'ok').toBe('ok')
    expect(ok.ok).toBe(true)
    expect(ok.record?.sequence).toBe(1)

    const tampered = await verifier.verify({
      txid: first.txid,
      plaintext: new TextEncoder().encode('lied'),
      expectedPrevTxid: ''
    })
    expect(tampered.ok).toBe(false)
    expect(tampered.reason).toMatch(/hash mismatch/)
  })

  it('chains prevTxid on a second record', async () => {
    const { wallet, indexer, identityKey } = fundedWallet()
    const anchor = new AgentAnchor(wallet, identityKey)
    const broadcaster = new MemoryBroadcaster()
    const a = new TextEncoder().encode('a')
    const first = await anchor.anchor({ sessionId: 's1', sequence: 1, content: a }, broadcaster)
    indexer.txs.set(first.txid, broadcaster.lastTx!.toHex())
    const change = broadcaster.lastTx!.outputs.find((o) => (o.satoshis ?? 0) > 0)!
    indexer.utxos = [
      {
        txid: first.txid,
        outputIndex: broadcaster.lastTx!.outputs.indexOf(change),
        satoshis: change.satoshis!
      }
    ]
    const b = new TextEncoder().encode('b')
    const second = await anchor.anchor(
      { sessionId: 's1', sequence: 2, prevTxid: first.txid, content: b },
      broadcaster
    )
    indexer.txs.set(second.txid, broadcaster.lastTx!.toHex())
    const verifier = new AgentVerifier(indexer, 'testnet')
    const ok = await verifier.verify({
      txid: second.txid,
      plaintext: b,
      expectedPrevTxid: first.txid
    })
    expect(ok.ok).toBe(true)
    const wrongParent = await verifier.verify({
      txid: second.txid,
      plaintext: b,
      expectedPrevTxid: 'ab'.repeat(32)
    })
    expect(wrongParent.ok).toBe(false)
  })

  it('fails if the OP_RETURN identity signature does not match', async () => {
    const { wallet, indexer, identityKey } = fundedWallet()
    const anchor = new AgentAnchor(wallet, identityKey)
    const broadcaster = new MemoryBroadcaster()
    const plaintext = new TextEncoder().encode('sig check')
    const result = await anchor.anchor({ sessionId: 's1', sequence: 1, content: plaintext }, broadcaster)
    const tx = Transaction.fromHex(broadcaster.lastTx!.toHex())
    const out = tx.outputs.find((o) => o.lockingScript.chunks.some((c) => c.op === OP.OP_RETURN))!
    const lastPush = out.lockingScript.chunks[out.lockingScript.chunks.length - 1]
    if (lastPush.data && lastPush.data.length > 0) {
      lastPush.data[0] = (lastPush.data[0] + 1) % 256
    }
    indexer.txs.set(result.txid, tx.toHex())
    const verifier = new AgentVerifier(indexer, 'testnet')
    const check = await verifier.verify({ txid: result.txid, plaintext })
    expect(check.ok).toBe(false)
  })
})

describe('encryption', () => {
  it('round-trips AES-256-GCM with a separate data key', () => {
    const dataKey = Uint8Array.from(Random(32))
    const plaintext = new TextEncoder().encode('secret memory')
    const { nonce, ciphertext } = encryptPayload(plaintext, dataKey)
    expect(nonce).toHaveLength(12)
    const decoded = decryptPayload(ciphertext, nonce, dataKey)
    expect(Buffer.from(decoded)).toEqual(Buffer.from(plaintext))
  })
})
