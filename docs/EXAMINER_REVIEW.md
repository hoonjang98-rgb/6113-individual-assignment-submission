# Examiner-Perspective Review - 5 October 2026

**Decision:** The required source types, ABI, Render link, seven-page English PDF, README and actual screenshots are present. Fresh installation, rebuild, app execution and the six main suites passed. No additional application defect or missing mandatory deliverable was found in this review. Documentation and assessment-access issues were corrected for the v3 package. This is an internal review, not a predicted grade, formal security audit or guarantee of future external availability.

## Findings and corrections

| ID | Finding | Resolution |
|---|---|---|
| E01 | The newly supplied DOCX differs from the stored older copy at paragraph 81: it explicitly removes video. | Current baseline hash and all 100 paragraphs rechecked; current extract included. Old provenance remains historical. Database is optional and unused. |
| E02 | V14 still said 32 API cases while the repaired implementation has 34; older package outcomes and open F01 wording could appear current. | Current audit/counts/release paths reconciled; the old review is clearly marked historical and superseded. F01 remains recorded as repaired, with outage limits. |
| E03 | A first-time assessor had to locate many plain-text evidence filenames; a new wallet does not list other parties' examples. | Added offline START_HERE.html: report/source/E1-E9 links, full captions and original images, public read-only state/history/receipt routes and full README text. Explained fresh-account behavior and how to perform a new workflow safely. |
| E04 | Etherscan source is not published; wallet-routed payment has outer Value 0 ETH and does not appear in the contract's direct-transaction list. | Explained the correct internal-transfer/receipt path and source location. Exact source/build/runtime matching is distinguished from an explorer verification badge. No source publication was required by the provided instructions or performed. |

The report's content and application runtime already matched the evidence, so the seven-page PDF, contract, ABI and deployed revision were preserved. The v3 changes concern navigation, current documentation and new audit evidence. Historical screenshots and logs retain their original dates and meanings.

## What was directly checked

1. **Source instructions:** The exact new DOCX SHA-256 is `c57204513dec5681dc53ec645c4b564b3336f1ab9fe7b3f55fca0f67fc05a180`. All 100 nonempty OOXML paragraphs were read; no extra header/footer/comment/note/media parts exist. The source notice requires Solidity, ABI, Python Flask, HTML, CSS, JavaScript and Render link, with no demo/video. The DOCX itself could not be rendered locally because the bundled LibreOffice executable is unavailable; no claim of its layout inspection is made. It is an input guideline, not a submitted report.
2. **Original v2 package:** CRC, safe paths, every one of 167 payload hashes/sizes, UTF-8 text, JSON/XML/SVG, Python AST, all 28 PNGs and the unencrypted seven-page PDF were read. All actual Markdown file links resolved. This is the exact submitted candidate, not the working directory.
3. **Fresh source reproduction:** New Python venv, pip cache and pnpm store; no installed environment was copied. Official dependency installation, pip check, frozen dependency install and build passed. ABI, compiler/bytecode artifact and vendored browser assets were identical. All 17 deployed runtime/source/configuration files matched revision `8d0c3a626d2d2809ba537701d0c58feb48266070`.
4. **Main tests:** Contract 37, API 34, transport 28, browser 31 scenario groups, authorized account selection 14 and input boundaries 22 all passed. Categories have different granularities and should not be added into an invented test-coverage percentage. Optional helper checks are separate: 19 Python tests plus four existing isolated browser scripts passed. No actual other-public-network switch or new public transaction was made.
5. **Local execution:** A new Flask process from the extracted files returned the expected result for 11 HTTP checks using public Sepolia configuration. This is a fresh Windows run. Linux/Gunicorn execution is separately evidenced by actual Render deployment, not by a claim that Gunicorn runs on Windows.
6. **Live availability and integrity:** 18 bounded HTTPS reads passed; original hosted receipts remained successful in canonical blocks; runtime bytes, API ABI and static assets matched. This is not a load test or future uptime guarantee. assessment Chrome restored the already-approved issuer/client; existing Paid/Cancelled details and histories were observed without a new signing request. The in-app browser also displayed the disconnected initial screen and waiting-for-connection guidance; no approval was supplied there, and that tab was closed. This is not an actual no-provider or new-wallet acceptance claim.
7. **Links and content:** Nine report references and four additional primary documentation pages returned readable content. Six existing invoice transaction pages visibly showed Success in Chrome; the contract address and bytecode pages opened. One explorer navigation initially exceeded the tool wait but the loaded page was subsequently readable. The private repository is deliberately private and is not required to grade or execute the submitted source. Loopback URLs require the local app; RPC URLs are programmatic POST endpoints.
8. **Report and images:** All seven PDF pages were viewed again. Thirteen required topics, diagram, actual screenshot, figures/captions, results, limitations and nine references are present. Text is selectable; no page overlap, missing figure or clipped report content was found. The source regenerated identical text/links and seven identical Poppler page images. All 28 selected PNGs decoded and were visually screened; tall full-page captures should be opened at full resolution and zoomed. No visible seed or wallet key was found.
9. **Source review:** Contract caller/state/value rules, rollback and callback guard; Flask input/chain/runtime/history/receipt checks; frontend integer units, text rendering, account/chain preflight and submitted-hash recovery were reviewed against tests. The server does not sign. No new material issue was found within this internal scope.
10. **Final package:** Final reconciliation checks every allowlisted file, relative HTML/Markdown reference, syntax/structured formats, forbidden paths, credential patterns and deployed/tested-source hashes; its exact ZIP is read back and separately extracted. See examiner-package-audit.json and the adjacent ZIP checksum for the completed result.

