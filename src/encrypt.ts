import { AESGCM, AESGCMDecrypt } from '@bsv/sdk/primitives/AESGCM'
import { Random } from '@bsv/sdk'
import { CIPHER_NONCE_LENGTH, GCM_TAG_LENGTH } from './protocol'

const KEY_LENGTH = 32

function asUint8(bytes: number[] | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
}

export function encryptPayload(
  plaintext: Uint8Array,
  dataKey: Uint8Array
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  if (dataKey.length !== KEY_LENGTH) {
    throw new Error('data key must be 32 bytes')
  }
  const nonce = Uint8Array.from(Random(CIPHER_NONCE_LENGTH))
  const { result, authenticationTag } = AESGCM(plaintext, nonce, dataKey)
  const cipher = asUint8(result)
  const tag = asUint8(authenticationTag)
  const ciphertext = new Uint8Array(cipher.length + tag.length)
  ciphertext.set(cipher, 0)
  ciphertext.set(tag, cipher.length)
  return { nonce, ciphertext }
}

export function decryptPayload(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  dataKey: Uint8Array
): Uint8Array {
  if (dataKey.length !== KEY_LENGTH) {
    throw new Error('data key must be 32 bytes')
  }
  if (nonce.length !== CIPHER_NONCE_LENGTH) {
    throw new Error(`nonce must be ${CIPHER_NONCE_LENGTH} bytes`)
  }
  if (ciphertext.length < GCM_TAG_LENGTH) {
    throw new Error('ciphertext missing GCM tag')
  }
  const body = ciphertext.subarray(0, ciphertext.length - GCM_TAG_LENGTH)
  const tag = ciphertext.subarray(ciphertext.length - GCM_TAG_LENGTH)
  const plain = AESGCMDecrypt(body, nonce, tag, dataKey)
  if (plain === null) {
    throw new Error('decryption failed')
  }
  return asUint8(plain)
}
