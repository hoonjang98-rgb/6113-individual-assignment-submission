import json
from pathlib import Path

import pytest

from app import create_app


@pytest.fixture
def app(w3, contract):
    return create_app({'TESTING': True, 'CHAIN_ID': 31337, 'RPC_URL': w3.provider.endpoint_uri,
                       'CONTRACT_ADDRESS': contract.address})


@pytest.fixture
def client(app):
    return app.test_client()


def test_health_checks_chain_and_runtime(client, contract):
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.json['chainId'] == '31337' and response.json['contractAddress'] == contract.address
    assert isinstance(response.json['observedBlock'], str)


def test_history_recovers_transient_http_with_complete_original_events(app, client, contract, transact, accounts, monkeypatch):
    from requests import Response
    from requests.exceptions import HTTPError
    created = transact(contract.functions.createInvoice(accounts[1], 100, 'RECOVER'), accounts[0])
    paid = transact(contract.functions.payInvoice(1), accounts[1], 100)
    provider = app.extensions['chain_service'].w3.provider
    original = provider._request_session_manager.make_post_request
    failures, attempts = [], []
    def post(url, data, **kwargs):
        payload = json.loads(data)
        if payload['method'] == 'eth_getLogs':
            attempts.append(payload)
            if len(failures) < 2:
                failures.append(True)
                response = Response(); response.status_code = 503
                response.headers['Retry-After'] = '0'
                raise HTTPError('PRIVATE_CREDENTIAL', response=response)
        return original(url, data, **kwargs)
    monkeypatch.setattr(provider._request_session_manager, 'make_post_request', post)
    response = client.get('/api/invoices/1/history')
    assert response.status_code == 200
    assert [x['transactionHash'] for x in response.json['items']] == [created.transactionHash.to_0x_hex(), paid.transactionHash.to_0x_hex()]
    assert attempts[0] == attempts[1] == attempts[2]
    assert provider._read_scope.get() is None


def test_http_exhaustion_is_sanitized_and_next_request_can_recover(app, client, monkeypatch, caplog):
    from requests import Response
    from requests.exceptions import HTTPError
    provider = app.extensions['chain_service'].w3.provider
    original = provider._request_session_manager.make_post_request
    calls = []
    def unavailable(*args, **kwargs):
        calls.append(True)
        response = Response(); response.status_code = 429
        response.headers['Retry-After'] = '0'
        raise HTTPError('https://PRIVATE_CREDENTIAL/SECRET_BODY', response=response)
    monkeypatch.setattr(provider._request_session_manager, 'make_post_request', unavailable)
    response = client.get('/api/health')
    assert response.status_code == 503 and response.json['error']['code'] == 'SERVICE_UNAVAILABLE'
    assert len(calls) == 3 and '429' in caplog.text
    assert 'PRIVATE_CREDENTIAL' not in response.text + caplog.text
    assert client.get('/healthz').status_code == 200 and len(calls) == 3
    monkeypatch.setattr(provider._request_session_manager, 'make_post_request', original)
    assert client.get('/api/health').status_code == 200
    assert provider._read_scope.get() is None


def test_hosting_probe_remains_responsive_during_rpc_failure(app, client, monkeypatch):
    calls = []

    def unavailable():
        calls.append('chain-read')
        raise TimeoutError('Simulated unavailable RPC')

    monkeypatch.setattr(app.extensions['chain_service'], 'snapshot', unavailable)
    response = client.get('/healthz')
    assert response.status_code == 200 and response.json == {'status': 'alive'}
    assert response.headers['Cache-Control'] == 'no-store' and calls == []
    # Chain readiness still fails instead of enabling financial actions.
    readiness = client.get('/api/health')
    assert readiness.status_code == 503 and readiness.json['error']['code'] == 'SERVICE_UNAVAILABLE'
    assert calls == ['chain-read']


def test_config_contains_abi_but_no_rpc_or_bytecode(client, contract):
    response = client.get('/api/config')
    assert response.status_code == 200
    assert response.json['contractAddress'] == contract.address and response.json['configured']
    assert response.json['abi'] == json.loads((Path(__file__).resolve().parents[1] / 'abi/FreelancePay.json').read_text())
    assert 'RPC_URL' not in response.text and 'http://127.0.0.1' not in response.text and 'bytecode' not in response.json


def test_shell_and_security_headers(client):
    response = client.get('/')
    assert response.status_code == 200 and '<html lang="en">' in response.text
    assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert client.get('/api/health').headers['Cache-Control'] == 'no-store'
    assert client.post('/api/invoices').status_code == 405


