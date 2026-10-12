# Historical Post-completion Review - 5 October 2026

**Historical record, superseded:** F01 is closed within the bounded-recovery scope. The earlier counts, source line numbers, open findings and package size below describe the initial release, not the current package. Read [FINAL_AUDIT.md](FINAL_AUDIT.md) and [EXAMINER_REVIEW.md](EXAMINER_REVIEW.md) for current results.

This review was requested after the initial release. The existing submission ZIP, source, report and deployed service were not modified. It supplements the earlier completion audit with a current live-availability finding. It is not an independent external security audit or a guarantee of marks.

## Decision

The supplied assignment's required artifacts and core implemented features are present. No missing mandatory source type, report topic, page-limit violation, artifact mismatch, incorrect recorded payment, exposed wallet key or prohibited network change was found. However, the statement that only upload remains needs qualification: two live history reads returned 503 during this review. They recovered, but bounded read-side recovery should be considered before submission. School-specific upload and academic conditions remain unverified because they were not supplied.

## Finding F01 - transient upstream HTTP failure reaches the UI

Priority: medium; operational reliability and user experience. At **20:40:10 Singapore time on 5 October 2026**, a read-only probe with at most three concurrent requests produced 503 responses for both `/api/invoices/2/history` and `/api/invoices/3/history`. The Render application log records `Request unavailable: HTTPError` for both. `/healthz`, invoice state, configuration and assets continued to respond.

At 20:40:56-57 both history endpoints returned 200 with their correct original events. A subsequent sequential set of 12 HTTPS reads passed. Independent Sepolia reads confirmed matching runtime and all four successful canonical receipts. No transaction was submitted, wallet permission changed or stored invoice modified during this review.

`app.py:32` explicitly disables web3 HTTP retries. `app.py:108-109` sanitizes the upstream error and returns 503. This prevents false success and secret leakage, but a transient upstream fault requires a manual user retry. The exact upstream HTTP status was not logged; rate limiting is a possibility, not an established cause. The short concurrent probe was not a formal load benchmark.

Recommended next implementation: preserve failure handling and chain/runtime checks, add a small bounded retry/backoff policy only to idempotent public reads for recognized transient HTTP/transport failures, and retain a sanitized upstream status in diagnostics. Respect Retry-After where available. Do not retry wallet signing or transaction submission, and do not retry validation, wrong-chain, contract-mismatch or authorization errors as if they were transient. Verify successful recovery and exhaustion paths, then publish the exact reviewed runtime revision and refresh package hashes if this change is made.

Evidence: [private administrative/portal record omitted; see PUBLICATION_NOTES.md], [private administrative/portal record omitted; see PUBLICATION_NOTES.md], `evidence/post-completion-history-diagnostic.json`, `evidence/post-completion-live-review.json`.

## Work completed and reviewed

| Workstream | Completed work | Review result |
|---|---|---|
| Instruction baseline | Original DOCX, later submission notice, 18 requirements, five learning objectives, 22 verification routes and 100-point rubric | Original DOCX hash and all 100 extracted paragraphs independently rechecked; no extra header/footer/comment/media content parts |
| Product and architecture | Freelancer/client problem, exact-payment objectives, contract state/events as ledger, wallet signing and Flask reads | Report and source agree; database, escrow, token and dispute systems are not mandatory additions |
| Contract | Solidity, caller/value/reference checks, Pending/Paid/Cancelled states, atomic transfer, reentrancy guard, bounded pagination | Source/ABI/compiler artifact/deployed runtime match; raw 37-case evidence supports stated scope |
| Backend | Python Flask configuration, readiness, role lists, invoice details/history and receipt APIs; sanitized failures | Actual APIs used by frontend; 32-case suite; current availability finding F01 applies |
| Frontend | English HTML/CSS/JS, role/account selection, review dialogs, exact integer amounts, status/history, balance and recovery | Relevant state guards and public-data rendering inspected; actual and fixture evidence distinguished |
| Wallet acceptance | Ordinary assessment Chrome connection, authorized issuer/client selection, reload, disconnect and explicit reconnect | Actual local and hosted records inspected; no new signing was requested for this review |
| Deployment | Separate Free Render Python/Gunicorn service, HTTPS, automatic deploy Off, public Sepolia configuration | Current assets, ABI/runtime and recorded deployed revision remain consistent |
| Public workflows | Existing Paid #1 read only; #2 created/paid once for 0.0001 ETH; #3 created/cancelled unpaid | Four recorded successful canonical receipts rechecked; no duplicate or additional public transaction |
| Defects already resolved | Multiple-account selection, hosting probe separation, incomplete-history RPC provider, routed-wallet receipt attribution | Repairs and their scoped tests/evidence inspected; current F01 is a separate remaining resilience concern |
| Evaluation | Authorization, rollback/callback, validation, selected UI/contrast/mobile review, gas and 70 historical HTTP samples | Internal sample limits correctly stated; no participant study, production benchmark or external security certification invented |
| Final report | English PDF with all 13 topics, figures, limitations, nine primary references and attribution | Seven total pages; all pages visually reinspected; PDF/source/hash/reference consistency checked |
| README and screenshots | Setup/run/build/test/deploy/use instructions and 22 selected actual screenshots with captions | Files present; intended reader can use supplied source without private repository access |
| Final package | Fresh extraction/install/build/tests/HTTP/report reproduction, explicit allowlist, ZIP/manifest/hash list | 133 payload files plus two generated manifest/hash members; CRC and every member/hash/current file rechecked |

