"""Independently verify a user-signed deployment; never sign a transaction."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

from web3 import Web3

ROOT = Path(__file__).resolve().parents[1]


class VerificationError(ValueError):
    """Validation failure with a safe, authored public message."""


def load_build(root=ROOT):
    artifact = json.loads((root / 'build/FreelancePay.json').read_text(encoding='utf-8'))
    source_hash = hashlib.sha256((root / 'contracts/FreelancePay.sol').read_bytes()).hexdigest()
    abi = json.loads((root / 'abi/FreelancePay.json').read_text(encoding='utf-8'))
    if source_hash != artifact['sourceSha256'] or abi != artifact['abi']:
        raise VerificationError('Source, build and ABI do not match. Rebuild and reverify first.')
    return artifact


def verify(w3, artifact, transaction_hash, expected_chain_id=11155111):
    if not re.fullmatch(r'0x[0-9a-fA-F]{64}', transaction_hash):
        raise VerificationError('A complete transaction hash is required.')
    chain_id = w3.eth.chain_id
    if chain_id != expected_chain_id:
        raise VerificationError('RPC chain does not match the required network.')
    receipt = w3.eth.get_transaction_receipt(transaction_hash)
    tx = w3.eth.get_transaction(transaction_hash)
    if receipt.status != 1 or not receipt.contractAddress or tx['to'] is not None:
        raise VerificationError('The transaction is not a successful contract deployment.')
    if tx['chainId'] != expected_chain_id or tx['value'] != 0 or tx['input'].to_0x_hex().lower() != artifact['bytecode'].lower():
        raise VerificationError('The deployment transaction does not match the expected build.')
    block = w3.eth.get_block(receipt.blockNumber)
    if block.hash != receipt.blockHash or tx.blockHash != receipt.blockHash:
        raise VerificationError('The deployment receipt does not match the canonical block.')
    code = w3.eth.get_code(receipt.contractAddress, block_identifier='latest').to_0x_hex()
    if code.lower() != artifact['deployedBytecode'].lower():
        raise VerificationError('Deployed runtime does not match the expected build.')
    contract = w3.eth.contract(address=receipt.contractAddress, abi=artifact['abi'])
    count = contract.functions.invoiceCount().call()
    return {
        'recordedAt': datetime.now(timezone.utc).isoformat(), 'chainId': chain_id,
        'network': 'Ethereum Sepolia' if chain_id == 11155111 else 'Local verification test',
        'contractAddress': receipt.contractAddress, 'transactionHash': receipt.transactionHash.to_0x_hex(),
        'deployer': tx['from'], 'blockNumber': str(receipt.blockNumber),
        'blockHash': receipt.blockHash.to_0x_hex(), 'gasUsed': str(receipt.gasUsed),
        'confirmationsAtCheck': str(w3.eth.block_number - receipt.blockNumber + 1),
        'compiler': artifact['compiler'], 'compilerSettings': artifact['settings'],
        'sourceSha256': artifact['sourceSha256'],
        'runtimeSha256': hashlib.sha256(bytes.fromhex(code[2:])).hexdigest(),
        'invoiceCountAtCheck': str(count),
        'verification': {'receiptSucceeded': True, 'creationCodeMatches': True,
                         'runtimeCodeMatches': True, 'canonicalBlockMatches': True, 'contractReadSucceeded': True},
        'scope': 'Read-only RPC deployment verification. Wallet-extension interaction and the public application journey require separate evidence.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transaction', required=True, help='Public Sepolia deployment transaction hash')
    parser.add_argument('--rpc-url', default='https://ethereum-sepolia.publicnode.com', help='Sepolia read-only RPC endpoint')
    args = parser.parse_args()
    try:
        artifact = load_build()
        w3 = Web3(Web3.HTTPProvider(args.rpc_url, request_kwargs={'timeout': 15}, exception_retry_configuration=None))
        record = verify(w3, artifact, args.transaction)
        destination = ROOT / 'docs/evidence/sepolia-deployment.json'
        if destination.exists():
            previous = json.loads(destination.read_text(encoding='utf-8'))
            if previous['transactionHash'].lower() != record['transactionHash'].lower():
                raise VerificationError('A different deployment record exists. Review it before replacing it.')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'result': 'Verified', 'contractAddress': record['contractAddress'],
                          'transactionHash': record['transactionHash'], 'record': 'docs/evidence/sepolia-deployment.json'}))
    except VerificationError as error:
        # Our validation messages contain no RPC credentials.
        print('Verification failed: ' + str(error))
        raise SystemExit(1)
    except Exception as error:
        # Upstream exceptions can contain URLs/tokens; print the class only.
        print(f'Verification could not complete ({type(error).__name__}). Check the network and transaction, then retry.')
        raise SystemExit(1)


if __name__ == '__main__':
    main()
