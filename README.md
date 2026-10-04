# agent-anchor-sdk

TypeScript SDK for **BSV** (testnet by default, mainnet opt-in): signed AI-agent audit records, plus native 2-of-2 escrow with a timed buyer refund. A later check can prove anchored bytes were not edited. It does not prove the agent told the truth.

Wire format: [PROTOCOL.md](PROTOCOL.md). License: [MIT](LICENSE).

## Install

Node 22+. `@bsv/sdk` is pinned at **2.8.11**.

```
npm install
npm test
npm run build
```

## Keys

Keep two keys. The **funding** key pays fees. The **identity** key only signs the AIP trailer. Never derive the optional AES-256-GCM **data key** from either.

From the repo folder, run `node` and paste:

```js
const { PrivateKey } = require('@bsv/sdk')
const funding = PrivateKey.fromRandom()
const identity = PrivateKey.fromRandom()
const seller = PrivateKey.fromRandom()
console.log('FUNDING_WIF', funding.toWif())
console.log('funding address', funding.toAddress('testnet'))
console.log('IDENTITY_WIF', identity.toWif())
console.log('identity address', identity.toAddress('testnet'))
console.log('SELLER_WIF', seller.toWif())
console.log('seller address (testnet)', seller.toAddress('testnet'))
console.log('seller address (mainnet)', seller.toAddress('mainnet'))
```

Type `.exit` when done. For the examples below, send **tBSV** only to the **testnet funding address**. The seller does not need a faucet on the default complete path. **Never reuse testnet keys on mainnet** — generate a new set and use `toAddress('mainnet')` when you opt in.

## Storage (`hash` vs `cipher`)

The protocol is a signed receipt that these **bytes** existed. File format and compression are up to you. Compress first if you want, then pass that `Uint8Array` as `content`. A verifier must use the **same** bytes.

| Mode | What goes on-chain | File format |
|---|---|---|
| **`hash` (default)** | 32-byte SHA-256. Plaintext stays off-chain. | Yours. Proof is that the bytes match the hash. |
| **`cipher`** | AES-256-GCM (12-byte nonce, 16-byte tag appended) plus SHA-256 of that ciphertext. Cap **100,000** bytes. | Layout inside the plaintext is yours. The envelope is this SDK’s AES-256-GCM and a **separate 32-byte data key** (not funding or identity). |

`npm run example` uses hash mode (plaintext stays off-chain). Cipher is `npm run cipher` below.

## Anchor example (hash)

Default broadcast is GorillaPool testnet ARC (no API key): `https://testnet.arc.gorillapool.io`. ARC is an HTTP API. Opening that host in a browser often shows `no matching operation was found`; that is normal.

PowerShell (keep quotes around WIFs):

```
$env:FUNDING_WIF="..."
$env:IDENTITY_WIF="..."
npm run example
```

That broadcasts two linked **hash** records and verifies each against the original plaintext.

Optional: `NETWORK=mainnet` (default is testnet; uses GorillaPool `https://arc.gorillapool.io` and `https://api.whatsonchain.com/v1/bsv/main` — **new keys only**), `ARC_URL` (no `/v1` suffix; the SDK posts to `/v1/tx`), `ARC_API_KEY`, `INDEXER_BASE_URL` (default testnet `https://api.whatsonchain.com/v1/bsv/test`).

Do not put the funding **address** in `FUNDING_WIF`. After a faucet payment, wait until `https://test.whatsonchain.com/address/<funding-address>` shows the coins (confirmed is more reliable than mempool-only), then run the example.

The wallet remembers the first spend and its change so the second record does not double-spend a stale indexer UTXO. If a previous run already spent your faucet coin, wait for that tx to confirm (or for its change to appear) before running again.

## Cipher example

Encrypts UTF-8 with AES-256-GCM, anchors the ciphertext, verifies the on-chain blob (AIP + hash of ciphertext — this step does **not** decrypt), then decrypts with the data key.

```
$env:FUNDING_WIF="..."
$env:IDENTITY_WIF="..."
$env:CIPHER_TEXT="cipher demo secret"
npm run cipher
```

Save the printed `dataKey hex`. Without it you cannot decrypt later. Optional: `DATA_KEY_HEX` (64 hex chars) to reuse a key; otherwise the script generates one. WhatsOnChain will show OP_RETURN, not the plaintext.

Verify and decrypt that tx again (no new broadcast):

