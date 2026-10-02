import { PrivateKey, Transaction } from '@bsv/sdk'
import {
  AgentWallet,
  DEFAULT_ESCROW_LOCK_SECONDS,
  DEFAULT_TESTNET_ARC_URL,
  MAX_ESCROW_LOCK_SECONDS,
  UNIX_LOCKTIME_THRESHOLD,
  WhatsOnChainIndexer,
  assertEscrowLocktimeNotExcessive,
  completeEscrow,
  createArcBroadcaster,
  escrowScriptLocktime,
  lockEscrow,
  refundEscrow,
  refundNLockTime
} from '../src'

const PATHS = ['complete', 'lock', 'refund', 'refund-existing'] as const
type EscrowPath = (typeof PATHS)[number]

function envInt(name: string, fallback?: number): number {
  const raw = process.env[name]
  if (!raw) {
    if (fallback === undefined) throw new Error(`Set ${name}`)
    return fallback
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return n
}

function logLocktime(locktime: number): void {
  if (locktime >= UNIX_LOCKTIME_THRESHOLD) {
    console.log('refund allowed after (unix)', locktime)
    console.log('refund allowed after (utc)', new Date(locktime * 1000).toISOString())
  } else {
    console.log('refund allowed after (block height)', locktime)
  }
}

function chooseLocktime(path: EscrowPath, now: number, allowLong: boolean): number {
  if (path === 'refund') {
    return now - 3_600
  }
  const explicit = process.env.ESCROW_LOCKTIME
  const hours = process.env.ESCROW_LOCK_HOURS
  let locktime: number
  if (explicit) {
    locktime = envInt('ESCROW_LOCKTIME')
  } else if (hours) {
    locktime = now + envInt('ESCROW_LOCK_HOURS') * 3600
  } else {
    locktime = now + DEFAULT_ESCROW_LOCK_SECONDS
  }
  assertEscrowLocktimeNotExcessive(locktime, { now, allowLong, maxSeconds: MAX_ESCROW_LOCK_SECONDS })
  return locktime
}

async function main(): Promise<void> {
  const fundingWif = process.env.FUNDING_WIF
  const sellerWif = process.env.SELLER_WIF
  const path = (process.env.ESCROW_PATH ?? 'complete').toLowerCase() as EscrowPath
  const satoshis = envInt('ESCROW_SATS', 5_000)
  const satoshisPerKb = envInt('SATOSHIS_PER_KB', 1)
  const allowLong = process.env.ESCROW_ALLOW_LONG_LOCK === '1'
  const arcUrl = process.env.ARC_URL ?? DEFAULT_TESTNET_ARC_URL
  const arcKey = process.env.ARC_API_KEY
  const indexerBase = process.env.INDEXER_BASE_URL ?? 'https://api.whatsonchain.com/v1/bsv/test'

  if (!fundingWif) {
    console.error(
      'Set FUNDING_WIF. ESCROW_PATH=complete|lock|refund|refund-existing. Optional: SELLER_WIF, ESCROW_SATS, ESCROW_LOCK_HOURS, ESCROW_LOCKTIME, ESCROW_ALLOW_LONG_LOCK=1, SATOSHIS_PER_KB, ARC_URL, ARC_API_KEY.'
    )
    process.exit(1)
  }
  if (!PATHS.includes(path)) {
    throw new Error(`ESCROW_PATH must be one of ${PATHS.join(', ')}`)
  }

  const indexer = new WhatsOnChainIndexer(indexerBase)
  const buyerWallet = AgentWallet.fromWif(fundingWif, indexer, {
    network: 'testnet',
    satoshisPerKb
  })
  const broadcaster = createArcBroadcaster(arcUrl, arcKey)
  const now = Math.floor(Date.now() / 1000)

  console.log('broadcast via', arcUrl)
  console.log('buyer address', buyerWallet.address)
  console.log('path', path)
  console.log('fee rate sat/kB', satoshisPerKb)

  if (path === 'refund-existing') {
    const txid = process.env.ESCROW_TXID
    if (!txid) throw new Error('Set ESCROW_TXID for refund-existing')
    const outputIndex = envInt('ESCROW_VOUT', 0)
    const hex = await buyerWallet.getRawTxHex(txid)
    const source = Transaction.fromHex(hex)
    const scriptLocktime = escrowScriptLocktime(source.outputs[outputIndex].lockingScript)
    const spendLocktime = refundNLockTime(scriptLocktime, now)
    console.log('escrow txid', txid)
    console.log('escrow vout', outputIndex)
    logLocktime(scriptLocktime)
    const refunded = await refundEscrow(
      buyerWallet,
      { txid, outputIndex },
      spendLocktime,
      broadcaster
    )
    console.log('refund txid', refunded.txid)
    console.log('buyer receives satoshis', refunded.paidSatoshis)
    console.log('refund fee satoshis (buyer)', refunded.feeSatoshis)
    console.log('refund url', `https://test.whatsonchain.com/tx/${refunded.txid}`)
    return
  }

  const seller = sellerWif ? PrivateKey.fromWif(sellerWif) : PrivateKey.fromRandom()
  const sellerAddress = seller.toAddress('testnet')
  const locktime = chooseLocktime(path, now, allowLong)
  console.log('seller address', sellerAddress)
  if (!sellerWif) {
    console.log('seller key is ephemeral for this run (set SELLER_WIF to keep the seller coins)')
  }
  console.log('escrow satoshis (seller/refund payout)', satoshis)
  logLocktime(locktime)

  const locked = await lockEscrow(
    buyerWallet,
    seller.toPublicKey(),
    satoshis,
    locktime,
    broadcaster
  )
  console.log('lock txid', locked.txid)
  console.log('lock vout', locked.outputIndex)
  console.log('lock fee satoshis (buyer)', locked.feeSatoshis)
  console.log('lock url', `https://test.whatsonchain.com/tx/${locked.txid}`)

  if (path === 'lock') {
    console.log('locked only; complete later or refund-existing after the locktime above')
    return
  }

  if (path === 'complete') {
    const paid = await completeEscrow(
      buyerWallet,
      buyerWallet.fundingKey,
      seller,
      locked,
      sellerAddress,
      broadcaster
    )
    console.log('complete txid', paid.txid)
    console.log('seller receives satoshis', paid.paidSatoshis)
    console.log('complete fee satoshis (buyer)', paid.feeSatoshis)
    console.log('complete url', `https://test.whatsonchain.com/tx/${paid.txid}`)
    return
  }

  const refunded = await refundEscrow(buyerWallet, locked, locktime, broadcaster)
  console.log('refund txid', refunded.txid)
  console.log('buyer receives satoshis', refunded.paidSatoshis)
  console.log('refund fee satoshis (buyer)', refunded.feeSatoshis)
  console.log('refund url', `https://test.whatsonchain.com/tx/${refunded.txid}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