## Required outputs

| Output | Result |
|---|---|
| Solidity, ABI, Python Flask, HTML, CSS, JavaScript | Included and version-consistent |
| Working Render link | Included; site currently responds; F01 records observed intermittent history failure |
| Final PDF | Seven pages including title material and references; prescribed 13 topics present |
| README | Included; fresh Windows reproduction already passed |
| Screenshots | 22 selected files with English captions; actual wallet evidence is separate from fixtures |
| Dependencies and supporting tools | Requirements, pnpm lockfile, build/test tools, configuration example and generated assets included |
| Database files | Not applicable: database explicitly optional and no database used |
| Demo/video | Correctly omitted under the later notice |

## Test evidence and boundaries

Raw fresh-package records establish 37 contract cases, 32 API cases, 31 browser scenario groups, 14 account-selection checks and 22 input-boundary checks, with passing results. These were inspected with their original timestamps and source hashes; they were not rerun or relabelled as new runs in this review. All 46 recorded tested source/test/tool/dependency hashes match the final ZIP. The prior seven-page rebuilt PDF rendered identically to the supplied PDF.

Actual W05/W06 other-network switching/recovery was not performed. It is not an explicit requirement in the supplied original assignment; its removal from the project's optional acceptance work is consistent with the user's Sepolia-only restriction. Simulated chain-guard testing and local Anvil reproduction do not claim real MetaMask network switching. The guard remains implemented.

No complete formal verification, external audit, full accessibility study, real-participant usability study, load test or all-platform clean installation is claimed. The clean package run was Windows; actual Linux/Gunicorn startup was separately observed on Render.

## Rubric review

| Criterion | Marks | Evidence and quality boundary |
|---|---:|---|
| Problem and objectives | 10 | Concrete freelance invoice problem, six measurable project targets and outcome table; no invented interviews |
| Contract design | 20 | Role/state/value rules, atomic transfer, guard and rollback/adversarial tests |
| Functionality | 25 | Actual creation, settlement, cancellation, status/history and recovery; F01 is the main current reliability concern |
| UI | 10 | Actual readable screens, role handoff/review, error feedback, desktop/mobile internal checks |
| Backend | 10 | Flask serves real verified public reads; source and live responses agree; transient HTTP resilience can improve |
| Testing/evaluation | 10 | Raw local/fixture/actual results and scoped measurements; no unsupported coverage claim |
| Report | 10 | All topics and page constraint met, references and actual evidence present |
| Creativity | 5 | Coherent freelancer workflow and exact-value shared records; novelty and final marks remain examiner judgments |

## Matters still requiring action or confirmation

1. **Recommended technical work:** address F01 with bounded read-side resilience and targeted verification before final upload. Recovery during this review does not prove it cannot recur. Any code change requires an updated deployment identity, affected checks and final package/hash reconciliation.
2. **School upload conditions:** confirm portal, deadline/timezone, accepted archive format, individual file/link fields, filename and size limits. The current ZIP is 1,634,608 bytes; the assignment notice does not establish the portal's upload layout.
3. **Student-specific conditions:** the PDF currently has the project/course title and date, but no student name/ID. The supplied instructions do not require a particular cover or naming format; verify any separate template before adding one and keep the total within 5-8 pages.
4. **Academic conditions:** Codex assistance is disclosed. No separate course AI-use, originality, declaration or reuse policy has been supplied. Compliance with an unseen policy cannot be certified. The student should review and understand the submission and make only accurate declarations.
5. **Assessment access:** a new evaluator wallet will not show the existing parties' invoices in its own role lists. README explains two funded Sepolia test accounts for a new workflow; prior outcomes remain inspectable through the supplied evidence/public chain. Do not share existing wallet secrets.
6. **Final user submission:** upload the required ZIP/PDF/link fields and verify the actual receipt. No university upload has occurred.

## Optional presentation improvements, not established requirement violations

- A single clearly captioned invalid-input screenshot could make the existing 22-case validation evidence easier to assess. The supplied instructions do not explicitly require a separate screenshot for every test category; its absence is not treated as a mandatory missing deliverable.
- Some evidence JSON retains historical local paths and earlier open-gate statuses. These are labelled historical and are not runtime dependencies. A shorter examiner-facing index may improve navigation; the current index already points to the authoritative final audit.

The report, README and ZIP remain unchanged by this review. Review evidence is saved beside them, outside the existing archive. The original native Goal's completed state records the earlier submission-readiness milestone; it does not erase F01 or certify school submission.

## Subsequent authorized repair

The findings above describe the original review time and remain preserved. The user subsequently authorized improvements. F01 has now been implemented and locally verified; current deployment, fresh reproduction and release outcomes are recorded in evidence/resilience-repair.json, evidence/resilience-live-verification.json, evidence/resilience-package-reproduction.json and evidence/resilience-package-audit.json. Follow those dated records for the revised package. This does not retrospectively relabel the initial failures or establish their exact upstream HTTP status.

Repair completion: F01 is closed within the documented bounded-recovery scope. The optional invalid-input screenshot and shorter evidence navigation path have also been supplied. The school page was subsequently inspected (500 MB; title/system deadline discrepancy); see [private administrative/portal record omitted; see PUBLICATION_NOTES.md]. Remaining user actions are calendar deadline/additional policy confirmation and the actual upload/receipt.
