/** Protocol id pushed as UTF-8 in field 0 of the OP_RETURN payload. */
export const PROTOCOL_ID = 'AGENTANCHOR'

/** UTF-8 version push. */
export const PROTOCOL_VERSION = '1'

/** Author Identity Protocol prefix (Bitcom address). */
export const AIP_PREFIX = '15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva'

/** AIP signing algorithm field. */
export const AIP_ALGORITHM = 'BITCOIN_ECDSA'

/** Pipe separator before the AIP trailer. */
export const AIP_SEPARATOR = '|'

export const CONTENT_HASH_LENGTH = 32
export const CIPHER_NONCE_LENGTH = 12
export const GCM_TAG_LENGTH = 16
export const TXID_HEX_LENGTH = 64
export const MAX_CIPHERTEXT_BYTES = 100_000

export const DEFAULT_INDEXER_BASE_URL = 'https://api.whatsonchain.com/v1/bsv/test'

export const DEFAULT_MAINNET_INDEXER_BASE_URL = 'https://api.whatsonchain.com/v1/bsv/main'

export type AnchorMode = 'hash' | 'cipher'

export const HASH_MODE: AnchorMode = 'hash'
export const CIPHER_MODE: AnchorMode = 'cipher'

/**
 * Push order before `|`. Names match PROTOCOL.md.
 * The AIP signature covers every push listed here.
 */
export const RECORD_FIELD_ORDER = [
  'protocolId',
  'version',
  'identityAddress',
  'sessionId',
  'sequence',
  'prevTxid',
  'contentHash',
  'mode',
  'nonce',
  'ciphertext'
] as const

export type RecordFieldName = (typeof RECORD_FIELD_ORDER)[number]

/** First record in a chain uses a zero-length prevTxid push. */
export const EMPTY_PREV_TXID = ''

export interface AgentAnchorRecord {
  protocolId: typeof PROTOCOL_ID
  version: typeof PROTOCOL_VERSION
  identityAddress: string
  sessionId: string
  sequence: number
  prevTxid: string
  contentHash: Uint8Array
  mode: AnchorMode
  nonce: Uint8Array
  ciphertext: Uint8Array
}
