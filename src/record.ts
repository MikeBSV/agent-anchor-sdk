import { LockingScript, OP, Script, Utils } from '@bsv/sdk'
import type { ScriptChunk } from '@bsv/sdk'
import {
  AIP_ALGORITHM,
  AIP_PREFIX,
  AIP_SEPARATOR,
  AgentAnchorRecord,
  CIPHER_MODE,
  CONTENT_HASH_LENGTH,
  CIPHER_NONCE_LENGTH,
  EMPTY_PREV_TXID,
  HASH_MODE,
  MAX_CIPHERTEXT_BYTES,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  TXID_HEX_LENGTH,
  type AnchorMode
} from './protocol'
import { aipTrailerPushes } from './aip'

export function utf8Bytes(text: string): number[] {
  return Utils.toArray(text, 'utf8')
}

export function encodeSequence(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error('sequence must be a non-negative integer')
  }
  return String(sequence)
}

export function normalizePrevTxid(prevTxid: string): string {
  if (prevTxid === EMPTY_PREV_TXID) return EMPTY_PREV_TXID
  const hex = prevTxid.toLowerCase()
  if (hex.length !== TXID_HEX_LENGTH || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error('prevTxid must be empty or 64 lowercase hex characters')
  }
  return hex
}

export function protocolPushes(record: AgentAnchorRecord): number[][] {
  if (record.protocolId !== PROTOCOL_ID) {
    throw new Error(`protocolId must be ${PROTOCOL_ID}`)
  }
  if (record.version !== PROTOCOL_VERSION) {
    throw new Error(`version must be ${PROTOCOL_VERSION}`)
  }
  if (record.contentHash.length !== CONTENT_HASH_LENGTH) {
    throw new Error(`contentHash must be ${CONTENT_HASH_LENGTH} bytes`)
  }
  if (record.mode === HASH_MODE) {
    if (record.nonce.length !== 0 || record.ciphertext.length !== 0) {
      throw new Error('hash mode requires empty nonce and ciphertext')
    }
  } else if (record.mode === CIPHER_MODE) {
    if (record.nonce.length !== CIPHER_NONCE_LENGTH) {
      throw new Error(`cipher mode nonce must be ${CIPHER_NONCE_LENGTH} bytes`)
    }
    if (record.ciphertext.length === 0 || record.ciphertext.length > MAX_CIPHERTEXT_BYTES) {
      throw new Error(`cipher mode ciphertext must be 1..${MAX_CIPHERTEXT_BYTES} bytes`)
    }
  } else {
    throw new Error('mode must be hash or cipher')
  }

  const prevTxid = normalizePrevTxid(record.prevTxid)
  return [
    utf8Bytes(PROTOCOL_ID),
    utf8Bytes(PROTOCOL_VERSION),
    utf8Bytes(record.identityAddress),
    utf8Bytes(record.sessionId),
    utf8Bytes(encodeSequence(record.sequence)),
    prevTxid === EMPTY_PREV_TXID ? [] : utf8Bytes(prevTxid),
    Array.from(record.contentHash),
    utf8Bytes(record.mode),
    Array.from(record.nonce),
    Array.from(record.ciphertext)
  ]
}

export function buildAnchorScript(record: AgentAnchorRecord, signatureBase64: string): LockingScript {
  const script = new LockingScript()
    .writeOpCode(OP.OP_FALSE)
    .writeOpCode(OP.OP_RETURN)
  for (const push of protocolPushes(record)) {
    script.writeBin(push)
  }
  for (const push of aipTrailerPushes(record.identityAddress, signatureBase64)) {
    script.writeBin(push)
  }
  return script
}

function chunkPushBytes(chunk: ScriptChunk): number[] | null {
  if (chunk.data && chunk.data.length > 0) return chunk.data
  if (chunk.op === 0) return []
  if (chunk.data && chunk.data.length === 0) return []
  return null
}

