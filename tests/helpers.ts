import {
  P2PKH,
  PrivateKey,
  Transaction,
  UnlockingScript,
  type BroadcastFailure,
  type BroadcastResponse
} from '@bsv/sdk'
import { AgentWallet } from '../src/wallet'
import type { ChainIndexer, TxBroadcaster, Utxo } from '../src/network'

export class MemoryIndexer implements ChainIndexer {
  utxos: Utxo[] = []
  txs = new Map<string, string>()

  async getUtxos(): Promise<Utxo[]> {
    return this.utxos
  }

  async getRawTxHex(txid: string): Promise<string> {
    const hex = this.txs.get(txid)
    if (!hex) throw new Error(`missing tx ${txid}`)
    return hex
  }
}

export class MemoryBroadcaster implements TxBroadcaster {
  lastTx?: Transaction
  fail = false

  async broadcast(tx: Transaction): Promise<BroadcastResponse | BroadcastFailure> {
    this.lastTx = tx
    if (this.fail) {
      return { status: 'error', code: 'REJECTED', description: 'mock fail' }
    }
    return { status: 'success', txid: tx.id('hex'), message: 'ok' }
  }
}

export function coinFor(address: string, satoshis: number): { tx: Transaction; txid: string } {
  const tx = new Transaction()
  tx.addInput({
    sourceTXID: '00'.repeat(32),
    sourceOutputIndex: 0,
    unlockingScript: UnlockingScript.fromHex('00'),
    sequence: 0xffffffff
  })
  tx.addOutput({
    satoshis,
    lockingScript: new P2PKH().lock(address)
  })
  const txid = tx.id('hex')
  return { tx, txid }
}

export function fundedWallet(satoshis = 100_000): {
  wallet: AgentWallet
  indexer: MemoryIndexer
  fundingKey: PrivateKey
  identityKey: PrivateKey
} {
  const indexer = new MemoryIndexer()
  const fundingKey = PrivateKey.fromRandom()
  const identityKey = PrivateKey.fromRandom()
  const wallet = new AgentWallet(fundingKey, indexer, { network: 'testnet' })
  const coin = coinFor(wallet.address, satoshis)
  indexer.txs.set(coin.txid, coin.tx.toHex())
  indexer.utxos = [{ txid: coin.txid, outputIndex: 0, satoshis }]
  return { wallet, indexer, fundingKey, identityKey }
}