def test_no_configuration_is_explicit():
    client = create_app({'RPC_URL': '', 'CONTRACT_ADDRESS': ''}).test_client()
    assert client.get('/').status_code == 200
    assert client.get('/api/config').json['configured'] is False
    response = client.get('/api/health')
    assert response.status_code == 503 and response.json['error']['code'] == 'NOT_CONFIGURED'
    hosting = client.get('/healthz')
    assert hosting.status_code == 503 and hosting.json['error']['code'] == 'NOT_CONFIGURED'


@pytest.mark.parametrize('query', [
    '', '?address=bad', '?address=0x' + '0' * 40,
    '?address={address}&role=other', '?address={address}&offset=-1',
    '?address={address}&offset=1e3', '?address={address}&offset=01',
    '?address={address}&limit=0', '?address={address}&limit=51',
    '?address={address}&offset=' + str(2**256),
])
def test_list_rejects_invalid_inputs(client, accounts, query):
    response = client.get('/api/invoices' + query.format(address=accounts[0]))
    assert response.status_code == 400


@pytest.mark.parametrize('invoice_id', ['0', '-1', '1.2', 'abc', str(2**256)])
def test_invoice_rejects_malformed_ids(client, invoice_id):
    assert client.get(f'/api/invoices/{invoice_id}').status_code == 400
    assert client.get(f'/api/invoices/{invoice_id}/history').status_code == 400


def test_invoice_not_found(client):
    assert client.get('/api/invoices/1').status_code == 404


def test_list_details_history_and_transaction_agree(client, contract, transact, accounts, w3):
    amount = 10**18 + 1
    created = transact(contract.functions.createInvoice(accounts[1], amount, '<b>PUBLIC</b>'), accounts[0])
    initial = client.get('/api/invoices/1').json['invoice']
    assert initial['reference'] == '<b>PUBLIC</b>' and initial['amountWei'] == str(amount)
    assert initial['status'] == 'Pending'
    assert client.get(f'/api/invoices?address={accounts[1]}&role=received').json['items'][0] == initial
    assert client.get(f'/api/invoices?address={accounts[2]}&role=received').json['items'] == []
    paid = transact(contract.functions.payInvoice(1), accounts[1], amount)
    assert client.get('/api/invoices/1').json['invoice']['status'] == 'Paid'
    history = client.get('/api/invoices/1/history')
    assert history.status_code == 200
    assert [event['event'] for event in history.json['items']] == ['InvoiceCreated', 'InvoicePaid']
    assert [event['transactionHash'] for event in history.json['items']] == [created.transactionHash.to_0x_hex(), paid.transactionHash.to_0x_hex()]
    result = client.get(f'/api/transactions/{paid.transactionHash.to_0x_hex()}').json
    assert result['status'] == 'confirmed' and result['events'] == [{'event': 'InvoicePaid', 'invoiceId': '1'}]
    assert result['from'] == accounts[1] and result['gasUsed'] == str(paid.gasUsed)
    # A new application instance reconstructs history without a database/session.
    fresh = create_app({'CHAIN_ID': 31337, 'RPC_URL': w3.provider.endpoint_uri, 'CONTRACT_ADDRESS': contract.address}).test_client()
    assert fresh.get('/api/invoices/1/history').json == history.json


def test_cancel_history(client, contract, transact, accounts):
    transact(contract.functions.createInvoice(accounts[1], 1, 'CANCEL'), accounts[0])
    transact(contract.functions.cancelInvoice(1), accounts[0])
    assert [e['event'] for e in client.get('/api/invoices/1/history').json['items']] == ['InvoiceCreated', 'InvoiceCancelled']


def test_reverted_unknown_and_unrelated_transactions(client, contract, transact, accounts, w3):
    transact(contract.functions.createInvoice(accounts[1], 1, 'REVERT'), accounts[0])
    reverted = contract.functions.payInvoice(1).transact({'from': accounts[2], 'value': 1, 'gas': 200000})
    result = client.get(f'/api/transactions/{reverted.to_0x_hex()}').json
    assert result['status'] == 'reverted' and result['events'] == []
    assert client.get('/api/transactions/0x' + 'ab' * 32).json['status'] == 'unknown'
    unrelated = w3.eth.send_transaction({'from': accounts[0], 'to': accounts[1], 'value': 1})
    assert client.get(f'/api/transactions/{unrelated.to_0x_hex()}').status_code == 400
    assert client.get('/api/transactions/bad').status_code == 400


def test_pending_is_not_confirmed(client, contract, accounts, w3):
    w3.provider.make_request('evm_setAutomine', [False])
    try:
        tx = contract.functions.createInvoice(accounts[1], 1, 'PENDING').transact({'from': accounts[0]})
        response = client.get(f'/api/transactions/{tx.to_0x_hex()}')
        assert response.status_code == 200 and response.json['status'] == 'pending'
    finally:
        w3.provider.make_request('evm_setAutomine', [True])