/** After tx hex round-trip, @bsv/sdk stores every push after OP_RETURN in that chunk's data. */
function decodePushdataStream(bytes: number[]): number[][] {
  const pushes: number[][] = []
  let pos = 0
  while (pos < bytes.length) {
    const op = bytes[pos++] ?? 0
    if (op === 0) {
      pushes.push([])
      continue
    }
    let len: number
    if (op > 0 && op < OP.OP_PUSHDATA1) {
      len = op
    } else if (op === OP.OP_PUSHDATA1) {
      if (pos >= bytes.length) throw new Error('Truncated PUSHDATA1')
      len = bytes[pos++] ?? 0
    } else if (op === OP.OP_PUSHDATA2) {
      if (pos + 1 >= bytes.length) throw new Error('Truncated PUSHDATA2')
      len = (bytes[pos] ?? 0) | ((bytes[pos + 1] ?? 0) << 8)
      pos += 2
    } else if (op === OP.OP_PUSHDATA4) {
      if (pos + 3 >= bytes.length) throw new Error('Truncated PUSHDATA4')
      len =
        (bytes[pos] ?? 0) |
        ((bytes[pos + 1] ?? 0) << 8) |
        ((bytes[pos + 2] ?? 0) << 16) |
        ((bytes[pos + 3] ?? 0) << 24)
      pos += 4
    } else {
      throw new Error(`Unexpected opcode 0x${op.toString(16)} in OP_RETURN payload`)
    }
    if (pos + len > bytes.length) throw new Error('Truncated pushdata')
    pushes.push(bytes.slice(pos, pos + len))
    pos += len
  }
  return pushes
}

export interface ParsedAnchorScript {
  record: AgentAnchorRecord
  signatureBase64: string
  protocolPushes: number[][]
}

export function parseAnchorScript(script: Script): ParsedAnchorScript {
  const chunks = script.chunks
  let start = 0
  if (chunks[0]?.op === OP.OP_FALSE) start = 1
  if (chunks[start]?.op !== OP.OP_RETURN) {
    throw new Error('Anchor output is not OP_FALSE OP_RETURN')
  }

  const returnChunk = chunks[start]
  let pushes: number[][]
  if (returnChunk.data && returnChunk.data.length > 0 && chunks.length === start + 1) {
    pushes = decodePushdataStream(returnChunk.data)
  } else {
    pushes = []
    for (let i = start + 1; i < chunks.length; i++) {
      const bytes = chunkPushBytes(chunks[i])
      if (bytes === null) {
        throw new Error('Unexpected non-push opcode in anchor script')
      }
      pushes.push(bytes)
    }
  }

  const sep = utf8Bytes(AIP_SEPARATOR)
  const sepIndex = pushes.findIndex(
    (p) => p.length === sep.length && p.every((b, i) => b === sep[i])
  )
  if (sepIndex < 0) throw new Error('AIP separator not found')

  const protocol = pushes.slice(0, sepIndex)
  const trailer = pushes.slice(sepIndex)
  if (protocol.length !== 10) {
    throw new Error(`Expected 10 protocol fields, got ${protocol.length}`)
  }
  if (trailer.length < 5) {
    throw new Error('Incomplete AIP trailer')
  }

  const prefix = Utils.toUTF8(trailer[1])
  if (prefix !== AIP_PREFIX) throw new Error('Wrong AIP prefix')
  const algorithm = Utils.toUTF8(trailer[2])
  if (algorithm !== AIP_ALGORITHM) throw new Error('Wrong AIP algorithm')
  const aipAddress = Utils.toUTF8(trailer[3])
  const signatureBase64 = Utils.toUTF8(trailer[4])

  const protocolId = Utils.toUTF8(protocol[0])
  const version = Utils.toUTF8(protocol[1])
  const identityAddress = Utils.toUTF8(protocol[2])
  if (identityAddress !== aipAddress) {
    throw new Error('Identity address does not match AIP signing address')
  }
  if (protocolId !== PROTOCOL_ID || version !== PROTOCOL_VERSION) {
    throw new Error('Unknown protocol id or version')
  }

  const mode = Utils.toUTF8(protocol[7]) as AnchorMode
  const record: AgentAnchorRecord = {
    protocolId: PROTOCOL_ID,
    version: PROTOCOL_VERSION,
    identityAddress,
    sessionId: Utils.toUTF8(protocol[3]),
    sequence: Number(Utils.toUTF8(protocol[4])),
    prevTxid: protocol[5].length === 0 ? EMPTY_PREV_TXID : Utils.toUTF8(protocol[5]),
    contentHash: Uint8Array.from(protocol[6]),
    mode,
    nonce: Uint8Array.from(protocol[8]),
    ciphertext: Uint8Array.from(protocol[9])
  }

  return { record, signatureBase64, protocolPushes: protocol }
}
