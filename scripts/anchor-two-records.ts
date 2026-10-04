import {
  AgentAnchor,
  AgentVerifier,
  AgentWallet,
  WhatsOnChainIndexer,
  createArcBroadcaster,
  createWhatsOnChainBroadcaster,
  HASH_MODE,
  loadChainEnv
} from '../src'
import { PrivateKey } from '@bsv/sdk'

async function main(): Promise<void> {
  const fundingWif = process.env.FUNDING_WIF
  const identityWif = process.env.IDENTITY_WIF
  const chain = loadChainEnv()
  const arcKey = process.env.ARC_API_KEY
  const useWoc = (process.env.BROADCAST ?? 'arc').toLowerCase() === 'woc'

  if (!fundingWif || !identityWif) {
    console.error('Set FUNDING_WIF and IDENTITY_WIF. Optional: NETWORK=mainnet, ARC_URL, ARC_API_KEY.')
    process.exit(1)
  }
  if (chain.network === 'mainnet') {
    console.warn('NETWORK=mainnet spends real BSV. Do not reuse testnet keys.')
  }

  const indexer = new WhatsOnChainIndexer(chain.indexerBase)
  const wallet = AgentWallet.fromWif(fundingWif, indexer, { network: chain.network })
  const identity = PrivateKey.fromWif(identityWif)
  const anchor = new AgentAnchor(wallet, identity)
  const broadcaster = useWoc
    ? createWhatsOnChainBroadcaster(chain.wocBroadcast)
    : createArcBroadcaster(chain.arcUrl, arcKey)
  console.log('network', chain.network)
  console.log('broadcast via', useWoc ? `WhatsOnChain ${chain.wocBroadcast}` : chain.arcUrl)
  const verifier = new AgentVerifier(indexer, chain.network)

  console.log('funding address', wallet.address)
  console.log('identity address', identity.toAddress(chain.network))

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
  console.log('both records verified on', chain.network)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
