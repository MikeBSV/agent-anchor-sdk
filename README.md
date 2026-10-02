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
console.log('FUNDING_WIF', funding.toWif())
console.log('funding address', funding.toAddress('testnet'))
console.log('IDENTITY_WIF', identity.toWif())
console.log('identity address', identity.toAddress('testnet'))
```

Type `.exit` when done. Store the WIFs privately. Send tBSV only to the **funding address**.

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

- **Complete:** buyer and seller both sign (`SIGHASH_ALL`). The coins go to the seller’s P2PKH.
- **Refund:** after the script locktime, the buyer alone signs. The spending transaction sets `nLockTime` and input `sequence` `0xfffffffe`. The coins go back to the buyer’s P2PKH.

`npm test` mocks both paths. Live testnet (GorillaPool ARC, quoted WIFs):

```
$env:FUNDING_WIF="..."
npm run escrow
```

That locks `ESCROW_SATS` (default 5000) then **completes** to the seller. Generate a throwaway seller unless you set `SELLER_WIF`. Optional: `ESCROW_PATH=refund` (script locktime is one hour ago so the refund can broadcast in the same run), `ESCROW_SATS`, `ARC_URL`, `ARC_API_KEY`. The buyer funding address must have confirmed tBSV for the lock plus two fees.

Do not reuse these WIFs on mainnet.
