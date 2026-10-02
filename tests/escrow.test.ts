import { OP, P2PKH, PrivateKey } from '@bsv/sdk'
import {
  buildEscrowScript,
  completeEscrow,
  lockEscrow,
  refundEscrow
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
    const payTxid = await completeEscrow(
      wallet,
      wallet.fundingKey,
      seller,
      locked,
      seller.toAddress('testnet'),
      broadcaster
    )
    expect(payTxid).toHaveLength(64)
    const pay = broadcaster.lastTx!
    expect(pay.outputs[0].lockingScript.toHex()).toBe(new P2PKH().lock(seller.toAddress('testnet')).toHex())
    expect(pay.outputs[0].satoshis).toBeGreaterThan(0)
    expect(pay.outputs[0].satoshis).toBeLessThan(10_000)
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
    const refundTxid = await refundEscrow(wallet, locked, LOCKTIME, broadcaster)
    expect(refundTxid).toHaveLength(64)
    const refund = broadcaster.lastTx!
    expect(refund.lockTime).toBe(LOCKTIME)
    expect(refund.inputs[0].sequence).toBe(0xfffffffe)
    expect(refund.outputs[0].lockingScript.toHex()).toBe(new P2PKH().lock(wallet.address).toHex())
    expect(refund.outputs[0].satoshis).toBeGreaterThan(0)
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
  })
})
