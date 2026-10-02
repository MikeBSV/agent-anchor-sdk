import { OP, P2PKH, PrivateKey } from '@bsv/sdk'
import {
  buildEscrowScript,
  completeEscrow,
  escrowScriptLocktime,
  lockEscrow,
  refundEscrow,
  assertEscrowLocktimeNotExcessive,
  MAX_ESCROW_LOCK_SECONDS
} from '../src/escrow'
import { fundedWallet, MemoryBroadcaster } from './helpers'

const LOCKTIME = 500_000

describe('escrow', () => {
  it('locks satoshis in the escrow script and returns change to the buyer', async () => {
    const { wallet } = fundedWallet(50_000)
    const seller = PrivateKey.fromRandom()
    const broadcaster = new MemoryBroadcaster()
    const locked = await lockEscrow(wallet, seller.toPublicKey(), 10_000, LOCKTIME, broadcaster)
    const tx = broadcaster.lastTx!
    expect(locked.txid).toHaveLength(64)
    expect(tx.outputs[locked.outputIndex].satoshis).toBe(10_000)
    expect(tx.outputs[locked.outputIndex].lockingScript.toHex()).toBe(
      buildEscrowScript(wallet.fundingKey.toPublicKey(), seller.toPublicKey(), LOCKTIME).toHex()
    )
    expect(tx.outputs.some((o) => o.lockingScript.toHex() === new P2PKH().lock(wallet.address).toHex())).toBe(
      true
    )
  })

  it('pays the seller when both keys complete the escrow', async () => {
    const { wallet } = fundedWallet(50_000)
    const seller = PrivateKey.fromRandom()
    const broadcaster = new MemoryBroadcaster()
    const locked = await lockEscrow(wallet, seller.toPublicKey(), 10_000, LOCKTIME, broadcaster)
    const pay = await completeEscrow(
      wallet,
      wallet.fundingKey,
      seller,
      locked,
      seller.toAddress('testnet'),
      broadcaster
    )
    expect(pay.txid).toHaveLength(64)
    expect(pay.paidSatoshis).toBe(10_000)
    expect(pay.feeSatoshis).toBeGreaterThan(0)
    const payTx = broadcaster.lastTx!
    expect(payTx.outputs[0].lockingScript.toHex()).toBe(new P2PKH().lock(seller.toAddress('testnet')).toHex())
    expect(payTx.outputs[0].satoshis).toBe(10_000)
    expect(payTx.outputs.some((o) => o.lockingScript.toHex() === new P2PKH().lock(wallet.address).toHex())).toBe(
      true
    )
  })

  it('rejects complete when only the seller signs', async () => {
    const { wallet } = fundedWallet(50_000)
    const seller = PrivateKey.fromRandom()
    const broadcaster = new MemoryBroadcaster()
    const locked = await lockEscrow(wallet, seller.toPublicKey(), 10_000, LOCKTIME, broadcaster)
    await expect(
      completeEscrow(wallet, seller, seller, locked, seller.toAddress('testnet'), broadcaster)
    ).rejects.toThrow()
  })

  it('rejects a refund before locktime', async () => {
    const { wallet } = fundedWallet(50_000)
    const seller = PrivateKey.fromRandom()
    const broadcaster = new MemoryBroadcaster()
    const locked = await lockEscrow(wallet, seller.toPublicKey(), 10_000, LOCKTIME, broadcaster)
    await expect(refundEscrow(wallet, locked, 100, broadcaster)).rejects.toThrow()
  })

  it('refunds the buyer at locktime', async () => {
    const { wallet } = fundedWallet(50_000)
    const seller = PrivateKey.fromRandom()
    const broadcaster = new MemoryBroadcaster()
    const locked = await lockEscrow(wallet, seller.toPublicKey(), 10_000, LOCKTIME, broadcaster)
    const refund = await refundEscrow(wallet, locked, LOCKTIME, broadcaster)
    expect(refund.txid).toHaveLength(64)
    expect(refund.paidSatoshis).toBe(10_000)
    expect(refund.feeSatoshis).toBeGreaterThan(0)
    const refundTx = broadcaster.lastTx!
    expect(refundTx.lockTime).toBe(LOCKTIME)
    expect(refundTx.inputs[0].sequence).toBe(0xfffffffe)
    expect(refundTx.outputs[0].lockingScript.toHex()).toBe(new P2PKH().lock(wallet.address).toHex())
    expect(refundTx.outputs[0].satoshis).toBe(10_000)
  })

  it('locks a second escrow from local change without refreshing the indexer', async () => {
    const { wallet, indexer } = fundedWallet(50_000)
    const seller = PrivateKey.fromRandom()
    const broadcaster = new MemoryBroadcaster()
    const first = await lockEscrow(wallet, seller.toPublicKey(), 10_000, LOCKTIME, broadcaster)
    expect(first.txid).toHaveLength(64)
    expect(indexer.utxos).toHaveLength(1)
    const second = await lockEscrow(wallet, seller.toPublicKey(), 8_000, LOCKTIME, broadcaster)
    expect(second.txid).toHaveLength(64)
    expect(second.txid).not.toBe(first.txid)
  })

  it('uses OP_IF / OP_ELSE branches in the locking script', () => {
    const buyer = PrivateKey.fromRandom()
    const seller = PrivateKey.fromRandom()
    const script = buildEscrowScript(buyer.toPublicKey(), seller.toPublicKey(), LOCKTIME)
    const ops = script.chunks.map((c) => c.op)
    expect(ops).toContain(OP.OP_IF)
    expect(ops).toContain(OP.OP_ELSE)
    expect(ops).toContain(OP.OP_CHECKMULTISIG)
    expect(ops).toContain(OP.OP_CHECKLOCKTIMEVERIFY)
    expect(escrowScriptLocktime(script)).toBe(LOCKTIME)
  })

  it('rejects a unix locktime more than 90 days ahead unless allowLong is set', () => {
    const now = 1_800_000_000
    expect(() =>
      assertEscrowLocktimeNotExcessive(now + MAX_ESCROW_LOCK_SECONDS + 1, { now })
    ).toThrow(/more than 90 days/)
    expect(() =>
      assertEscrowLocktimeNotExcessive(now + MAX_ESCROW_LOCK_SECONDS + 1, { now, allowLong: true })
    ).not.toThrow()
    expect(() => assertEscrowLocktimeNotExcessive(LOCKTIME, { now })).not.toThrow()
  })
})
