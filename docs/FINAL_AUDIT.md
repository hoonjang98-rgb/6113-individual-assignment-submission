# Final Submission Readiness Audit

Status: **Public v4 verified for publication, based on the examiner-reviewed v3**. The requirement mapping and historical outcomes below retain their 5 October 2026 scope. Current publication checks are recorded in [PUBLICATION_NOTES.md](PUBLICATION_NOTES.md); no school upload is claimed.

This is the assignment coverage audit; earlier dated records retain their historical scope. Basis: the latest supplied SC6113 Individual Assignment(1).docx, SHA-256 `c57204513dec5681dc53ec645c4b564b3336f1ab9fe7b3f55fca0f67fc05a180`, the source/ABI/Flask/HTML/CSS/JS/Render notice, and the user-approved Sepolia-only scope. The current DOCX explicitly says "No video recording needed". Its other 99 paragraphs match the earlier instruction extract; see `sources/assignment-current-20261005.txt`. All 18 requirements, five learning objectives, 22 verification routes and eight rubric categories are accounted for below. This is evidence coverage, not a predicted grade.

Live URL: https://freelancepay-059m.onrender.com. Runtime revision `8d0c3a626d2d2809ba537701d0c58feb48266070`, Python 3.12.14/Gunicorn 26.2.0, Free, automatic deploy Off. Documentation was finalized after deployment; executable runtime identity is compared separately.

## Requirement coverage

| ID | Requirement | Evidence within the stated scope |
|---|---|---|
| R01 | Original financial DApp/problem | Report topics 1-3, 13 explain freelancer problem, objectives and observed outcomes. |
| R02 | Solidity | Source/ABI/build/deployed runtime identity; 37 contract cases. |
| R03 | MetaMask | Actual local assessment W01-W04 and hosted connection, account selection, reload/reconnection; W05/W06 exclusion stated. |
| R04 | Usable UI | English review/status/error controls; actual screenshots, internal desktop/mobile review, 31 browser groups. |
| R05 | Flask integration | 34 API cases and 28 transport cases after bounded read recovery; actual Render Linux/Gunicorn and dated live HTTP evidence. |
| R06 | Blockchain execution | Hosted #2 create/pay and #3 create/cancel: four successful receipts and matching UI. |
| R07 | Contract validation | Caller, amount, reference, ID and terminal-state restrictions in contract tests. |
| R08 | On-chain records | Stored invoice state plus contract events; hosted and independent reads agree. |
| R09 | Confirmation/history | Two roles reconstruct Paid/Cancelled after reload/reconnect; wallet-routed receipt repair verified. |
| R10 | Validation/errors | Contract/API boundaries, 31 browser groups and 22 focused input cases; actual RPC and receipt-recovery issue records. |
| R11 | Authorization | Wallet signatures and contract msg.sender rules; Flask public-read API has no privileged write route. |
| R12 | Vulnerabilities | Internal adversarial callback/reentrancy/rollback/isolation cases; no formal or external security audit claim. |
| R13 | Key protection | Wallet-only signing; final allowlist and secret-hygiene audit; no .env, seeds, key files or installed environments. |
| R14 | Gas optimization | Bounded operations and actual gas/fees; limited local timing study; no unsupported savings claim. |
| R15 | Privacy/ethics | Public reference/address disclosure, irreversibility, separate fees, off-chain trust and privacy limits in report/UI. |
| R16 | Tests/screenshots | Historical fixture results retained; fresh package run and actual assessment hosted screenshots distinctly labelled. |
| R17 | Evaluation | Scoped internal security/usability review, gas and 70 historical HTTP samples; no invented participants or Render benchmark. |
| R18 | Submission/source/Render | All specified source types, live URL, final PDF/README/screenshots, dependencies, clean reproduction and hashes. |

## Learning objectives

| ID | Objective | Evidence |
|---|---|---|
| L01 | DApp/blockchain principles | Report architecture, signing, records, confirmations and trust limits |
| L02 | Solidity design/implementation | Source, ABI, deployment identity and contract tests |
| L03 | Full-stack integration | Hosted Flask, ordinary Chrome/MetaMask and exact settlement |
| L04 | Evaluate security/usability/performance | Scoped tests, walkthrough and measured gas/latency with limits |
| L05 | Practical DeFi application | Actual designated-client payment, shared invoice records and financial limits |

## Verification routes

