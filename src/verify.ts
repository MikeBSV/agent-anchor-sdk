import { OP, Transaction } from '@bsv/sdk'
import { contentHash, hashToBytes } from './hash'
import { parseAnchorScript } from './record'
import { verifyAip } from './aip'
import type { ChainIndexer } from './network'
import type { AgentAnchorRecord } from './protocol'
import { EMPTY_PREV_TXID, HASH_MODE } from './protocol'

export interface VerifyInput {
  txid: string
  /** Required in hash mode: the original plaintext. Ignored for cipher blob checks. */
  plaintext?: Uint8Array
  expectedPrevTxid?: string
}

export interface VerifyResult {
  ok: boolean
  record?: AgentAnchorRecord
  reason?: string
}

export class AgentVerifier {
  constructor(
    private readonly indexer: ChainIndexer,
    private readonly network: 'testnet' | 'mainnet' = 'testnet'
  ) {}

  async verify(input: VerifyInput): Promise<VerifyResult> {
    const hex = await this.indexer.getRawTxHex(input.txid)
    const tx = Transaction.fromHex(hex)
    const output = tx.outputs.find((o) =>
      o.lockingScript.chunks.some((c) => c.op === OP.OP_RETURN)
    )
    if (!output) {
      return { ok: false, reason: 'No OP_RETURN output' }
    }

    let parsed
    try {
      parsed = parseAnchorScript(output.lockingScript)
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }

    const { record, signatureBase64, protocolPushes } = parsed

    if (!verifyAip(protocolPushes, signatureBase64, record.identityAddress, this.network)) {
      return { ok: false, record, reason: 'AIP signature invalid' }
    }

    if (input.expectedPrevTxid !== undefined) {
      const expected = input.expectedPrevTxid === '' ? EMPTY_PREV_TXID : input.expectedPrevTxid
      if (record.prevTxid !== expected) {
        return { ok: false, record, reason: 'prevTxid mismatch' }
      }
    }

    if (record.mode === HASH_MODE) {
      if (!input.plaintext) {
        return { ok: false, record, reason: 'plaintext required to verify hash mode' }
      }
      const recomputed = hashToBytes(contentHash(input.plaintext))
      if (!equalBytes(recomputed, record.contentHash)) {
        return { ok: false, record, reason: 'content hash mismatch' }
      }
    } else {
      const recomputed = hashToBytes(contentHash(record.ciphertext))
      if (!equalBytes(recomputed, record.contentHash)) {
        return { ok: false, record, reason: 'ciphertext hash mismatch' }
      }
    }

    return { ok: true, record }
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
