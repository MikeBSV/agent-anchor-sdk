import { Hash, Utils } from '@bsv/sdk'

export function toNumberArray(bytes: Uint8Array | number[]): number[] {
  return Array.isArray(bytes) ? bytes : Array.from(bytes)
}

/** SHA-256 of raw bytes. Does not parse or canonicalize JSON. */
export function contentHash(bytes: Uint8Array | number[]): number[] {
  return Hash.sha256(toNumberArray(bytes))
}

export function contentHashHex(bytes: Uint8Array | number[]): string {
  return Utils.toHex(contentHash(bytes))
}

export function hashToBytes(hash: number[]): Uint8Array {
  return Uint8Array.from(hash)
}
