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

## Testnet example

Unit tests mock ARC and the indexer. The live script talks to the network:

```
set FUNDING_WIF=...
set IDENTITY_WIF=...
set ARC_URL=https://<your-testnet-arc-host>
set ARC_API_KEY=...
npm run example
```

Optional: `INDEXER_BASE_URL` (default `https://api.whatsonchain.com/v1/bsv/test`).

Fund the printed funding address from a BSV testnet faucet (for example a public tBSV faucet). Get an ARC endpoint and API key from your ARC provider; do not assume `https://api.taal.com/arc` is testnet.

The script anchors two linked records (`prevTxid` of the second is the first txid) and verifies both.

## Scope

sCrypt escrow is a follow-up project, not in this package.