```
$env:CIPHER_TXID="..."
$env:DATA_KEY_HEX="..."
npm run cipher
```

`npm test` already round-trips encrypt/decrypt with a mock indexer if you do not want to spend testnet fees.

## Escrow

`lockEscrow` / `completeEscrow` / `refundEscrow` lock satoshis in a native Bitcoin script (no sCrypt). Default network is testnet; set `NETWORK=mainnet` to opt in. Two keys only: humans, agents, or mixed.

`FUNDING_WIF` is the **buyer** (locks coins, pays the **lock** fee). The **seller** only needs a key to complete. The **complete** fee is paid by `feeWallet` (buyer or seller). `IDENTITY_WIF` is unused here.

1. **Lock** — buyer P2PKH → escrow of exactly `ESCROW_SATS`, plus change to the buyer. WhatsOnChain shows that output as `nonstandard`. Locktime is fixed then (Unix time, or block height if the number is below 500000000).
2. **Complete** — buyer and seller both sign. The seller receives **exactly** `ESCROW_SATS`. The complete **fee** is paid by whoever builds (`feeWallet`): buyer or seller. `completeEscrow` is the one-process helper (both keys on one machine). Independent agents exchange a JSON offer:

```js
let offer = await buildCompleteEscrow({ escrow, sellerAddress, sourceWallet, feeWallet })
offer = signCompleteEscrow(offer, 'buyer', buyerKey) // either order
offer = signCompleteEscrow(offer, 'seller', sellerKey)
await broadcastCompleteEscrow(feeWallet, offer, broadcaster)
```

Inspect `paidSatoshis` (and the seller script) before signing. The locked amount is the price; a new price is a new lock.
3. **Refund** — after locktime the **buyer** must broadcast a refund. Nothing refunds by itself. If the seller will not sign, the coins wait until then.

The script prints `refund allowed after (unix)` and `(utc)` before it locks. Default window is **7 days**; **90 days** max unless `ESCROW_ALLOW_LONG_LOCK=1`. Set `ESCROW_LOCK_HOURS` or `ESCROW_LOCKTIME` (Unix time or height).

`npm test` covers these paths with a mock indexer (no network).

A run with only `FUNDING_WIF` creates a **random seller in memory**. That is a real testnet address, but you cannot spend it later. Set `SELLER_WIF` if you want to control the seller.

Lock then complete (same process, both keys; buyer pays the complete fee):

```
$env:FUNDING_WIF="..."
$env:SELLER_WIF="..."
$env:ESCROW_SATS="5000"
$env:ESCROW_LOCK_HOURS="48"
$env:SATOSHIS_PER_KB="1"
npm run escrow
```

Two-party complete on one machine (JSON offer, inspect, both signs). Default `FEE_PAYER=buyer`. Use `FEE_PAYER=seller` only if the seller address already has tBSV for the complete fee:

```
$env:FUNDING_WIF="..."
$env:SELLER_WIF="..."
$env:ESCROW_SATS="5000"
$env:ESCROW_LOCK_HOURS="48"
$env:FEE_PAYER="buyer"
npm run escrow:two-party
```

It prints `inspect before signs` / `inspect after signs` (`paidSatoshis` should match `ESCROW_SATS`). Independent agents still call `buildCompleteEscrow` / `signCompleteEscrow` / `broadcastCompleteEscrow` and exchange the JSON offer; this script is the live check of that path.

Lock only (save `lock txid`, `lock vout`, and the UTC refund time):

```
$env:FUNDING_WIF="..."
$env:SELLER_WIF="..."
$env:ESCROW_PATH="lock"
$env:ESCROW_SATS="5000"
$env:ESCROW_LOCK_HOURS="48"
npm run escrow
```

Refund that lock after the printed time:

```
$env:FUNDING_WIF="..."
$env:ESCROW_PATH="refund-existing"
$env:ESCROW_TXID="..."
$env:ESCROW_VOUT="0"
npm run escrow
```

Instant refund demo (new lock already past locktime):

```
$env:FUNDING_WIF="..."
$env:ESCROW_PATH="refund"
$env:ESCROW_SATS="5000"
npm run escrow
```

The buyer needs confirmed coins for the locked amount plus the lock fee. The complete-fee payer (buyer by default) also needs a little extra for that second tx (default 1 sat/kB). Same optional `NETWORK` / `ARC_URL` / `ARC_API_KEY` / `INDEXER_BASE_URL` as the anchor example.
