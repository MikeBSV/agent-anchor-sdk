import { PrivateKey, Random } from '@bsv/sdk'
import {
  AgentAnchor,
  AgentVerifier,
  AgentWallet,
  CIPHER_MODE,
  WhatsOnChainIndexer,
  createArcBroadcaster,
  decryptPayload,
  loadChainEnv
} from '../src'

function parseDataKey(hex: string | undefined): Uint8Array {
  if (!hex) {
    return Uint8Array.from(Random(32))
  }
  const trimmed = hex.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(trimmed)) {
    throw new Error('DATA_KEY_HEX must be 64 hex characters (32 bytes)')
  }
  return Uint8Array.from(Buffer.from(trimmed, 'hex'))
}

async function main(): Promise<void> {
  const fundingWif = process.env.FUNDING_WIF
  const identityWif = process.env.IDENTITY_WIF
  const existingTxid = process.env.CIPHER_TXID
  const chain = loadChainEnv()
  const arcKey = process.env.ARC_API_KEY
  const contentText = process.env.CIPHER_TEXT ?? 'cipher demo secret'

  const indexer = new WhatsOnChainIndexer(chain.indexerBase)
  const verifier = new AgentVerifier(indexer, chain.network)

  if (existingTxid) {
    if (!process.env.DATA_KEY_HEX) {
      throw new Error('DATA_KEY_HEX is required to decrypt an existing CIPHER_TXID')
    }
    const dataKey = parseDataKey(process.env.DATA_KEY_HEX)
    const check = await verifier.verify({ txid: existingTxid })
    if (!check.ok || !check.record) {
      throw new Error(`verify failed: ${check.reason}`)
    }
    if (check.record.mode !== CIPHER_MODE) {
      throw new Error(`txid is mode ${check.record.mode}, not cipher`)
    }
    const plain = decryptPayload(check.record.ciphertext, check.record.nonce, dataKey)
    console.log('network', chain.network)
    console.log('txid', existingTxid)
    console.log('on-chain verify (AIP + ciphertext hash)', true)
    console.log('decrypted', new TextDecoder().decode(plain))
    return
  }

  if (!fundingWif || !identityWif) {
    console.error(
      'Set FUNDING_WIF and IDENTITY_WIF to broadcast a new cipher record. To decrypt an existing tx set CIPHER_TXID and DATA_KEY_HEX. Optional: NETWORK=mainnet.'
    )
    process.exit(1)
  }
  if (chain.network === 'mainnet') {
    console.warn('NETWORK=mainnet spends real BSV. Do not reuse testnet keys.')
  }

  const generatedKey = !process.env.DATA_KEY_HEX
  const dataKey = parseDataKey(process.env.DATA_KEY_HEX)
  const identity = PrivateKey.fromWif(identityWif)
  const wallet = AgentWallet.fromWif(fundingWif, indexer, { network: chain.network })
  const anchor = new AgentAnchor(wallet, identity)
  const broadcaster = createArcBroadcaster(chain.arcUrl, arcKey)
  const content = new TextEncoder().encode(contentText)

  console.log('network', chain.network)
  console.log('broadcast via', chain.arcUrl)
  console.log('funding address', wallet.address)
  console.log('identity address', identity.toAddress(chain.network))
  console.log('dataKey hex (save off-chain; the SDK does not keep it)', Buffer.from(dataKey).toString('hex'))
  if (generatedKey) {
    console.log('generated a new data key for this run (set DATA_KEY_HEX to reuse one)')
  }

  const result = await anchor.anchor(
    { sessionId: 'cipher-demo', sequence: 1, content, mode: CIPHER_MODE, dataKey },
    broadcaster
  )
  console.log('txid', result.txid)
  console.log('mode', result.record.mode)
  console.log('nonce bytes', result.record.nonce.length)
  console.log('ciphertext bytes', result.record.ciphertext.length)
  console.log('tx url', `${chain.explorerOrigin}/tx/${result.txid}`)

  const check = await verifier.verify({ txid: result.txid, expectedPrevTxid: '' })
  if (!check.ok || !check.record) {
    throw new Error(`verify failed: ${check.reason}`)
  }
  console.log('on-chain verify (AIP + ciphertext hash, not decrypt)', check.ok)

  const plain = decryptPayload(check.record.ciphertext, check.record.nonce, dataKey)
  const text = new TextDecoder().decode(plain)
  if (text !== contentText) {
    throw new Error('decrypted plaintext did not match CIPHER_TEXT')
  }
  console.log('decrypted', text)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
