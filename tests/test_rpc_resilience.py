"""Deterministic transport faults; no external network or wallet signing."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import format_datetime
import json
from threading import Barrier, Thread
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from requests import Response
from requests.exceptions import ConnectionError, HTTPError, SSLError, Timeout

import chain_service
from chain_service import ReadOnlyHTTPProvider


@pytest.fixture(autouse=True)
def isolated_chain():
    # These provider transport tests do not require Anvil.
    yield


@pytest.fixture
def clock(monkeypatch):
    state = {'now': 0, 'sleeps': []}
    monkeypatch.setattr(chain_service.time, 'monotonic', lambda: state['now'])
    def sleep(delay):
        state['sleeps'].append(delay)
        state['now'] += delay
    monkeypatch.setattr(chain_service.time, 'sleep', sleep)
    return state


def failure(status=503, retry_after=None):
    response = Response()
    response.status_code = status
    if retry_after is not None:
        response.headers['Retry-After'] = retry_after
    return HTTPError('https://secret.invalid/PRIVATE_CREDENTIAL response SECRET_BODY', response=response)


def transport(monkeypatch, provider, outcomes):
    calls = []
    def post(url, data, **kwargs):
        calls.append((url, data, kwargs))
        result = outcomes.pop(0)
        if isinstance(result, Exception):
            raise result
        return result
    monkeypatch.setattr(provider._request_session_manager, 'make_post_request', post)
    return calls


@pytest.mark.parametrize('status', [408, 429, 500, 502, 503, 504])
def test_transient_status_recovers_exact_same_read(monkeypatch, clock, caplog, status):
    provider = ReadOnlyHTTPProvider('https://secret.invalid/PRIVATE_CREDENTIAL')
    body = b'{"method":"eth_getLogs","params":[{"fromBlock":"0x123","toBlock":"0x123"}]}'
    calls = transport(monkeypatch, provider, [failure(status), b'ok'])
    assert provider._make_request('eth_getLogs', body) == b'ok'
    assert len(calls) == 2 and calls[0][1] == calls[1][1] == body
    assert calls[0][2]['timeout'].total == 4 and clock['sleeps'] == [0.25]
    assert str(status) in caplog.text
    assert 'PRIVATE_CREDENTIAL' not in caplog.text and 'SECRET_BODY' not in caplog.text


@pytest.mark.parametrize('error', [Timeout('timeout'), ConnectionError('connection')])
def test_transport_recovery(monkeypatch, clock, error):
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    calls = transport(monkeypatch, provider, [error, b'ok'])
    assert provider._make_request('eth_call', b'exact') == b'ok' and len(calls) == 2


@pytest.mark.parametrize('error', [failure(400), failure(401), failure(403), failure(404), SSLError('certificate')])
def test_permanent_faults_fail_once(monkeypatch, clock, error):
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    calls = transport(monkeypatch, provider, [error])
    with pytest.raises(type(error)):
        provider._make_request('eth_getCode', b'exact')
    assert len(calls) == 1 and clock['sleeps'] == []


@pytest.mark.parametrize('method', ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'eth_unknown'])
def test_writes_signing_and_unknown_methods_never_retry(monkeypatch, clock, method):
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    calls = transport(monkeypatch, provider, [failure()])
    with pytest.raises(HTTPError):
        provider._make_request(method, b'exact')
    assert len(calls) == 1 and clock['sleeps'] == []


def test_json_rpc_error_is_returned_without_transport_retry(monkeypatch, clock):
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    body = b'{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"execution reverted"}}'
    calls = transport(monkeypatch, provider, [body])
    assert provider.make_request('eth_call', [])['error']['message'] == 'execution reverted'
    assert len(calls) == 1 and clock['sleeps'] == []


def test_retry_budget_shared_across_reads_and_resets_next_request(monkeypatch, clock):
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    calls = transport(monkeypatch, provider, [failure(), b'one', failure(), b'two', failure(), failure(), b'new'])
    token = provider.begin_request()
    try:
        assert provider._make_request('eth_chainId', b'one') == b'one'
        assert provider._make_request('eth_getCode', b'two') == b'two'
        with pytest.raises(HTTPError):
            provider._make_request('eth_getLogs', b'three')
    finally:
        provider.end_request(token)
    token = provider.begin_request()
    try:
        assert provider._make_request('eth_getLogs', b'new') == b'new'
    finally:
        provider.end_request(token)
    assert len(calls) == 7 and clock['sleeps'] == [0.25, 0.5, 0.25]


def test_exhaustion_preserves_last_error(monkeypatch, clock):
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    last = failure(504)
    calls = transport(monkeypatch, provider, [failure(), failure(), last])
    with pytest.raises(HTTPError) as caught:
        provider._make_request('eth_getLogs', b'exact')
    assert caught.value is last and len(calls) == 3


def test_deadline_stops_new_calls_and_reduces_timeout(monkeypatch, clock):
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    calls = transport(monkeypatch, provider, [b'near'])
    token = provider.begin_request()
    try:
        clock['now'] = 19
        assert provider._make_request('eth_getLogs', b'exact') == b'near'
        assert calls[0][2]['timeout'].total == 1
        clock['now'] = 20
        with pytest.raises(Timeout):
            provider._make_request('eth_getLogs', b'exact')
    finally:
        provider.end_request(token)
    assert len(calls) == 1


@pytest.mark.parametrize('value,expected', [('1', 1), ('invalid', 0.25)])
def test_retry_after_seconds_and_malformed_fallback(monkeypatch, clock, value, expected):
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    transport(monkeypatch, provider, [failure(429, value), b'ok'])
    assert provider._make_request('eth_getLogs', b'exact') == b'ok'
    assert clock['sleeps'] == [expected]


def test_retry_after_http_date(monkeypatch, clock):
    monkeypatch.setattr(chain_service.time, 'time', lambda: 1000)
    value = format_datetime(datetime.fromtimestamp(1002, timezone.utc), usegmt=True)
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    transport(monkeypatch, provider, [failure(503, value), b'ok'])
    assert provider._make_request('eth_getLogs', b'exact') == b'ok'
    assert clock['sleeps'] == [2]


def test_long_retry_after_fails_without_retrying_early(monkeypatch, clock):
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    calls = transport(monkeypatch, provider, [failure(429, '120')])
    with pytest.raises(HTTPError):
        provider._make_request('eth_getLogs', b'exact')
    assert len(calls) == 1 and clock['sleeps'] == []


def test_worker_request_budgets_are_isolated():
    provider = ReadOnlyHTTPProvider('https://unused.invalid')
    barrier = Barrier(2)
    def worker(value):
        token = provider.begin_request()
        try:
            provider._read_scope.get()['retries'] = value
            barrier.wait(timeout=5)
            return provider._read_scope.get()['retries']
        finally:
            provider.end_request(token)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(worker, 1)
        second = pool.submit(worker, 2)
        assert (first.result(), second.result()) == (1, 2)
    assert provider._read_scope.get() is None


def test_real_http_transport_retries_response_and_decodes_result():
    bodies = []
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            bodies.append(self.rfile.read(int(self.headers['Content-Length'])))
            self.send_response(503 if len(bodies) == 1 else 200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Retry-After', '0')
            self.end_headers()
            self.wfile.write(b'busy' if len(bodies) == 1 else b'{"jsonrpc":"2.0","id":0,"result":"0xaa36a7"}')
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        provider = ReadOnlyHTTPProvider(f'http://127.0.0.1:{server.server_port}')
        assert provider.make_request('eth_chainId', [])['result'] == '0xaa36a7'
        assert len(bodies) == 2 and bodies[0] == bodies[1]
        assert json.loads(bodies[0])['method'] == 'eth_chainId'
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
