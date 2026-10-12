"""Loopback deployment helper. No signing, chain writes or configuration writes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import secrets
from threading import Lock

from flask import Flask, abort, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parents[1]


def create_deploy_app():
    app = Flask(__name__, static_folder=None)
    app.config['TRUSTED_HOSTS'] = ['127.0.0.1', 'localhost']
    app.config['MAX_CONTENT_LENGTH'] = 2048
    report_token = secrets.token_urlsafe(32)
    observations = {}
    observation_lock = Lock()

    @app.get('/')
    def index():
        return send_from_directory(ROOT / 'tools/deploy', 'index.html')

    @app.get('/deploy.js')
    def script():
        return send_from_directory(ROOT / 'tools/deploy', 'deploy.js')

    @app.get('/ethers.js')
    def library():
        return send_from_directory(ROOT / 'static/vendor', 'ethers.min.js')

    @app.get('/artifact')
    def artifact():
        build = json.loads((ROOT / 'build/FreelancePay.json').read_text(encoding='utf-8'))
        source_hash = hashlib.sha256((ROOT / 'contracts/FreelancePay.sol').read_bytes()).hexdigest()
        if source_hash != build['sourceSha256']:
            abort(409, 'Source changed. Rebuild and rerun the contract tests first.')
        return jsonify({**build, 'connectionReportToken': report_token})

    @app.post('/connection-status')
    def report_connection():
        if request.remote_addr not in ('127.0.0.1', '::1') or request.headers.get('Origin') != request.host_url.rstrip('/'):
            abort(403)
        supplied_token = request.headers.get('X-Connection-Token', '')
        if not secrets.compare_digest(supplied_token, report_token):
            abort(403)
        data = request.get_json(silent=True)
        required = {'pageId', 'walletDetected', 'account', 'chainId', 'deploymentHash'}
        optional = {'connectionState', 'errorCode'}
        if not isinstance(data, dict) or not required.issubset(data) or set(data) - required - optional:
            abort(400)
        if 'connectionState' in data and data['connectionState'] not in (
                'not-detected', 'idle', 'requesting', 'waiting', 'pending', 'connected',
                'rejected', 'empty-account', 'unsupported', 'disconnected', 'read-error', 'error'):
            abort(400)
        if data.get('errorCode') is not None and (type(data['errorCode']) is not int or not -100000 <= data['errorCode'] <= 100000):
            abort(400)
        if not isinstance(data['pageId'], str) or not re.fullmatch(r'[0-9a-f]{32}', data['pageId']):
            abort(400)
        if not isinstance(data['walletDetected'], bool):
            abort(400)
        if data['account'] is not None and (not isinstance(data['account'], str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}', data['account'])):
            abort(400)
        if data['chainId'] is not None and (not isinstance(data['chainId'], str) or not re.fullmatch(r'[1-9][0-9]{0,15}', data['chainId'])):
            abort(400)
        if data['deploymentHash'] is not None and (not isinstance(data['deploymentHash'], str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', data['deploymentHash'])):
            abort(400)
        if data['account'] and not (data['walletDetected'] and data['chainId']):
            abort(400)
        observation = {**data, 'receivedAt': datetime.now(timezone.utc).isoformat()}
        with observation_lock:
            observations[data['pageId']] = observation
            if len(observations) > 8:
                oldest = min(observations, key=lambda key: observations[key]['receivedAt'])
                del observations[oldest]
        return jsonify(status='recorded', receivedAt=observation['receivedAt'])

    @app.get('/connection-status')
    def connection_status():
        if request.remote_addr not in ('127.0.0.1', '::1'):
            abort(403)
        with observation_lock:
            reports = sorted(observations.values(), key=lambda item: item['receivedAt'], reverse=True)
        return jsonify(observations=reports,
                       scope='Browser-reported public wallet state, held in local process memory. Not a signature or proof of wallet ownership. Verify balances separately on the expected chain.')

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
        )
        return response

    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    create_deploy_app().run(host='127.0.0.1', port=args.port, debug=False, use_reloader=False)
