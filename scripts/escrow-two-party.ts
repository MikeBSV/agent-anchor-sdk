import { PrivateKey } from '@bsv/sdk'
import {
  AgentWallet,
  DEFAULT_ESCROW_LOCK_SECONDS,
  MAX_ESCROW_LOCK_SECONDS,
  WhatsOnChainIndexer,
  assertEscrowLocktimeNotExcessive,
  broadcastCompleteEscrow,
  buildCompleteEscrow,
  createArcBroadcaster,
  inspectCompleteOffer,
  loadChainEnv,
  lockEscrow,
  signCompleteEscrow
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
  const feePayer = (process.env.FEE_PAYER ?? 'buyer').toLowerCase()
  const satoshis = envInt('ESCROW_SATS', 5_000)
  const satoshisPerKb = envInt('SATOSHIS_PER_KB', 1)
  const allowLong = process.env.ESCROW_ALLOW_LONG_LOCK === '1'
  const chain = loadChainEnv()
  const arcKey = process.env.ARC_API_KEY

  if (!fundingWif || !sellerWif) {
    console.error(
      'Set FUNDING_WIF (buyer) and SELLER_WIF. Optional: NETWORK=mainnet, FEE_PAYER=buyer|seller, ESCROW_SATS, ESCROW_LOCK_HOURS.'
    )
    process.exit(1)
  }
  if (feePayer !== 'buyer' && feePayer !== 'seller') {
    throw new Error('FEE_PAYER must be buyer or seller')
  }
  if (chain.network === 'mainnet') {
    console.warn('NETWORK=mainnet spends real BSV. Do not reuse testnet keys.')
  }

  const indexer = new WhatsOnChainIndexer(chain.indexerBase)
  const buyer = AgentWallet.fromWif(fundingWif, indexer, { network: chain.network, satoshisPerKb })
  const sellerKey = PrivateKey.fromWif(sellerWif)
  const seller = new AgentWallet(sellerKey, indexer, { network: chain.network, satoshisPerKb })
  const sellerAddress = seller.address
  const broadcaster = createArcBroadcaster(chain.arcUrl, arcKey)
  const now = Math.floor(Date.now() / 1000)
  const hours = process.env.ESCROW_LOCK_HOURS
  const locktime = hours
    ? now + envInt('ESCROW_LOCK_HOURS', 0) * 3600
    : now + DEFAULT_ESCROW_LOCK_SECONDS
  assertEscrowLocktimeNotExcessive(locktime, { now, allowLong, maxSeconds: MAX_ESCROW_LOCK_SECONDS })

  const feeWallet = feePayer === 'seller' ? seller : buyer

  console.log('network', chain.network)
  console.log('broadcast via', chain.arcUrl)
  console.log('buyer address', buyer.address)
  console.log('seller address', sellerAddress)
  console.log('complete fee payer', feePayer)
  console.log('escrow satoshis', satoshis)
  console.log('refund allowed after (utc)', new Date(locktime * 1000).toISOString())

  const locked = await lockEscrow(buyer, sellerKey.toPublicKey(), satoshis, locktime, broadcaster)
  console.log('lock txid', locked.txid)
  console.log('lock vout', locked.outputIndex)
  console.log('lock url', `${chain.explorerOrigin}/tx/${locked.txid}`)

  let offer = await buildCompleteEscrow({
    escrow: locked,
    sellerAddress,
    sourceWallet: buyer,
    feeWallet
  })
  console.log('inspect before signs', inspectCompleteOffer(offer))

  offer = signCompleteEscrow(offer, 'seller', sellerKey)
  offer = signCompleteEscrow(offer, 'buyer', buyer.fundingKey)
  console.log('inspect after signs', inspectCompleteOffer(offer))

  const paid = await broadcastCompleteEscrow(feeWallet, offer, broadcaster)
  console.log('complete txid', paid.txid)
  console.log('seller receives satoshis', paid.paidSatoshis)
  console.log('complete fee satoshis', paid.feeSatoshis)
  console.log('complete url', `${chain.explorerOrigin}/tx/${paid.txid}`)
  console.log('seller url', `${chain.explorerOrigin}/address/${sellerAddress}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
