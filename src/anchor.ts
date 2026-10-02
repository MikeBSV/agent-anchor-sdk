import { PrivateKey, Transaction } from '@bsv/sdk'
import { AgentWallet } from './wallet'
import { contentHash, hashToBytes } from './hash'
import { protocolPushes, buildAnchorScript } from './record'
import { signAip } from './aip'
import {
  AgentAnchorRecord,
  CIPHER_MODE,
  EMPTY_PREV_TXID,
  HASH_MODE,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  type AnchorMode
} from './protocol'
import type { TxBroadcaster } from './network'
import { encryptPayload } from './encrypt'

export interface AnchorInput {
  sessionId: string
  sequence: number
  prevTxid?: string
  /** Plaintext for hash mode, or plaintext to encrypt in cipher mode. */
  content: Uint8Array
  mode?: AnchorMode
  /** Required for cipher mode. 32-byte key, never the funding or identity key. */
  dataKey?: Uint8Array
}

export interface AnchorResult {
  txid: string
  contentHash: Uint8Array
  record: AgentAnchorRecord
}

export class AgentAnchor {
  constructor(
    private readonly wallet: AgentWallet,
    private readonly identityKey: PrivateKey
  ) {}

  get identityAddress(): string {
    return this.identityKey.toAddress(this.wallet.network)
  }

  buildRecord(input: AnchorInput): AgentAnchorRecord {
    const mode = input.mode ?? HASH_MODE
    let hashSource = input.content
    let nonce = new Uint8Array(0)
    let ciphertext = new Uint8Array(0)

    if (mode === CIPHER_MODE) {
      if (!input.dataKey) {
        throw new Error('cipher mode requires a separate 32-byte dataKey')
      }
      const encrypted = encryptPayload(input.content, input.dataKey)
      nonce = new Uint8Array(encrypted.nonce)
      ciphertext = new Uint8Array(encrypted.ciphertext)
      hashSource = ciphertext
    }

    return {
      protocolId: PROTOCOL_ID,
      version: PROTOCOL_VERSION,
      identityAddress: this.identityAddress,
      sessionId: input.sessionId,
      sequence: input.sequence,
      prevTxid: input.prevTxid ?? EMPTY_PREV_TXID,
      contentHash: hashToBytes(contentHash(hashSource)),
      mode,
      nonce,
      ciphertext
    }
  }

  async anchor(input: AnchorInput, broadcaster: TxBroadcaster): Promise<AnchorResult> {
    const record = this.buildRecord(input)
    const pushes = protocolPushes(record)
    const signature = signAip(pushes, this.identityKey)
    const script = buildAnchorScript(record, signature)

    const selected = await this.wallet.selectUtxos(1000)
    const tx = new Transaction()
    await this.wallet.addFundingInputs(tx, selected)
    tx.addOutput({
      satoshis: 0,
      lockingScript: script
    })
    this.wallet.addChangeOutput(tx)
    await this.wallet.applyFeeAndSign(tx)
    const txid = await this.wallet.broadcast(tx, broadcaster)
    return { txid, contentHash: record.contentHash, record }
  }
}
