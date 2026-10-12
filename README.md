# FreelancePay

An educational financial DApp for freelancers and designated clients: create an invoice, pay its exact Sepolia ETH amount, or cancel an unpaid request. Solidity enforces roles and final states; Flask supplies chain-backed reads; MetaMask signs transactions.

**[Open the live app](https://freelancepay-059m.onrender.com/) · [Read the PDF report](output/pdf/FreelancePay_Report.pdf) · [Download the submission](https://github.com/hoonjang98-rgb/6113-individual-assignment-submission/releases/tag/submission-v4)**

**SC6113 final public submission v4.** Public repository: https://github.com/hoonjang98-rgb/6113-individual-assignment-submission. Start here on GitHub. After downloading and extracting the full ZIP, `START_HERE.html` provides an offline clickable assessment guide; GitHub displays that HTML as source.

| What to inspect | Location |
|---|---|
| Required source and ABI | `contracts/`, `abi/`, `app.py`, `chain_service.py`, `templates/`, `static/` |
| 7-page English report, 13 assignment topics | [Report](output/pdf/FreelancePay_Report.pdf) |
| Actual screenshots and captions | [Screenshots](docs/SCREENSHOTS.md) |
| Requirements and marking evidence | [18 requirements, 5 learning objectives, 22 checks, 100-point rubric](docs/FINAL_AUDIT.md) |
| Submission contents and hashes | [Submission index](docs/SUBMISSION_INDEX.md), ZIP `MANIFEST.json` and `SHA256SUMS.txt` |
| Publication privacy changes and new verification | [Publication notes](docs/PUBLICATION_NOTES.md) |

## Assess the existing results without signing

Start with these public, read-only results (no wallet connection required):

- [Service health](https://freelancepay-059m.onrender.com/healthz) and [Sepolia readiness](https://freelancepay-059m.onrender.com/api/health).
- [Invoice #2: Paid](https://freelancepay-059m.onrender.com/api/invoices/2) and [invoice #3: Cancelled](https://freelancepay-059m.onrender.com/api/invoices/3).
- [Actual browser screenshots](docs/SCREENSHOTS.md) and [receipt/payment evidence](docs/evidence/hosted-payment-verification.json).

Invoice #1 is already Paid; do not pay it again. These public examples retain their original transaction records. To try the interface with your own accounts, follow the optional workflow below using a fresh reference.

### Optional interactive assessment

Use your own desktop Chrome with MetaMask. Codex, the developer's profile and a local server are not required for assessment. Render Free instances may take 50 seconds or more to wake after inactivity. Wait for the application and chain-readiness message before interacting.

1. Select **Sepolia** in MetaMask and connect the site. Use two different test accounts with Sepolia ETH for their fees; the client also needs the invoice amount. No real funds are required.
2. Choose the issuer under **Account for this app**, then **Create invoice**. Enter the designated client's public address, a unique 1-32-character printable ASCII reference and a positive exact decimal amount. References and amounts are public; do not enter personal information.
3. Review the parties and amount, then confirm creation in MetaMask. Creation records a request and consumes a network fee; it does not transfer the requested payment.
4. Open the Pending invoice and choose **Switch to client wallet**. If that account is already authorized, the app selects it; otherwise connect it in MetaMask. Review payment and approve it once. The exact amount is transferred to the issuer in that transaction, with a separate network fee charged to the sender.
5. Confirm the Paid status and creation/payment history. Switch to the issuer and reload to inspect the same record. Paid and Cancelled are terminal states with no further payment/cancellation controls.
6. To demonstrate cancellation, create a separate Pending request and cancel it as its issuer. Cancellation consumes a fee but transfers no invoice payment. Inspect the Cancelled status in both roles.
7. **Disconnect** revokes site account permission where supported and clears the app's active account. Reload stays disconnected. **Connect MetaMask** requests explicit reconnection; **Check connection** reads already-approved permission without submitting another request.

Existing invoice #1 (`SC6113-PAY-001`) is already Paid: inspect it only. The hosted validation uses separate references `SC6113-LIVE-PAY-001` and `SC6113-LIVE-CANCEL-001`; do not reuse them for another demonstration. Choose fresh references for new requests.

If a transaction's outcome is uncertain, retain its visible hash and use **Check again**. Do not recreate or repay it. A wallet may route execution through another contract; the backend accepts such a successful receipt only when the verified FreelancePay contract emits a recognized invoice event. Unmined routed calls remain unknown. An unrelated or failed routed transaction without that evidence is not claimed as a successful invoice operation.

For read-only assessment without a wallet, use the links in START_HERE.html to inspect existing #2 Paid and #3 Cancelled records, histories and transaction receipts. A fresh wallet will not see those parties' invoices in its own list. JSON is the public API response, not a login error. On Etherscan the routed payment has outer Value 0 ETH; Internal Transactions show the 0.0001 ETH transfer through FreelancePay to the issuer.

## Verified deployment

| Item | Value |
|---|---|
| Chain | Ethereum Sepolia, 11155111 |
| Contract | `0xF9c9cA735028b3C9787773383D1C6926B9312C0F` |
| Hosting | Render Free Python Web Service, Oregon |
| Python / Gunicorn | 3.12.14 / 26.2.0 |
| Runtime repository | `hoonjang98-rgb/6113-individual-assignment`, private, `main`, repository root |
| Deployed revision | `8d0c3a626d2d2809ba537701d0c58feb48266070` |
| Build | `pip install -r requirements.txt` |
| Start | `gunicorn --config gunicorn.conf.py wsgi:app` |
| Automatic deployment | Off |
| Hosting / chain checks | `/healthz` / `/api/health` |

This public repository is an assessment snapshot; Render continues to use the existing private runtime repository. [Publication checks](docs/PUBLICATION_NOTES.md) record comparison of executable files against that deployed revision. A private GitHub login is not required to assess this submission.

The deployment record is `docs/evidence/render-live-deployment.json`. It identifies the service, actual Linux startup, source revision and HTTP evidence. The private runtime repository contains deployment files, while the submission package also supplies tests, tools and assessment evidence. No access to that private repository is required to run an extracted submission. Etherscan has not published the contract source; its Contract tab currently shows bytecode. The source and ABI are included here, and "verified" refers to exact build/deployment identity, not an explorer verification badge.

The unchanged Solidity source, ABI and existing deployed bytecode have recorded identity in `docs/evidence/sepolia-deployment.json`. Do not deploy another contract simply to assess the app. A successful `/healthz` proves a responding configured process; `/api/health` additionally checks the expected network and bytecode. Invoice history and receipt reads are separate availability checks.

## Install and rebuild from source

Download the release ZIP and extract it, or clone this public repository. Run commands from the folder containing `app.py` and `package.json`. The repository and release contain the same assessment payload; ZIP manifests are generated separately.

Prerequisites: Python 3.12, Node.js 24, pnpm 11.19.0 and installed desktop Chrome. Run these PowerShell commands from the extracted `freelancepay` project root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
pnpm install --frozen-lockfile --ignore-scripts
node tools/build.mjs
```

On Linux/macOS:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
pnpm install --frozen-lockfile --ignore-scripts
node tools/build.mjs
cp .env.example .env
# Edit .env using the public settings below.
.venv/bin/python app.py
```

Use `.venv/bin/python` instead of `.\.venv\Scripts\python.exe` in subsequent Python commands. Windows uses `Copy-Item .env.example .env`. Desktop Chrome is required by browser fixtures on all platforms; no personal browser profile is used. `requirements.txt` pins direct application dependencies; `requirements-dev.txt` adds pytest and the tested `constraints-dev.txt` version constraints; `pnpm-lock.yaml` locks the build/test dependency graph; `pnpm-workspace.yaml` pins the repaired `solc>tmp` dependency without changing the compiler. Anvil is supplied by the pinned `@foundry-rs/anvil` package. The build generates ABI, contract artifacts and the vendored ethers 6.17.0 browser bundle/license. Compare generated files with the supplied hashes before connecting rebuilt code to the existing deployment.

## Configure and run locally

Copy `.env.example` to `.env` and set the three public configuration values:

```dotenv
CHAIN_ID=11155111
RPC_URL=https://sepolia.gateway.tenderly.co
CONTRACT_ADDRESS=0xF9c9cA735028b3C9787773383D1C6926B9312C0F
```

This public Sepolia endpoint was verified for code, state, complete history and known receipts. Provider quotas/outages can still interrupt reads. Explicit public reads retry recognized transient HTTP/transport failures at most twice across the whole API request. The scheduling budget is 20 seconds, each transport timeout at most four seconds; underlying socket/DNS behavior is not a hard wall-clock guarantee. Backoff is 0.25/0.5 seconds unless a valid Retry-After applies. Delays above two seconds or beyond the remaining budget fail visibly instead of retrying early. Permanent HTTP, certificate and JSON-RPC errors are not retried; missing history still fails closed. Wallet signing/submission is never retried. Logs contain safe method/status diagnostics, never upstream URLs or response bodies. The previous PublicNode endpoint returned empty history and missing known receipts during acceptance; the verified endpoint correction is recorded separately. RPC settings remain server-side. Never put a wallet key or seed in configuration or source.

For a foreground local server:

```powershell
.\.venv\Scripts\python.exe app.py
```

Open `http://127.0.0.1:5000`. To start or reuse the Windows background launcher on port 8765 instead, use `./tools/start-app.ps1`. It checks deployment/configuration identity, writes process/log information under `.tmp`, and refuses to replace an unrelated listener. Localhost and the Render HTTPS origin need separate wallet connection permission.

Production runs the Gunicorn command in the deployment table on Linux. Do not expose the Flask development server as a production service. `render.yaml` provides equivalent Free service settings; supply `RPC_URL` in Render and keep automatic deployment Off. No database or persistent local invoice files are needed.

## Reproduce the checks

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q
.\.venv\Scripts\python.exe -m pytest tests/test_api.py -q
.\.venv\Scripts\python.exe -m pytest tests/test_rpc_resilience.py -q
node tests/browser.mjs
node tests/connected-accounts.mjs
node tests/input-boundaries.mjs
```

Contract/API/browser tests start/stop disposable loopback Anvil instances. Transport tests use deterministic faults and one loopback HTTP server without Anvil or public RPC. Browser fixtures also run an isolated Flask server and an injected wallet; they do not use personal MetaMask accounts or public test funds. If executable discovery requires it, set `NODE_BINARY` and `PYTHON_BINARY` to your installed executable paths. Run checks in a separate extraction: browser scripts write their result JSON under docs/evidence and may replace the copied historical records there. Preserve the supplied archive unchanged.

The historical baseline is 37 contract cases, 28 API cases and 31 browser scenario groups, plus 14 account-selection and 22 input-boundary cases. The routed-receipt repair added four API cases; its 32-case API suite passed. The initial extracted package reran its five suites successfully: 37 contract, 32 API, 31 browser groups, 14 account-selection and 22 input-boundary checks. The subsequent resilience repair adds two API cases (34 current) and 28 transport cases. The historical examiner extraction reran the six main suites at those current counts. The v4 fresh run is reported separately in [publication reproduction](docs/evidence/publication-reproduction.json). Dates and environments remain attached to the individual evidence records. Actual ordinary Chrome/MetaMask acceptance is recorded separately from fixtures. Actual W05/W06 other-network switching and recovery were excluded by the user's Sepolia-only scope; they were not performed and are not passed. Simulated network-guard checks remain separate and the runtime guard is retained.

The additional supplied checks are:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_deployment_verification.py tests/test_connection_reporting.py -q
node tests/deployment-browser.mjs
node tests/wallet-account-details.mjs
node tests/wallet-connection-browser.mjs
node tests/wallet-connection-recovery.mjs
```

## Files and evidence

| Path | Purpose |
|---|---|
| `contracts/FreelancePay.sol` | Rules, role authorization, exact payment and terminal states |
| `abi/FreelancePay.json`, `build/FreelancePay.json` | Matching generated ABI/compiler/bytecode identity |
| `app.py`, `chain_service.py` | Flask routes and public chain reads, no signing endpoints |
| `templates/index.html`, `static/app.css`, `static/app.js` | English UI, validation, wallet operations and recovery |
| `static/vendor/` | Pinned ethers bundle and upstream license |
| `wsgi.py`, `gunicorn.conf.py`, `.python-version`, `render.yaml` | Production runtime settings |
| `tests/`, `tools/` | Rebuild, test and reproduction tools |
| `docs/evidence/` | Dated results with distinct fixture, browser and chain provenance |
| `docs/SUBMISSION_INDEX.md`, `docs/FINAL_AUDIT.md` | Final file mapping and readiness audit |
| `docs/SCREENSHOTS.md` | Captions and provenance for the selected actual screenshots |
| `docs/REPORT_FINAL.md`, `output/pdf/FreelancePay_Report.pdf` | Final English report source and PDF |

The optional deployment helper (`tools/deploy_server.py`, `tools/deploy/`) documents contract deployment reproduction and is not part of the hosted app. It signs only through the user's wallet and has no key storage. Do not run it on the same port as the application or redeploy the verified contract during normal assessment.

## Report and package reproduction

Optional PDF generation uses separate dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-report.txt
.\.venv\Scripts\python.exe tools/build_report_draft.py --stage final
```

Final mode reads `docs/REPORT_FINAL.md`; it preserves the historical draft. A successful build is not a visual review or readiness decision. Render and inspect every PDF page after changes.

`docs/submission-files.json` is the explicit packaging allowlist. `python tools/prepare_submission.py` checks required files and source/build/deployment identity without assembling a ZIP. `python tools/prepare_submission.py --assemble` writes a new candidate ZIP with `MANIFEST.json`, `SHA256SUMS.txt` and a separate ZIP hash. It excludes private configuration, installed environments and unrelated work. Extract the exact candidate into a fresh directory, install dependencies, rebuild, run the checks above, compare assets and run the app before marking it final. School upload remains user-operated.

## Limits and attribution

This is testnet coursework, without escrow, refunds, disputes, token issuance or production custody. Addresses, invoice references, amounts and events are public and durable. Control of a wallet does not prove legal identity or completed work. A mined receipt is not protocol finality; the app does not track finalized blocks or implement reorganization recovery. Security tests and matching bytecode do not constitute an external security audit. Free hosting, public RPC and the user's wallet/device remain dependencies.

The project was developed with Codex assistance. The English report explains the design, measured results and limitations, and cites primary references. Reused ethers code retains its license. No database materials or demo/video are included under the selected design and current instruction baseline (which explicitly removes video).
