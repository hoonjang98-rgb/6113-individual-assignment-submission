"""Assemble a reviewed local Render candidate; never publishes or signs."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    '.python-version', '.gitignore', '.env.example', 'requirements.txt',
    'wsgi.py', 'gunicorn.conf.py', 'render.yaml', 'app.py', 'chain_service.py',
    'contracts/FreelancePay.sol', 'abi/FreelancePay.json', 'build/FreelancePay.json',
    'templates/index.html', 'static/app.js', 'static/app.css',
    'static/vendor/ethers.min.js', 'static/vendor/ethers.LICENSE.md',
    'docs/RENDER_DEPLOYMENT.md',
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    artifact = json.loads((ROOT / 'build/FreelancePay.json').read_text(encoding='utf-8'))
    abi = json.loads((ROOT / 'abi/FreelancePay.json').read_text(encoding='utf-8'))
    deployment = json.loads((ROOT / 'docs/evidence/sepolia-deployment.json').read_text(encoding='utf-8'))
    source_hash = sha256((ROOT / 'contracts/FreelancePay.sol').read_bytes())
    if abi != artifact['abi'] or source_hash != artifact['sourceSha256']:
        raise ValueError('Source, build and ABI identity disagree.')
    if source_hash != deployment['sourceSha256']:
        raise ValueError('Current source does not match the verified public deployment.')
    runtime_hash = sha256(bytes.fromhex(artifact['deployedBytecode'].removeprefix('0x')))
    if runtime_hash != deployment['runtimeSha256'] or artifact['compiler'] != deployment['compiler']:
        raise ValueError('Build runtime/compiler identity differs from the verified public deployment.')
    if artifact['settings'] != deployment['compilerSettings']:
        raise ValueError('Compiler settings differ from the verified public deployment.')
    if deployment['chainId'] != 11155111 or deployment['contractAddress'].lower() != '0xf9c9ca735028b3c9787773383d1c6926b9312c0f':
        raise ValueError('The verified public deployment differs from the prepared configuration.')
    if (ROOT / '.python-version').read_text(encoding='utf-8').strip() != '3.12.14':
        raise ValueError('Review a changed production Python version before preparing a candidate.')
    payload = {}
    for name in FILES:
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError(f'Candidate file is missing or outside the project: {name}')
        payload[name] = path.read_bytes()

    now = datetime.now(timezone.utc)
    target = ROOT / '.tmp/render-preparation'
    target.mkdir(parents=True, exist_ok=True)
    archive = target / f'freelancepay-render-candidate-{now.strftime("%Y%m%dT%H%M%S%fZ")}.zip'
    with ZipFile(archive, 'x', compression=ZIP_DEFLATED) as bundle:
        for name, data in payload.items():
            bundle.writestr(name, data)
    with ZipFile(archive) as bundle:
        if sorted(bundle.namelist()) != sorted(FILES):
            raise ValueError('Archive does not match the reviewed allowlist.')
        for name, data in payload.items():
            if bundle.read(name) != data:
                raise ValueError(f'Archive file differs from the reviewed source: {name}')

    result = {
        'recordedAtUtc': now.isoformat(), 'status': 'Prepared; not deployed',
        'scope': 'Allowlisted runtime/source deployment candidate. Not the final submission archive or complete development/test checkout.',
        'archive': archive.relative_to(ROOT).as_posix(), 'archiveSha256': sha256(archive.read_bytes()),
        'fileCount': len(FILES), 'files': {name: sha256(data) for name, data in payload.items()},
        'sourceSha256': source_hash, 'runtimeSha256': runtime_hash, 'chainId': str(deployment['chainId']),
        'contractAddress': deployment['contractAddress'], 'deploymentTransactionHash': deployment['transactionHash'],
        'excluded': ['Local .env and credentials', 'Virtual environments', 'node_modules', 'Temporary/cache files',
                     'Other course projects', 'Original assignment document', 'Personal wallet/browser state'],
        'pending': ['Integration gate closure', 'Identified account/repository access', 'Actual Linux Gunicorn start',
                    'Live Render URL/APIs and HTTPS-origin MetaMask journey', 'Final report and submission audit'],
    }
    record = ROOT / 'docs/evidence/render-candidate-manifest.json'
    record.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': result['status'], 'fileCount': len(FILES), 'archive': result['archive'],
                      'archiveSha256': result['archiveSha256']}, indent=2))


if __name__ == '__main__':
    main()
