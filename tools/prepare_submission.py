"""Build an allowlisted submission candidate; never certifies readiness or uploads."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = 'docs/submission-files.json'
FORBIDDEN = {'.git', '.venv', 'node_modules', '.tmp', '.cache', '__pycache__',
             '.pytest_cache', '.codex', '.agents', '.aws'}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_allowed(root, name):
    """Only explicit regular files within this project may enter the archive."""
    if not isinstance(name, str) or '\\' in name or ':' in name:
        raise ValueError(f'Invalid package path: {name!r}')
    if name.casefold() in {'manifest.json', 'sha256sums.txt'}:
        raise ValueError(f'Reserved generated path: {name}')
    relative = PurePosixPath(name)
    if (relative.is_absolute() or relative.as_posix() != name
            or any(part in {'', '.', '..'} for part in relative.parts)):
        raise ValueError(f'Invalid package path: {name}')
    for part in relative.parts:
        if (part.lower() in FORBIDDEN or
                (part.lower().startswith('.env') and part != '.env.example')):
            raise ValueError(f'Excluded package path: {name}')
    path = root / name
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f'Path escapes project: {name}')
    for parent in (path, *path.parents):
        if parent == root:
            break
        if parent.is_symlink() or (hasattr(parent, 'is_junction') and parent.is_junction()):
            raise ValueError(f'Linked path is excluded: {name}')
    if not path.exists():
        return None
    if not path.is_file():
        raise ValueError(f'Expected an explicit regular file: {name}')
    return path.read_bytes()


def collect(root, spec):
    groups = spec['groups']
    names = [name for group in groups for name in group['files']]
    if len(names) != len({name.casefold() for name in names}):
        raise ValueError('Duplicate package paths, including case-only variants.')
    payload, missing = {}, []
    for name in names:
        data = read_allowed(root, name)
        if data is None:
            missing.append(name)
        else:
            payload[name] = data
    return payload, missing


def check_identity(payload):
    artifact = json.loads(payload['build/FreelancePay.json'])
    deployment = json.loads(payload['docs/evidence/sepolia-deployment.json'])
    if json.loads(payload['abi/FreelancePay.json']) != artifact['abi']:
        raise ValueError('ABI and build disagree.')
    source_hash = sha256(payload['contracts/FreelancePay.sol'])
    runtime_hash = sha256(bytes.fromhex(artifact['deployedBytecode'].removeprefix('0x')))
    if source_hash != artifact['sourceSha256'] or source_hash != deployment['sourceSha256']:
        raise ValueError('Source/build/deployment identity disagrees.')
    if (runtime_hash != deployment['runtimeSha256']
            or artifact['compiler'] != deployment['compiler']
            or artifact['settings'] != deployment['compilerSettings']
            or deployment['chainId'] != 11155111):
        raise ValueError('Runtime/compiler/Sepolia deployment identity disagrees.')


def write_archive(root, payload, spec):
    now = datetime.now(timezone.utc)
    record = {
        'createdAtUtc': now.isoformat(),
        'status': 'Candidate only; clean reproduction and final audit required',
        'submissionReady': False,
        'groups': spec['groups'],
        'files': {name: {'sha256': sha256(data), 'bytes': len(data)}
                  for name, data in sorted(payload.items())},
        'hashScope': 'SHA256SUMS.txt covers all payload files and MANIFEST.json; the ZIP hash is stored beside the archive.',
    }
    contents = dict(payload)
    contents['MANIFEST.json'] = (json.dumps(record, indent=2) + '\n').encode('utf-8')
    contents['SHA256SUMS.txt'] = ''.join(
        f'{sha256(data)}  {name}\n' for name, data in sorted(contents.items())
    ).encode('utf-8')
    target = root / 'output/submission'
    target.mkdir(parents=True, exist_ok=True)
    archive = target / f'FreelancePay_CANDIDATE_{now.strftime("%Y%m%dT%H%M%S%fZ")}.zip'
    with ZipFile(archive, 'x', compression=ZIP_DEFLATED) as bundle:
        for name, data in sorted(contents.items()):
            bundle.writestr(f'freelancepay/{name}', data)
    with ZipFile(archive) as bundle:
        if sorted(bundle.namelist()) != sorted(f'freelancepay/{n}' for n in contents):
            raise ValueError('Archive file list differs from the allowlist.')
        for name, data in contents.items():
            if bundle.read(f'freelancepay/{name}') != data:
                raise ValueError(f'Archive read-back differs: {name}')
    digest = sha256(archive.read_bytes())
    archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    return {'archive': archive.relative_to(root).as_posix(), 'sha256': digest,
            'payloadFiles': len(payload), 'submissionReady': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assemble', action='store_true', help='Create a candidate only when every listed file exists.')
    args = parser.parse_args()
    spec = json.loads((ROOT / MANIFEST).read_text(encoding='utf-8'))
    payload, missing = collect(ROOT, spec)
    identity_files = {'build/FreelancePay.json', 'abi/FreelancePay.json',
                      'contracts/FreelancePay.sol', 'docs/evidence/sepolia-deployment.json'}
    if identity_files.issubset(payload):
        check_identity(payload)
    if missing:
        print(json.dumps({'status': 'Incomplete; no archive created', 'presentFiles': len(payload),
                          'missingFiles': missing, 'submissionReady': False}, indent=2))
        return 1
    if not args.assemble:
        print(json.dumps({'status': 'Inventory and contract identity checked; no archive created',
                          'presentFiles': len(payload), 'submissionReady': False}, indent=2))
        return 0
    print(json.dumps(write_archive(ROOT, payload, spec), indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