| ID | Route | Evidence and limits |
|---|---|---|
| V01 | Problem/objective review | Report 1-3 and 13 |
| V02 | Compilation/deployment identity | sepolia-deployment.json; final reproduction |
| V03 | Successful payment | hosted-complete-chain-http.json; hosted-browser-acceptance.json |
| V04 | Input boundaries | Contract/API/browser and 22 input cases |
| V05 | Caller authorization | Contract tests; actual designated-client payment |
| V06 | Duplicate/terminal states | Contract tests; four public read-only InvalidState calls |
| V07 | Invalid ID/order | Contract/API cases |
| V08 | Recipient rollback | Mined revert, unchanged state and retry contract case |
| V09 | Reentrancy | Callback contract cases |
| V10 | Independence/bounds | Contract cases and bounded operations review |
| V11 | State/event integrity | Hosted receipt/history/state and both-role equality |
| V12 | Actual wallet | assessment local and hosted acceptance; W05/W06 expressly excluded |
| V13 | Transaction lifecycle | Fixture rejection/pending/revert/unknown; actual successful routed recovery. Actual rejection/replacement not claimed. |
| V14 | Flask boundaries | 34 API cases and 28 RPC transport cases; actual Linux/HTTPS integration |
| V15 | History/recovery | Actual two-role reload and explicit reconnect |
| V16 | Errors | Fixture fault matrix and actual RPC/receipt recovery; no exhaustive extension-edge-case claim |
| V17 | Usability | Internal task/desktop/mobile/contrast review and actual walkthrough; no full accessibility or participant study |
| V18 | Render | Verified Free service, Linux/Gunicorn, HTTPS and actual wallet journeys |
| V19 | Performance/gas | Historical scoped measurements and actual four hosted receipts; no Render load benchmark |
| V20 | Ethics | Final report/UI review |
| V21 | Secrets/package | Final allowlist/text/image audit |
| V22 | Final reproducibility | Fresh extracted package install/build/tests/start/report and manifest audit |

## Rubric evidence

| Criterion | Marks | Evidence |
|---|---:|---|
| Problem and objectives | 10 | Report 1-3 and measured conclusion |
| Contract design | 20 | State/role/value rules, adversarial cases and gas explanation |
| Functionality | 25 | Actual create/pay/cancel, shared history and recovery |
| UI | 10 | Actual English screens, reviews, role selection and internal usability checks |
| Backend | 10 | Flask public reads, input/RPC boundaries and real Linux/Gunicorn |
| Testing/evaluation | 10 | Raw historical/fresh/actual records with provenance and limits |
| Report | 10 | Seven total pages, all 13 topics, nine primary references, visually inspected |
| Creativity | 5 | Freelancer reference, designated client, exact-value settlement and recoverable shared evidence |

## Current examiner review

Start with the offline `../START_HERE.html` after extracting the complete ZIP. It links the report, source, E1-E9 evidence, actual screenshots and public read-only inspection paths. The new `EXAMINER_REVIEW.md` explains findings, fixes and grading boundaries.

The current review extracted the exact v2 submission into a fresh Windows folder, installed new dependencies and reran the README procedures. Contract 37/37, API 34/34, transport 28/28, browser 31/31 groups, account selection 14/14 and input boundaries 22/22 passed. Additional optional helper tests are recorded separately. Eleven HTTP checks from a fresh local process used the public Sepolia configuration. ABI, compiler/bytecode and web assets matched after rebuild. Report reproduction retained the same seven pages, text and reference links. All seven supplied PDF pages were visually reinspected.

Public Render verification passed 18 HTTPS reads and four canonical receipt rechecks at revision `8d0c3a626d2d2809ba537701d0c58feb48266070`. The current assessment Chrome walkthrough is a new read-only observation, separate from the original successful signing/disconnect/reconnect acceptance. No new public transaction was submitted. Current evidence uses the `examiner-` prefix; `resilience-*` documents the prior repair and `final-*` the first release. Historical file paths/statuses describe their own observation dates, not current missing dependencies.

F01 (transient upstream read failures) was addressed by bounded public-read recovery in the previous release. Its original diagnostic and repair evidence remain available. A future provider outage can still cause a visible, sanitized failure; no guarantee of permanent external availability is made. Current runtime source is unchanged by the examiner-navigation/documentation revision.

## Scope and submission conditions

Actual W05/W06 switching to another network and returning were excluded by user scope: **unperformed/unverified, not passed**. The current assignment recommends Sepolia and does not explicitly require another-network switching. The runtime network guard and separate simulated checks remain. Local Anvil is an isolated test fixture, not another public test network.

Paid invoice #1 was only read. The original hosted acceptance created/paid #2 and created/cancelled #3. An evaluator's new wallet has its own empty role lists until it participates in an invoice; public read-only links and supplied evidence allow inspection of the existing examples without sharing wallet secrets. New interactive writes require the evaluator's own two accounts, test ETH and MetaMask approvals.

No database is used; database materials are conditional in the assignment. No video/demo is required under the current DOCX and submission notice. The allowlist excludes private configuration, keys/seeds, installed environments, caches and unrelated coursework.

The school page was inspected read-only: maximum 500 MB, unlimited attempts, text editor and file uploads. The title says week 6 Sunday 23:59, while the due-date field says No due date. The exact calendar deadline remains to confirm against the course schedule. No filename, student-name/ID cover template or AI declaration was shown there; unseen course policies are not certified. Codex assistance is disclosed. The student must review/understand the submission, upload the required files and Render link, and retain the receipt. No school upload is claimed.

## Release lineage

The original ZIP and v2 remain historical releases. The final examiner revision is `FreelancePay_Submission_20261005_v3.zip`, with a separate archive checksum. `MANIFEST.json` and `SHA256SUMS.txt` cover its delivered payload. Current results are in `evidence/examiner-package-audit.json`: archive read-back, tested-source identity and relative guide links passed before release. Earlier v1/v2 archive references identify history, not the file to upload.
