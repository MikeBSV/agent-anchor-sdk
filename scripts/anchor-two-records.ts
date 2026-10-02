import {
  AgentAnchor,
  AgentVerifier,
  AgentWallet,
  WhatsOnChainIndexer,
  createArcBroadcaster,
  createWhatsOnChainBroadcaster,
  DEFAULT_TESTNET_ARC_URL,
  HASH_MODE
} from '../src'
import { PrivateKey } from '@bsv/sdk'

async function main(): Promise<void> {
  const fundingWif = process.env.FUNDING_WIF
  const identityWif = process.env.IDENTITY_WIF
  const arcUrl = process.env.ARC_URL ?? DEFAULT_TESTNET_ARC_URL
  const arcKey = process.env.ARC_API_KEY
  const indexerBase = process.env.INDEXER_BASE_URL ?? 'https://api.whatsonchain.com/v1/bsv/test'
  const useWoc = (process.env.BROADCAST ?? 'arc').toLowerCase() === 'woc'

  if (!fundingWif || !identityWif) {
    console.error('Set FUNDING_WIF and IDENTITY_WIF. Optional: ARC_URL, ARC_API_KEY, BROADCAST=woc.')
    process.exit(1)
  }

  const indexer = new WhatsOnChainIndexer(indexerBase)
  const wallet = AgentWallet.fromWif(fundingWif, indexer, { network: 'testnet' })
  const identity = PrivateKey.fromWif(identityWif)
  const anchor = new AgentAnchor(wallet, identity)
  const broadcaster = useWoc
    ? createWhatsOnChainBroadcaster('test')
    : createArcBroadcaster(arcUrl, arcKey)
  console.log('broadcast via', useWoc ? 'WhatsOnChain testnet' : arcUrl)
  const verifier = new AgentVerifier(indexer, 'testnet')

  console.log('funding address', wallet.address)
  console.log('identity address', identity.toAddress('testnet'))

  const step1 = new TextEncoder().encode('agent-anchor example step 1')
  const first = await anchor.anchor(
    { sessionId: 'example', sequence: 1, content: step1, mode: HASH_MODE },
    broadcaster
  )
  console.log('first txid', first.txid)

  const check1 = await verifier.verify({
    txid: first.txid,
    plaintext: step1,
    expectedPrevTxid: ''
  })
  if (!check1.ok) {
    throw new Error(`first verify failed: ${check1.reason}`)
  }

  const step2 = new TextEncoder().encode('agent-anchor example step 2')
  const second = await anchor.anchor(
    {
      sessionId: 'example',
      sequence: 2,
      prevTxid: first.txid,
      content: step2,
      mode: HASH_MODE
    },
    broadcaster
  )
  console.log('second txid', second.txid)

  const check2 = await verifier.verify({
    txid: second.txid,
    plaintext: step2,
    expectedPrevTxid: first.txid
  })
  if (!check2.ok) {
    throw new Error(`second verify failed: ${check2.reason}`)
  }
  console.log('both records verified on testnet')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
