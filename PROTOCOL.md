# AGENTANCHOR protocol v1

This protocol writes a signed AI-agent audit record into a Bitcoin SV transaction. A later check can prove the recorded bytes were not edited. It does not stop an agent from anchoring a false record.

The same wire format is used on BSV **testnet** and **mainnet**. This SDK defaults to testnet.

## Transaction

- One zero-sat data output.
- Locking script starts with `OP_FALSE` then `OP_RETURN`.
- Each field below is its own push, in this order, before the AIP section.

## Fields before `|`

1. `AGENTANCHOR` — UTF-8 protocol id
2. `1` — UTF-8 version
3. Identity address — UTF-8. This is **not** the funding address.
4. `sessionId` — UTF-8
5. `sequence` — decimal UTF-8, no leading zeros
6. `prevTxid` — 64-character hex of `Transaction.id('hex')`, or a **zero-length** push for the first record in a chain
7. `contentHash` — 32 raw bytes (not hex text)
8. `mode` — `hash` or `cipher`
9. `nonce` — zero-length in `hash` mode; 12 raw bytes in `cipher` mode
10. `ciphertext` — zero-length in `hash` mode; AES-256-GCM ciphertext with the 16-byte tag appended in `cipher` mode

## AIP trailer

Immediately after those fields:

- `|`
- `15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva`
- `BITCOIN_ECDSA`
- the same identity address as field 3
- the base64 Bitcoin Signed Message signature

The signature covers every push **before** `|`. Identity key and funding key are separate.

AIP signed bytes (Bitcoin Signed Message) are: opcode `OP_RETURN` (0x6a), then each protocol field push, then the `|` push. `OP_FALSE` is not part of the signed message. After a transaction is serialized, `@bsv/sdk` stores those field pushes as the `OP_RETURN` chunk's data blob; parsers must unpack that blob.

## Hash input

- `hash` mode: SHA-256 of the plaintext. Plaintext stays off-chain. A verifier must be given those same bytes.
- `cipher` mode: SHA-256 of the ciphertext. Anyone can check the blob. Only a holder of the separate 32-byte data key can decrypt. The data key is never derived from the funding or identity keys. The SDK does not store it.

Ciphertext on-chain stays under 100,000 bytes so WhatsOnChain will not truncate `scriptPubKey`.

## Network

- Broadcast via ARC (`POST {arcUrl}/v1/tx`).
- Read UTXOs and raw transaction hex from an indexer (WhatsOnChain-style), behind an interface.
- Default indexer (testnet): `https://api.whatsonchain.com/v1/bsv/test`
- Default indexer (mainnet): `https://api.whatsonchain.com/v1/bsv/main`
