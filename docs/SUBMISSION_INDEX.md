# Submission Index

**Current public submission: v4, available from the [submission-v4 Release](https://github.com/hoonjang98-rgb/6113-individual-assignment-submission/releases/tag/submission-v4).** Earlier ZIPs are retained as history; submit only the selected current release unless the portal requests separate files.

Live Render application: https://freelancepay-059m.onrender.com

Open `../START_HERE.html` after extracting the complete ZIP; then read `README.md` for assessment, installation, configuration, build and test commands. `FINAL_AUDIT.md` is the authoritative completion record; earlier evidence retains its original date and scope.

| Deliverable | Included files |
|---|---|
| D01 Solidity | `contracts/FreelancePay.sol` |
| D02 ABI and matching build | `abi/FreelancePay.json`, `build/FreelancePay.json` |
| D03 Python Flask | `app.py`, `chain_service.py`, `wsgi.py`, `gunicorn.conf.py` |
| D04 HTML | `templates/index.html` |
| D05 CSS | `static/app.css` |
| D06 JavaScript | `static/app.js`, licensed `static/vendor/ethers.min.js` |
| D07 Verified Render URL | This index, README, `evidence/render-live-deployment.json` |
| D08 English report | `REPORT_FINAL.md`, `../output/pdf/FreelancePay_Report.pdf` (7 total pages, 13 topics) |
| D09 Run/rebuild instructions | README, pinned requirements/lockfile, `.env.example`, `tests/`, `tools/` |
| D10 Actual screenshots | `SCREENSHOTS.md`, selected PNGs in `evidence/screenshots/` |
| D11 Database | Not applicable: contract state/events are the data source; no database is used. |
| D12 Demo/video | Not required by the current DOCX or submission notice. |

`submission-files.json` lists the exact payload. Generated `MANIFEST.json` records file sizes and hashes. `SHA256SUMS.txt` covers the payload and manifest; the separate `.zip.sha256` file covers the archive itself. No self-referential archive hash is embedded in its own payload.

Assessment evidence is separated into historical fixtures, actual local/hosted MetaMask observations, independent public-chain/HTTP reads, and fresh final-package reproduction. The report's E1-E9 filenames are supplied under `evidence/`. Historical JSON paths are privacy-edited and are not executable dependencies. Current files are checked by the v4 manifests; original observations retain their own dates and hashes. The private runtime repository is not needed to reproduce the submitted source.

Actual W05/W06 other-network switching/recovery were excluded by the user's Sepolia-only scope and remain unperformed/unverified, not passed. Simulated network-guard coverage is separate. Existing Paid invoice #1 was not repaid; hosted invoice #2 was paid once, while #3 was cancelled unpaid.

School upload is the user's remaining step. Check the course portal's deadline/timezone, required filename/format, size limit and any individual declaration, then upload the final ZIP and any separately requested PDF/link. Keep the actual submission receipt. No upload or receipt is claimed here.

## Quick evidence path for the revised package

1. Read the seven-page report, then README for the live URL and reproduction commands.
2. Use FINAL_AUDIT.md to trace the 18 requirements, five learning objectives and 22 verification routes.
3. Review evidence/hosted-browser-acceptance.json and SCREENSHOTS.md for actual wallet results, distinct from fixtures.
4. Use evidence/resilience-repair.json and evidence/resilience-live-verification.json for the post-review fix; evidence/resilience-package-reproduction.json and evidence/resilience-package-audit.json identify the tested resilience revision. The later examiner rerun is in evidence/examiner-package-reproduction.json; its final archive audit is evidence/examiner-package-audit.json.

The older final-* evidence and unsuffixed 20261005 archive describe the first release. The v2 archive records the resilience repair; the final v3 archive includes the subsequent examiner review and navigation improvements. No additional public transaction was needed for this repair.

The actual portal inspection is recorded in [private administrative/portal record omitted; see PUBLICATION_NOTES.md]: 500 MB maximum and a text field for the live link. Resolve the title/system deadline discrepancy against the course schedule before submission. The ZIP is below that size limit.

Public repository: https://github.com/hoonjang98-rgb/6113-individual-assignment-submission

The Release supplies the final ZIP, PDF and ZIP SHA-256 file. The private runtime repository is not required for assessment.
