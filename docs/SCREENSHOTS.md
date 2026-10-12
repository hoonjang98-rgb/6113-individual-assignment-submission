# Actual Screenshot Evidence

Captured on 5 October 2026 in ordinary desktop Chrome connected to the user-designated assessment profile, except the explicitly labelled Render administration and historical user-provided image. Wallet approvals were performed by the user in MetaMask. These application screenshots do not claim direct inspection of the extension internals. Public-chain receipts and state corroborate the visible outcomes.

| Figure/file under `docs/evidence/screenshots/` | English caption and scope |
|---|---|
| `hosted-pay-create-review.png` | The actual Render HTTPS app reviews SC6113-LIVE-PAY-001, the designated client, issuer and exactly 0.0001 Sepolia ETH before the user approves creation. |
| `hosted-create-recovered.png` | The original creation transaction is recovered without resubmission after the server accepts verified-contract events from a wallet-routed receipt. Invoice #2 is Pending; no duplicate was created. |
| `hosted-pay-review.png` | The designated client reviews invoice #2, exact payment and recipient before wallet approval. A review is not a successful transaction. |
| `hosted-client-paid.png` | Invoice #2 is Paid after the user's hosted MetaMask approval. The client view shows 0.0001 ETH and creation/payment history at blocks 11848236 and 11848266. |
| `hosted-client-paid-reload.png` | Reloading the hosted page preserves authorized client selection; reopening Sent to you reconstructs the same Paid invoice and both activity entries. No further payment control is shown. |
| `hosted-issuer-paid.png` | The issuer sees the same Paid invoice #2, amount, parties and history after the actual app account handoff. No payment or cancellation control is shown. |
| `hosted-cancel-create-review.png` | A distinct 0.0001 ETH request, SC6113-LIVE-CANCEL-001, is reviewed for the same client. This request is reserved for cancellation, not payment. |
| `chrome-issuer-paid-reload.png` | Earlier local-origin ordinary Chrome acceptance: existing invoice #1 remains Paid with its original activity after issuer reload. It was never paid again. |
| `chrome-client-paid-reload.png` | The other authorized account sees the same existing Paid invoice #1 after reload at the local origin. |
| `chrome-disconnected-reload.png` | Actual local-origin Disconnect followed by reload remains disconnected, with no selected account and creation disabled. |
| `chrome-reconnected-balance.png` | After the user reauthorizes both local-origin accounts, the app reconnects on Sepolia and completes a visible balance refresh matching an independent public read. |
| `app-sepolia-paid-user.png` | Historical original user-provided Chrome/MetaMask result for invoice #1, SC6113-PAY-001. Its original provenance remains in sepolia-user-payment-screenshots.json; it is distinct from the hosted invoice #2 evidence. |

The actual hosted payment receipt is `0x1fa4bc20a8f2fbfcea2c6f42ff65e2c8c1f843fe636cb1c4c67c4b8179eac9ad`. `docs/evidence/hosted-payment-verification.json` verifies the exact issuer gain and the client's amount-plus-fee debit. Public browser balances are context, while the adjacent-block reads provide the measured balance comparison.

Local fixture screenshots and historical automated tests are not presented as actual MetaMask results. Actual W05/W06 other-network switching/recovery is excluded by the user's Sepolia-only scope and remains unperformed/unverified. Hosted cancellation and reconnection were subsequently observed and are included below.

## Completed hosted cancellation and recovery

| File under `docs/evidence/screenshots/` | Actual observation |
|---|---|
| `hosted-issuer-cancelled.png` | Issuer sees invoice #3 Cancelled with creation and cancellation activity. No payment or cancellation action remains. |
| `hosted-issuer-cancelled-reload.png` | After issuer reload, #3 is reconstructed as Cancelled with the same two transactions. |
| `hosted-client-cancelled.png` | The designated client sees the same Cancelled request and history. |
| `hosted-disconnected-reload.png` | Explicit Disconnect revoked the site's account permission; after reload the application remains disconnected. |
| `hosted-reconnected-both-accounts.png` | The image shows the reconnected issuer and balance. Its companion DOM record confirms both authorized selector options. The user initially approved one account, then added the second through Switch account; no transaction was requested. |
| `hosted-client-cancelled-reconnected.png` | The reconnected client reconstructs #3 as Cancelled with creation block 11848283 and cancellation block 11848293. |
| `hosted-client-cancelled-reload.png` | Client selection survives a further reload; Sent to you reconstructs #3 and both history entries. |
| `hosted-client-paid-reconnected.png` | After explicit reconnection and reload, the client reconstructs Paid #2 and its two original activity entries. |

The cancellation transaction is `0x57c539676f3c18b31e0b95555873501c85bab2ae404685b1949191abc6cfb1b1`. Independent adjacent-block reads show no client debit and an issuer debit equal only to its fee. The application images contain public coursework addresses and references, no wallet secret or private configuration.

All selected images were reviewed for legibility and secret hygiene. The transient cancellation-review capture was excluded from the selection because parts of its text were incompletely rendered; the actual final cancellation and history screenshots are retained. Original evidence files remain unchanged.

## Post-review resilience revision

| Image | Caption and provenance |
|---|---|
| `hosted-invalid-address.png` | Actual assessment Chrome at the Render HTTPS origin: invalid client address is rejected before wallet signing. SC6113-INPUT-CHECK was entered only into the form; no invoice was created. |

The original 22 selected screenshots retain their original dates. New captures supplement them; they do not repeat the earlier payment or cancellation transactions.

| Supplemental image | Caption and provenance |
|---|---|
| `resilience-client-paid.png` | Actual post-repair assessment Chrome client view of existing Paid #2 and its original events; no new payment. |
| `resilience-client-cancelled.png` | Actual post-repair assessment Chrome client view of existing Cancelled #3 and its original events. |

All supplemental captures were inspected for legibility. Browser DOM records supply the origin, role and activity links; the images do not expose wallet keys or seed phrases.

Administrative dashboard screenshots are omitted from this public copy. Deployment identity and fresh public checks are supplied in PUBLICATION_NOTES.md.
