import json

import pytest
from web3.exceptions import TransactionNotFound

from tools.verify_deployment import load_build, verify


@pytest.fixture
def creation(w3, accounts):
    artifact = load_build()
    factory = w3.eth.contract(abi=artifact['abi'], bytecode=artifact['bytecode'])
    tx = factory.constructor().transact({'from': accounts[0]})
    receipt = w3.eth.wait_for_transaction_receipt(tx)
    return artifact, tx.to_0x_hex(), receipt


def test_verified_local_deployment_has_exact_identity(w3, creation):
    artifact, tx, receipt = creation
    result = verify(w3, artifact, tx, expected_chain_id=31337)
    assert result['contractAddress'] == receipt.contractAddress and result['transactionHash'] == tx
    assert result['chainId'] == 31337 and result['network'] == 'Local verification test'
    assert result['gasUsed'] == str(receipt.gasUsed)
    assert result['invoiceCountAtCheck'] == '0' and all(result['verification'].values())
    assert result['sourceSha256'] == artifact['sourceSha256']


def test_default_public_verifier_rejects_local_chain(w3, creation):
    artifact, tx, _ = creation
    with pytest.raises(ValueError, match='RPC chain'):
        verify(w3, artifact, tx)


@pytest.mark.parametrize('hash_value', ['0x12', 'not-a-hash', '0x' + 'g' * 64])
def test_bad_hash_rejected(w3, hash_value):
    with pytest.raises(ValueError, match='complete transaction hash'):
        verify(w3, load_build(), hash_value, expected_chain_id=31337)


def test_unknown_hash_not_treated_as_deployment(w3):
    with pytest.raises(TransactionNotFound):
        verify(w3, load_build(), '0x' + 'ab' * 32, expected_chain_id=31337)


def test_normal_transfer_rejected(w3, accounts):
    tx = w3.eth.send_transaction({'from': accounts[0], 'to': accounts[1], 'value': 1})
    with pytest.raises(ValueError, match='not a successful contract deployment'):
        verify(w3, load_build(), tx.to_0x_hex(), expected_chain_id=31337)


def test_unrelated_deployment_rejected(w3, accounts):
    tx = w3.eth.send_transaction({'from': accounts[0], 'data': '0x60006000f3'})
    with pytest.raises(ValueError, match='does not match the expected build'):
        verify(w3, load_build(), tx.to_0x_hex(), expected_chain_id=31337)


def test_wrong_runtime_rejected(w3, creation):
    artifact, tx, _ = creation
    artifact['deployedBytecode'] = '0x00'
    with pytest.raises(ValueError, match='runtime does not match'):
        verify(w3, artifact, tx, expected_chain_id=31337)


def test_stale_source_or_abi_is_rejected(tmp_path):
    for folder in ['contracts', 'abi', 'build']:
        (tmp_path / folder).mkdir()
    artifact = load_build()
    (tmp_path / 'build/FreelancePay.json').write_text(json.dumps(artifact))
    (tmp_path / 'abi/FreelancePay.json').write_text(json.dumps(artifact['abi']))
    (tmp_path / 'contracts/FreelancePay.sol').write_text('Unverified source')
    with pytest.raises(ValueError, match='Source, build and ABI'):
        load_build(tmp_path)


def test_cli_sanitizes_upstream_value_errors(monkeypatch, capsys, tmp_path):
    import tools.verify_deployment as module
    def fail(*args, **kwargs):
        raise ValueError('https://rpc.example/PRIVATE_TOKEN')
    monkeypatch.setattr(module, 'verify', fail)
    monkeypatch.setattr(module, 'ROOT', tmp_path)
    monkeypatch.setattr('sys.argv', ['verify_deployment.py', '--transaction', '0x' + 'ab' * 32])
    with pytest.raises(SystemExit) as error:
        module.main()
    assert error.value.code == 1
    captured = capsys.readouterr()
    assert 'PRIVATE_TOKEN' not in captured.out + captured.err
    assert not (tmp_path / 'docs/evidence/sepolia-deployment.json').exists()
