import pytest

from tools.deploy_server import create_deploy_app


@pytest.fixture
def helper():
    client = create_deploy_app().test_client()
    token = client.get('/artifact').json['connectionReportToken']
    return client, {'Origin': 'http://localhost', 'X-Connection-Token': token}


def report(**changes):
    return {'pageId': 'a' * 32, 'walletDetected': True,
            'account': '0x' + '1' * 40, 'chainId': '11155111', 'deploymentHash': None, **changes}


def test_public_connection_is_observable_and_disconnect_replaces_it(helper):
    client, headers = helper
    assert client.post('/connection-status', json=report(), headers=headers).status_code == 200
    observation = client.get('/connection-status').json['observations'][0]
    assert observation['account'] == '0x' + '1' * 40 and observation['chainId'] == '11155111'
    assert 'receivedAt' in observation
    client.post('/connection-status', json=report(account=None), headers=headers)
    assert client.get('/connection-status').json['observations'][0]['account'] is None


@pytest.mark.parametrize('bad_headers', [
    {'Origin': 'https://external.example'}, {'X-Connection-Token': 'wrong'}, {'Origin': ''},
])
def test_other_origins_or_invalid_tokens_cannot_submit(helper, bad_headers):
    client, headers = helper
    assert client.post('/connection-status', json=report(), headers={**headers, **bad_headers}).status_code == 403
    assert client.get('/connection-status').json['observations'] == []


def test_unexpected_fields_and_remote_access_rejected(helper):
    client, headers = helper
    assert client.post('/connection-status', json={**report(), 'privateKey': 'not-a-secret'}, headers=headers).status_code == 400
    assert client.post('/connection-status', json=report(), headers=headers, environ_overrides={'REMOTE_ADDR': '10.0.0.1'}).status_code == 403
    assert client.get('/connection-status', environ_overrides={'REMOTE_ADDR': '10.0.0.1'}).status_code == 403
    assert client.get('/connection-status').json['observations'] == []


def test_pages_do_not_overwrite_other_wallet_observations(helper):
    client, headers = helper
    client.post('/connection-status', json=report(), headers=headers)
    client.post('/connection-status', json=report(pageId='b' * 32, walletDetected=False, account=None, chainId=None), headers=headers)
    observations = client.get('/connection-status').json['observations']
    assert len(observations) == 2 and sum(bool(item['account']) for item in observations) == 1
    assert create_deploy_app().test_client().get('/connection-status').json['observations'] == []


def test_invalid_and_oversized_reports_are_rejected(helper):
    client, headers = helper
    assert client.post('/connection-status', json=report(account='invalid'), headers=headers).status_code == 400
    assert client.post('/connection-status', json=report(chainId='-1'), headers=headers).status_code == 400
    assert client.post('/connection-status', json=report(account='x' * 3000), headers=headers).status_code == 413


def test_connection_diagnostics_accept_only_known_states_and_numeric_codes(helper):
    client, headers = helper
    data = report(account=None, connectionState='pending', errorCode=-32002)
    assert client.post('/connection-status', json=data, headers=headers).status_code == 200
    observation = client.get('/connection-status').json['observations'][0]
    assert observation['connectionState'] == 'pending'
    assert observation['errorCode'] == -32002
    for changes in ({'connectionState': 'arbitrary text'}, {'errorCode': 'raw error text'},
                    {'errorCode': True}, {'errorCode': 100001}, {'errorMessage': 'raw message'}):
        assert client.post('/connection-status', json={**data, **changes}, headers=headers).status_code == 400
