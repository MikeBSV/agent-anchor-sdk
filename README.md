# agent-anchor-sdk

TypeScript SDK that writes signed AI-agent audit records to **BSV testnet**. A later check can prove the recorded bytes were not edited. It does not stop an agent from anchoring a false record.

Wire format: [PROTOCOL.md](PROTOCOL.md).

## Install

Node 22+. Dependencies are pinned; `@bsv/sdk` is **2.8.11**.

```
npm test
npm run build
```

## Keys

Keep two keys. The **funding** key pays fees. The **identity** key only signs the AIP trailer. Never derive the optional AES-256-GCM **data key** from either.

Generate them in PowerShell from this folder (`cd C:\Users\mikec\agent-anchor-sdk`), then run `node`, paste:

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
console.log('seller address', seller.toAddress('testnet'))
```

Type `.exit` when done. Store the WIFs privately. Send tBSV only to the **funding address**. The seller address does not need a faucet for these tests.

## Testnet example

ARC is an HTTP API, not a website. Opening the host in a browser often shows `no matching operation was found`. That is normal.

Default broadcast is GorillaPool testnet ARC (no API key): `https://testnet.arc.gorillapool.io`

TAAL’s **API** (`https://arc-test.taal.com`) is up, but their **login dashboard** has been failing DNS (`platform.teranode.group`). Skip TAAL until that console works.

PowerShell from this folder:

```
$env:FUNDING_WIF="..."
$env:IDENTITY_WIF="..."
npm run example
```

Optional:

- `ARC_URL` — default `https://testnet.arc.gorillapool.io` (no `/v1` suffix; the SDK adds `/v1/tx`)
- `ARC_API_KEY` — only if the ARC host requires it
- `INDEXER_BASE_URL` — default `https://api.whatsonchain.com/v1/bsv/test`

Keep the quotes around the WIFs in PowerShell. After the faucet pays you, wait until `https://test.whatsonchain.com/address/<funding-address>` shows the coins (confirmed is more reliable than mempool-only). Then run `npm run example` again. Do not put the address in `FUNDING_WIF`.

The example broadcasts two linked records in one process. The wallet remembers the first spend and its change so the second record does not double-spend a stale indexer UTXO. If a previous run already spent your faucet coin and that tx is still in the mempool, wait for it to confirm (or for its change to appear) before running the example again.

WIFs pasted in this chat or a terminal log are testnet-only. Do not reuse them on mainnet.

## Escrow

`lockEscrow` / `completeEscrow` / `refundEscrow` lock satoshis in a native Bitcoin script (no sCrypt). This package is testnet-only.

`FUNDING_WIF` is the **buyer**. They lock coins, pay both transaction fees, and later either pay the seller or refund themselves. The **seller** only needs a key (and, on complete, to sign). `IDENTITY_WIF` is not used here.

Two on-chain transactions:

1. **Lock** — buyer P2PKH → escrow output of exactly `ESCROW_SATS`, plus change back to the buyer. WoC shows that output as `nonstandard` / ScriptHash. The script locktime is fixed at this moment (Unix time, or a block height if the number is below 500000000). After that time the buyer can refund; until then, if the seller will not sign, the coins wait.
2. **Complete** — buyer and seller both sign (`SIGHASH_ALL`). The seller’s P2PKH receives **exactly** `ESCROW_SATS`. The complete fee is paid from the buyer’s change, not taken out of the seller’s payout.
3. **Refund** — after the script locktime, the buyer broadcasts a refund (`nLockTime` set, escrow input sequence `0xfffffffe`). This does **not** happen by itself. The buyer receives exactly `ESCROW_SATS` back; the refund fee is paid from their other coins.

The live script prints `refund allowed after (unix)` and `(utc)` **before** it broadcasts the lock. Default locktime is **7 days** from now. Cap is **90 days** unless you set `ESCROW_ALLOW_LONG_LOCK=1` (the chain would otherwise accept a 100-year locktime). Set the window with `ESCROW_LOCK_HOURS` or an exact `ESCROW_LOCKTIME`.

`npm test` mocks lock, pay seller, seller-alone fails, early refund fails, on-time refund, second lock from local change, and the 90-day cap.

A run with only `FUNDING_WIF` still works: the script creates a **random seller in memory**, completes to that address, then exits. That address is real testnet P2PKH, but you cannot spend it unless you set `SELLER_WIF`. Use a seller WIF you keep when you want to open the seller on WhatsOnChain.

Lock then complete in one process (buyer you fund, seller you control):

```
$env:FUNDING_WIF="..."
$env:SELLER_WIF="..."
$env:ESCROW_SATS="5000"
$env:ESCROW_LOCK_HOURS="48"
$env:SATOSHIS_PER_KB="1"
npm run escrow
```

Same path with an explicit Unix locktime instead of hours:

```
$env:FUNDING_WIF="..."
$env:SELLER_WIF="..."
$env:ESCROW_SATS="5000"
$env:ESCROW_LOCKTIME="1791570797"
npm run escrow
```

Lock only (so you can wait, then complete in your own code or refund later). Save the printed `lock txid`, `lock vout`, and UTC refund time:

```
$env:FUNDING_WIF="..."
$env:SELLER_WIF="..."
$env:ESCROW_PATH="lock"
$env:ESCROW_SATS="5000"
$env:ESCROW_LOCK_HOURS="48"
npm run escrow
```

Refund an **existing** lock after that time (does not create a new escrow):

```
$env:FUNDING_WIF="..."
$env:ESCROW_PATH="refund-existing"
$env:ESCROW_TXID="..."
$env:ESCROW_VOUT="0"
npm run escrow
```

Instant refund demo (new lock with locktime one hour ago, then refund in the same process):

```
$env:FUNDING_WIF="..."
$env:ESCROW_PATH="refund"
$env:ESCROW_SATS="5000"
npm run escrow
```

The buyer funding address needs confirmed tBSV for the locked amount plus lock fee plus complete/refund fee (default rate 1 sat/kB). Optional: `ARC_URL`, `ARC_API_KEY`, `INDEXER_BASE_URL`, `ESCROW_ALLOW_LONG_LOCK=1`.

Do not reuse these WIFs on mainnet.
