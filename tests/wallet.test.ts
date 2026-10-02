import { P2PKH, PrivateKey } from '@bsv/sdk'
import { fundedWallet, MemoryBroadcaster } from './helpers'

describe('AgentWallet', () => {
  it('pays P2PKH using mocked indexer and broadcaster', async () => {
    const { wallet } = fundedWallet(50_000)
    const recipient = PrivateKey.fromRandom().toAddress('testnet')
    const broadcaster = new MemoryBroadcaster()
    const txid = await wallet.payP2pkh(recipient, 1_000, broadcaster)
    expect(txid).toHaveLength(64)
    expect(broadcaster.lastTx).toBeDefined()
    const tx = broadcaster.lastTx!
    expect(tx.outputs[0].lockingScript.toHex()).toBe(new P2PKH().lock(recipient).toHex())
    expect(tx.outputs[0].satoshis).toBe(1_000)
    expect(tx.outputs.some((o) => o.change || (o.satoshis ?? 0) > 0)).toBe(true)
  })

  it('throws when funds are missing', async () => {
    const { wallet, indexer } = fundedWallet(100)
    indexer.utxos = []
    await expect(wallet.payP2pkh(wallet.address, 1_000, new MemoryBroadcaster())).rejects.toThrow(
      /Insufficient funds/
    )
  })

  it('spends change from the previous broadcast when the indexer is stale', async () => {
    const { wallet, indexer } = fundedWallet(50_000)
    const broadcaster = new MemoryBroadcaster()
    const first = await wallet.payP2pkh(wallet.address, 1_000, broadcaster)
    expect(first).toHaveLength(64)
    indexer.txs.set(first, broadcaster.lastTx!.toHex())
    const second = await wallet.payP2pkh(wallet.address, 1_000, broadcaster)
    expect(second).toHaveLength(64)
    expect(second).not.toBe(first)
  })
})
