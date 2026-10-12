"""Measure isolated local transactions and read-only Flask HTTP responses."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import sys
import threading
import time
from urllib.request import urlopen

from web3 import Web3
from werkzeug.serving import make_server

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app import create_app


def latency_samples(base, routes, environment):
    results = []
    for name, path in routes:
        samples = []
        for _ in range(5):
            start = time.perf_counter()
            with urlopen(base + path, timeout=45) as response:
                body = json.loads(response.read())
                assert response.status == 200
            samples.append({'elapsedMs': round((time.perf_counter() - start) * 1000, 3),
                            'observedBlock': body.get('observedBlock'),
                            'itemCount': len(body['items']) if 'items' in body else None})
        durations = [sample['elapsedMs'] for sample in samples]
        results.append({'route': name, 'path': path, 'sampleCount': len(samples), 'medianMs': statistics.median(durations),
                        'minMs': min(durations), 'maxMs': max(durations), 'samples': samples})
    return {'environment': environment, 'method': 'Five sequential complete HTTP GET requests per route, including JSON body reading. perf_counter elapsed time; no excluded warm-up, concurrency or capacity claim.', 'results': results}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', default='node')
    parser.add_argument('--public-url', default='http://127.0.0.1:8765')
    args = parser.parse_args()
    artifact = json.loads((ROOT / 'build/FreelancePay.json').read_text(encoding='utf-8'))
    binary = subprocess.run([args.node, str(ROOT / 'tools/anvil-path.mjs')], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    child = subprocess.Popen([binary, '--host', '127.0.0.1', '--port', str(port), '--chain-id', '31337', '--hardfork', 'shanghai', '--silent'],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    server = None
    try:
        rpc = f'http://127.0.0.1:{port}'
        w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={'timeout': 5}))
        for _ in range(100):
            if child.poll() is not None:
                raise RuntimeError('Isolated measurement chain exited')
            if w3.is_connected():
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('Isolated measurement chain unavailable')
        assert w3.eth.chain_id == 31337
        accounts = w3.eth.accounts
        factory = w3.eth.contract(abi=artifact['abi'], bytecode=artifact['bytecode'])
        deployment = w3.eth.wait_for_transaction_receipt(factory.constructor().transact({'from': accounts[0]}))
        assert deployment.status == 1
        contract = w3.eth.contract(address=deployment.contractAddress, abi=artifact['abi'])
        assert w3.eth.get_code(contract.address).to_0x_hex().lower() == artifact['deployedBytecode'].lower()
        receipts = []
        value = 10**14

        def measure(action, function, sender, invoice_id, amount=0):
            start = time.perf_counter()
            tx_hash = function.transact({'from': sender, 'value': amount})
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
            elapsed = (time.perf_counter() - start) * 1000
            assert receipt.status == 1
            receipts.append({'action': action, 'invoiceId': str(invoice_id), 'hash': receipt.transactionHash.to_0x_hex(),
                             'block': str(receipt.blockNumber), 'gasUsed': str(receipt.gasUsed),
                             'effectiveGasPriceWei': str(receipt.effectiveGasPrice), 'sendToReceiptMs': round(elapsed, 3)})
            return receipt

        for sample in range(1, 6):
            pay_id, cancel_id = 2 * sample - 1, 2 * sample
            measure('create', contract.functions.createInvoice(accounts[1], value, f'EVAL-P-{sample:02}'), accounts[0], pay_id)
            before = w3.eth.get_balance(accounts[0])
            measure('pay', contract.functions.payInvoice(pay_id), accounts[1], pay_id, value)
            assert w3.eth.get_balance(accounts[0]) - before == value
            assert contract.functions.getInvoice(pay_id).call()[8] == 1
            measure('create', contract.functions.createInvoice(accounts[1], value, f'EVAL-C-{sample:02}'), accounts[0], cancel_id)
            measure('cancel', contract.functions.cancelInvoice(cancel_id), accounts[0], cancel_id)
            assert contract.functions.getInvoice(cancel_id).call()[8] == 2

        app = create_app({'CHAIN_ID': '31337', 'RPC_URL': rpc, 'CONTRACT_ADDRESS': contract.address})
        server = make_server('127.0.0.1', 0, app, threaded=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}'
        routes = [('config', '/api/config'), ('health', '/api/health'), ('invoice', '/api/invoices/1'), ('history', '/api/invoices/1/history'),
                  ('issued', f'/api/invoices?address={accounts[0]}&role=issued&limit=20'),
                  ('received', f'/api/invoices?address={accounts[1]}&role=received&limit=20'),
                  ('transaction', f'/api/transactions/{receipts[1]["hash"]}')]
        local = latency_samples(base, routes, 'Isolated local threaded Werkzeug HTTP server, Flask and immediately mined Anvil. Role pages contain 10 records; limit is 20.')
        journey = json.loads((ROOT / 'docs/evidence/sepolia-journey-context.json').read_text(encoding='utf-8'))
        public_routes = [('config', '/api/config'), ('health', '/api/health'), ('invoice', '/api/invoices/1'), ('history', '/api/invoices/1/history'),
                         ('issued', f'/api/invoices?address={journey["issuer"]}&role=issued&limit=20'),
                         ('received', f'/api/invoices?address={journey["client"]}&role=received&limit=20'),
                         ('transaction', f'/api/transactions/{journey["paymentTransactionHash"]}')]
        public = latency_samples(args.public_url, public_routes, 'Existing local Flask HTTP server using public Sepolia RPC. Role pages contain invoice #1. This is not Render or an Internet-to-Render measurement.')
        summaries = []
        for action in ['create', 'pay', 'cancel']:
            rows = [row for row in receipts if row['action'] == action]
            gas = [int(row['gasUsed']) for row in rows]
            times = [row['sendToReceiptMs'] for row in rows]
            summaries.append({'action': action, 'samples': len(rows), 'gasMin': min(gas), 'gasMedian': statistics.median(gas), 'gasMax': max(gas),
                              'sendToReceiptMedianMs': statistics.median(times), 'sendToReceiptMinMs': min(times), 'sendToReceiptMaxMs': max(times)})
        result = {'recordedAtUtc': datetime.now(timezone.utc).isoformat(), 'result': 'Passed',
                  'sourceSha256': hashlib.sha256((ROOT / 'contracts/FreelancePay.sol').read_bytes()).hexdigest(),
                  'localChainId': 31337, 'localDeploymentGas': str(deployment.gasUsed), 'localInvoiceAmountWei': str(value),
                  'localReferences': 'Nine printable ASCII characters: EVAL-P-01 and EVAL-C-01 through 05. The first creation initializes both role lists; later creations have different storage costs.',
                  'localTransactionTimingScope': 'perf_counter from unlocked local-account transact (including its RPC preflight) through receipt retrieval on an immediately mining local EVM. No wallet approval latency, public block-wait or production confirmation claim.',
                  'localTransactions': receipts, 'localTransactionSummary': summaries, 'localHttp': local, 'sepoliaBackedHttp': public,
                  'limits': ['Five sequential HTTP samples per route are a small descriptive sample, not a load benchmark.', 'Contract gas depends on storage state, reference/value and execution conditions; local and public results are distinct.',
                             'The public creation/payment confirmation duration was not measured and cannot be inferred from invoice timestamps.', 'No public transaction was signed or broadcast; all new writes use ephemeral local Anvil test accounts.']}
        destination = ROOT / 'docs/evidence/performance-evaluation.json'
        destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'result': result['result'], 'localTransactionSummary': summaries,
                          'localHttp': [{k: row[k] for k in ['route', 'medianMs', 'minMs', 'maxMs']} for row in local['results']],
                          'sepoliaBackedHttp': [{k: row[k] for k in ['route', 'medianMs', 'minMs', 'maxMs']} for row in public['results']]}, indent=2))
    finally:
        if server:
            server.shutdown()
        child.terminate()
        child.wait(timeout=10)


if __name__ == '__main__':
    main()
