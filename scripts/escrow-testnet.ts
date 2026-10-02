import { PrivateKey } from '@bsv/sdk'
import {
  AgentWallet,
  DEFAULT_TESTNET_ARC_URL,
  WhatsOnChainIndexer,
  completeEscrow,
  createArcBroadcaster,
  lockEscrow,
  refundEscrow
} from '../src'

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return n
}

async function main(): Promise<void> {
  const fundingWif = process.env.FUNDING_WIF
  const sellerWif = process.env.SELLER_WIF
  const path = (process.env.ESCROW_PATH ?? 'complete').toLowerCase()
  const satoshis = envInt('ESCROW_SATS', 5_000)
  const arcUrl = process.env.ARC_URL ?? DEFAULT_TESTNET_ARC_URL
  const arcKey = process.env.ARC_API_KEY
  const indexerBase = process.env.INDEXER_BASE_URL ?? 'https://api.whatsonchain.com/v1/bsv/test'

  if (!fundingWif) {
    console.error('Set FUNDING_WIF. Optional: SELLER_WIF, ESCROW_PATH=complete|refund, ESCROW_SATS, ARC_URL, ARC_API_KEY.')
    process.exit(1)
  }
  if (path !== 'complete' && path !== 'refund') {
    throw new Error('ESCROW_PATH must be complete or refund')
  }

  const indexer = new WhatsOnChainIndexer(indexerBase)
  const buyerWallet = AgentWallet.fromWif(fundingWif, indexer, { network: 'testnet' })
  const seller = sellerWif ? PrivateKey.fromWif(sellerWif) : PrivateKey.fromRandom()
  const sellerAddress = seller.toAddress('testnet')
  const broadcaster = createArcBroadcaster(arcUrl, arcKey)
  const now = Math.floor(Date.now() / 1000)
  const locktime = path === 'refund' ? now - 3_600 : now + 7 * 24 * 60 * 60

  console.log('broadcast via', arcUrl)
  console.log('buyer address', buyerWallet.address)
  console.log('seller address', sellerAddress)
  if (!sellerWif) {
    console.log('seller key is ephemeral for this run (set SELLER_WIF to reuse a seller)')
  }
  console.log('path', path)
  console.log('escrow satoshis', satoshis)
  console.log('script locktime (unix)', locktime)

  const locked = await lockEscrow(
    buyerWallet,
    seller.toPublicKey(),
    satoshis,
    locktime,
    broadcaster
  )
  console.log('lock txid', locked.txid)
  console.log('lock vout', locked.outputIndex)
  console.log('lock url', `https://test.whatsonchain.com/tx/${locked.txid}`)

  if (path === 'complete') {
    const payTxid = await completeEscrow(
      buyerWallet,
      buyerWallet.fundingKey,
      seller,
      locked,
      sellerAddress,
      broadcaster
    )
    console.log('complete txid', payTxid)
    console.log('complete url', `https://test.whatsonchain.com/tx/${payTxid}`)
    console.log('seller should receive escrow minus the complete fee')
    return
  }

  const refundTxid = await refundEscrow(buyerWallet, locked, locktime, broadcaster)
  console.log('refund txid', refundTxid)
  console.log('refund url', `https://test.whatsonchain.com/tx/${refundTxid}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