def test_wrong_chain_and_code_are_not_ready(w3, contract, accounts):
    wrong_chain = create_app({'CHAIN_ID': 11155111, 'RPC_URL': w3.provider.endpoint_uri, 'CONTRACT_ADDRESS': contract.address}).test_client()
    assert wrong_chain.get('/api/health').json['error']['code'] == 'WRONG_CHAIN'
    wrong_code = create_app({'CHAIN_ID': 31337, 'RPC_URL': w3.provider.endpoint_uri, 'CONTRACT_ADDRESS': accounts[0]}).test_client()
    assert wrong_code.get('/api/health').json['error']['code'] == 'CONTRACT_MISMATCH'


def test_rpc_fault_is_sanitized(app, client, monkeypatch, caplog):
    def fail():
        raise RuntimeError('https://rpc.example/PRIVATE_API_TOKEN')
    monkeypatch.setattr(app.extensions['chain_service'], 'snapshot', fail)
    response = client.get('/api/health')
    assert response.status_code == 503 and response.json['error']['code'] == 'SERVICE_UNAVAILABLE'
    assert 'PRIVATE_API_TOKEN' not in response.text and 'PRIVATE_API_TOKEN' not in caplog.text


def test_incomplete_event_history_is_not_fabricated(app, client, contract, transact, accounts, monkeypatch):
    transact(contract.functions.createInvoice(accounts[1], 1, 'HISTORY'), accounts[0])
    monkeypatch.setattr(app.extensions['chain_service'].w3.eth, 'get_logs', lambda *args, **kwargs: [])
    response = client.get('/api/invoices/1/history')
    assert response.status_code == 503 and response.json['error']['code'] == 'HISTORY_UNAVAILABLE'


def test_routed_create_and_cancel_are_confirmed_by_target_events(client, contract, deploy, transact, accounts, w3):
    issuer = deploy('TestRecipient', contract.address)
    created = transact(issuer.functions.issue(accounts[1], 100, 'ROUTED'), accounts[0])
    assert w3.eth.get_transaction(created.transactionHash)['to'] == issuer.address
    response = client.get(f'/api/transactions/{created.transactionHash.to_0x_hex()}')
    assert response.status_code == 200
    assert response.json['status'] == 'confirmed'
    assert response.json['events'] == [{'event': 'InvoiceCreated', 'invoiceId': '1'}]
    assert client.get('/api/invoices/1').json['invoice']['issuer'] == issuer.address
    cancelled = transact(issuer.functions.cancel(), accounts[0])
    response = client.get(f'/api/transactions/{cancelled.transactionHash.to_0x_hex()}')
    assert response.json['status'] == 'confirmed'
    assert response.json['events'] == [{'event': 'InvoiceCancelled', 'invoiceId': '1'}]
    assert client.get('/api/invoices/1/history').json['items'][-1]['transactionHash'] == cancelled.transactionHash.to_0x_hex()


def test_matching_event_from_other_contract_is_unrelated(client, deploy, transact, accounts):
    other = deploy('FreelancePay')
    receipt = transact(other.functions.createInvoice(accounts[1], 100, 'OTHER'), accounts[0])
    response = client.get(f'/api/transactions/{receipt.transactionHash.to_0x_hex()}')
    assert response.status_code == 400 and response.json['error']['code'] == 'UNRELATED_TRANSACTION'


def test_unmined_routed_call_stays_unknown(client, contract, deploy, accounts, w3):
    issuer = deploy('TestRecipient', contract.address)
    w3.provider.make_request('evm_setAutomine', [False])
    try:
        tx = issuer.functions.issue(accounts[1], 100, 'WAIT').transact({'from': accounts[0]})
        response = client.get(f'/api/transactions/{tx.to_0x_hex()}')
        assert response.status_code == 200 and response.json['status'] == 'unknown'
        assert 'events' not in response.json
    finally:
        w3.provider.make_request('evm_setAutomine', [True])


def test_routed_failure_without_target_event_is_not_claimed(client, contract, deploy, accounts, w3):
    issuer = deploy('TestRecipient', contract.address)
    tx = issuer.functions.issue(accounts[1], 0, 'FAIL').transact({'from': accounts[0], 'gas': 200000})
    assert w3.eth.wait_for_transaction_receipt(tx).status == 0
    response = client.get(f'/api/transactions/{tx.to_0x_hex()}')
    assert response.status_code == 400 and response.json['error']['code'] == 'UNRELATED_TRANSACTION'
