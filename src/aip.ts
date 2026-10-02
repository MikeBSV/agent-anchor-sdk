import { BSM, OP, PrivateKey, Signature, Utils, BigNumber } from '@bsv/sdk'
import { AIP_ALGORITHM, AIP_PREFIX, AIP_SEPARATOR } from './protocol'

/** AIP field 0 is OP_RETURN (0x6a), not OP_FALSE. */
export function aipSignedMessage(protocolPushes: number[][]): number[] {
  const message: number[] = [OP.OP_RETURN]
  for (const push of protocolPushes) {
    message.push(...push)
  }
  message.push(...Utils.toArray(AIP_SEPARATOR, 'utf8'))
  return message
}

export function signAip(protocolPushes: number[][], identityKey: PrivateKey): string {
  const signed = BSM.sign(aipSignedMessage(protocolPushes), identityKey, 'base64')
  if (typeof signed !== 'string') {
    throw new Error('BSM.sign did not return a base64 signature')
  }
  return signed
}

export function verifyAip(
  protocolPushes: number[][],
  signatureBase64: string,
  expectedAddress: string,
  network: 'testnet' | 'mainnet'
): boolean {
  const message = aipSignedMessage(protocolPushes)
  const sig = Signature.fromCompact(signatureBase64, 'base64')
  const digest = new BigNumber(BSM.magicHash(message))
  for (let recovery = 0; recovery < 4; recovery++) {
    try {
      const pub = sig.RecoverPublicKey(recovery, digest)
      if (BSM.verify(message, sig, pub) && pub.toAddress(network) === expectedAddress) {
        return true
      }
    } catch {
      // try next recovery id
    }
  }
  return false
}

export function aipTrailerPushes(identityAddress: string, signatureBase64: string): number[][] {
  return [
    Utils.toArray(AIP_SEPARATOR, 'utf8'),
    Utils.toArray(AIP_PREFIX, 'utf8'),
    Utils.toArray(AIP_ALGORITHM, 'utf8'),
    Utils.toArray(identityAddress, 'utf8'),
    Utils.toArray(signatureBase64, 'utf8')
  ]
}