The optional helper run initially had 17 passes and two fixture setup errors because the agent sandbox denied a shared Windows Temp directory. A new workspace --basetemp resolved the environment issue, with 19 passes and no source change. An upstream websockets deprecation warning and a denied optional pytest-cache write were warnings, not failed assertions. They are not presented as application defects.

The browser tool rejects file:// navigation. The offline guide therefore has structural, syntax and complete relative-target validation, but direct local-file browser rendering was not verified by this tool; no bypass was attempted. This limitation does not apply to the hosted UI or the fully rendered PDF. It is not evidence that the guide fails in an ordinary browser.

## Rubric assessment

| Criterion | Weight | Evidence strength and boundary |
|---|---:|---|
| Problem definition and objectives | 10 | Concrete freelancer/client need, six observable project objectives and outcome table. Scenario is a design argument; no invented user research. |
| Smart contract design | 20 | Clear state machine, precise roles/value checks, atomic settlement, bounded reads and adversarial cases. Formal verification is not claimed. |
| DApp functionality | 25 | Actual create/pay/cancel and shared history corroborated by successful receipts and exact balances. Real extension rejection/replacement and other-network switching are not claimed as observed. |
| Frontend UI | 10 | Readable English workflows, account/role handoff, review/error states and selected responsive checks. No full accessibility or participant usability certification. |
| Backend integration | 10 | Real Flask public APIs, expected-chain/runtime checks and Linux deployment; sanitized bounded read recovery. RPC/Free hosting remain dependencies. |
| Testing and evaluation | 10 | Raw fixture, public-chain, actual-wallet and fresh-package evidence, scoped gas/latency results. No representative user study, load benchmark or all-platform install claim. |
| Report quality | 10 | Required 13 topics and 5-8-page constraint met with seven total pages; actual figures/references and attribution. Page 6 is dense but readable. |
| Innovation and creativity | 5 | Coherent freelancer reference/designated-client/exact-settlement/recovery workflow. Originality and sophistication remain examiner judgments; a suggested project topic alone does not guarantee full creativity marks. |

There is evidence for every mapped 18 requirement, five learning objective and 22 verification route. A route with an explicit scope exclusion is not relabelled as a passed actual test. The provided assignment does not explicitly demand the excluded other-network switching, participant research, escrow, a token, a database, video or an explorer source-verification badge. Adding those would not repair an established omission.

## Remaining submission actions

- Review and understand the source and report; verify any separate course requirements for student name/ID, file naming or AI-use declarations. Assistance is disclosed. No additional course policy was supplied, so compliance with unseen rules cannot be certified.
- Confirm the exact calendar deadline/timezone. The observed portal title says week 6 Sunday 23:59, but its due-date field says No due date. The observed maximum is 500 MB and attempts are unlimited.
- Upload the final v3 ZIP, the PDF if a separate field is requested, and the Render URL in the appropriate text/link field. Preserve the receipt or submission-complete screen. No school submission was made by this review.

Free-service wake-up, public RPC availability, Internet connectivity, installed wallet behavior and individual computer prerequisites can affect later assessment. The evidence reports what was checked on this date rather than promising that every possible future environment will work.
