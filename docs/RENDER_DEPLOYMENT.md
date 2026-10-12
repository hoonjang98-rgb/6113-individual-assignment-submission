# FreelancePay Render Deployment

Status: verified Free deployment at https://freelancepay-059m.onrender.com, source revision `8d0c3a626d2d2809ba537701d0c58feb48266070`, Python 3.12.14, Gunicorn 26.2.0. Automatic deployment is Off. Actual Linux startup, HTTPS APIs and ordinary Chrome/MetaMask hosted journeys passed on 5 October 2026. See `evidence/render-live-deployment.json` and `evidence/hosted-browser-acceptance.json`. The setup procedure below is retained for reproduction. Final assessment documentation was completed after the deployment; runtime files remain identical to the recorded deployed revision.

## Runtime configuration

| Setting | Value |
|---|---|
| Service | Python Web Service |
| Python | 3.12.14 from .python-version |
| Build command | pip install -r requirements.txt |
| Start command | gunicorn --config gunicorn.conf.py wsgi:app |
| Hosting health check | /healthz (process and configuration; no RPC wait) |
| Financial readiness | /api/health (matching chain/runtime required by the UI) |
| Chain | CHAIN_ID=11155111 |
| Contract | CONTRACT_ADDRESS=0xF9c9cA735028b3C9787773383D1C6926B9312C0F |
| Server-side RPC | Set RPC_URL=https://sepolia.gateway.tenderly.co in Render; verified for the existing Sepolia contract, complete invoice history and successful receipts |

The previous PublicNode endpoint returned the correct current invoice state but empty historical logs and missing known receipts during actual acceptance on 5 October 2026. The same reads through the [official Tenderly Sepolia endpoint](https://docs.tenderly.co/node-rpc/rpc-reference) restored both events and successful receipts with matching canonical block hashes. Only the server RPC setting changed; the network, deployed contract, ABI and application source are unchanged. Include invoice history and receipt reads when validating an RPC provider: /api/health establishes chain/runtime readiness, not complete historical availability. Public RPC quotas and outages remain external limitations.

Render provides PORT. Gunicorn binds to 0.0.0.0 at that port, with one worker and four threads. Process logs go to standard output/error. The 60-second worker timeout is not a measured API response guarantee. There is no server wallet, database or persistent invoice ledger. Flask reconstructs records from the verified chain and checks chain/runtime identity.

Render requires a successful HTTP health response within five seconds. The former chain-aware hosting probe could wait longer on an external RPC call. /healthz now checks the responding configured application without contacting RPC; missing configuration returns 503. /api/health still verifies chain/runtime and blocks application financial controls when unavailable. A passing hosting probe is not financial or deployment acceptance. This avoids restarting the application because of a shared upstream outage while preserving the strict financial readiness gate. See [Render health checks](https://render.com/docs/health-checks).

The Blueprint explicitly selects the Free plan and disables automatic deployment on later commits. Inspect the actual account and service plan before creation. If a service named freelancepay already exists, use a reviewed distinct name rather than applying this Blueprint to an unrelated service. Do not invent the final onrender.com URL or assume a repository branch. Render's Blueprint uses its own linked branch when none is specified.

The official setup uses a requirements build and Gunicorn: [Render Flask guide](https://render.com/docs/deploy-flask). Python pinning is documented in [Render Python versions](https://render.com/docs/python-version). Service, health-check and deployment fields are in the [Render Blueprint reference](https://render.com/docs/blueprint-spec); worker settings are in [Gunicorn settings](https://gunicorn.org/reference/settings/).

## Local candidate and verification

From the prepared development environment run:

```powershell
.\.venv\Scripts\python.exe tools/prepare_render.py
```

This writes a timestamped deployment candidate ZIP under .tmp/render-preparation and its file manifest under docs/evidence. It copies only the reviewed runtime/source allowlist and checks Solidity, ABI, build and existing deployment identity. The candidate includes this guide and the necessary generated build/library assets. It excludes local .env, signing secrets, virtual environments, node_modules, temporary files, unrelated course work and the original assignment document. It is a deployment candidate, not the final submission archive or the full development/test checkout.

Extract into a fresh directory and install requirements in a fresh environment. Configure the three public chain variables through the environment. On Linux, run the exact Gunicorn start command and inspect both /healthz and /api/health; on Windows, importing wsgi:app or exercising its HTTP behavior does not validate Gunicorn's Linux process startup. Keep that distinction in the preparation evidence.

No Node build is needed during Render startup because the matching build, ABI and vendored ethers bundle are included. If the contract or build changes, independently reconcile the public runtime before publication. Do not redeploy or repay the existing Paid invoice merely to test hosting.

## Publication and live acceptance

1. Confirm the intended dedicated repository, ownership/access, root and visibility. Publish only the reviewed file set. Do not commit/push the parent course directory or supply passwords/API keys in chat.
2. Create the reviewed Python Web Service from that repository using the Blueprint or the identical dashboard settings. Enter RPC_URL in Render. Keep local .env out of the repository. Retain the service/version reference and build/start logs.
3. Use the actual assigned HTTPS URL. Check /, static assets, /api/config and /api/health. Confirm source/ABI/chain/contract identity and the independent matching deployed runtime. Read invoice #1, both account lists, creation/payment history and the existing successful payment receipt.
4. Connect MetaMask to the new HTTPS origin; localhost permission does not cover it. Run the distinct small invoice journey described in the README, recording exact roles/value, successful receipts and actual UI outcomes. Verify both-role reload and fresh-session reconstruction. Do not pay #1 again.
5. Update the verified URL and deployed-version record only after live checks pass. Preserve unresolved actual wallet checks instead of using a fixture as their replacement. Final report/package production follows the Phase 9 gate.

The Free tier can sleep after inactivity and has startup and usage constraints; its filesystem is ephemeral. These are documented limitations, not measured application uptime or a reason to add a database. Record actual live observations separately. See [Render Free services](https://render.com/docs/free).

The bounded read-recovery revision is described in `evidence/resilience-repair.json`. Only the existing Free service was redeployed; no new contract or paid service was created.
