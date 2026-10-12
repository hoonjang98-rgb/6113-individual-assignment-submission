"""FreelancePay Flask application. Public reads only; no signing endpoints."""
import json
import os
from pathlib import Path
import re

from dotenv import load_dotenv
from flask import Flask, g, jsonify, render_template, request
from web3 import Web3
from werkzeug.exceptions import HTTPException

from chain_service import ChainService, ReadOnlyHTTPProvider, ServiceError, address, decimal

ROOT = Path(__file__).resolve().parent
NETWORKS = {11155111: ('Ethereum Sepolia', 'https://sepolia.etherscan.io'), 31337: ('Local test network', '')}


def create_app(config=None):
    load_dotenv(ROOT / '.env')
    app = Flask(__name__)
    app.config.from_mapping(CHAIN_ID=os.environ.get('CHAIN_ID', '11155111'),
                            RPC_URL=os.environ.get('RPC_URL', ''),
                            CONTRACT_ADDRESS=os.environ.get('CONTRACT_ADDRESS', ''),
                            MAX_CONTENT_LENGTH=16384)
    app.config.update(config or {})
    artifact = json.loads((ROOT / 'build/FreelancePay.json').read_text(encoding='utf-8'))
    service, setup_error = None, None
    try:
        chain_id = int(app.config['CHAIN_ID'])
        if chain_id not in NETWORKS or not app.config['RPC_URL'] or not app.config['CONTRACT_ADDRESS']:
            raise ValueError('Missing configuration')
        w3 = Web3(ReadOnlyHTTPProvider(app.config['RPC_URL']))
        service = ChainService(w3, app.config['CONTRACT_ADDRESS'], chain_id, artifact)
    except (ValueError, ServiceError):
        setup_error = 'The application deployment is not configured yet.'
        chain_id = 11155111
    app.extensions['chain_service'] = service

    @app.before_request
    def read_budget():
        if service is not None:
            g.rpc_read_token = service.w3.provider.begin_request()

    @app.teardown_request
    def release_read_budget(_error):
        token = g.pop('rpc_read_token', None)
        if token is not None:
            service.w3.provider.end_request(token)

    def chain():
        if service is None:
            raise ServiceError('NOT_CONFIGURED', setup_error)
        return service, service.snapshot()

    @app.get('/')
    def index():
        return render_template('index.html')

    @app.get('/api/config')
    def public_config():
        name, explorer = NETWORKS[chain_id]
        return jsonify(chainId=str(chain_id), networkName=name, explorerUrl=explorer,
                       contractAddress=service.address if service else None,
                       abi=artifact['abi'], sourceSha256=artifact['sourceSha256'],
                       configured=service is not None, message=setup_error)

    @app.get('/api/health')
    def health():
        _, block = chain()
        return jsonify(status='ready', observedBlock=str(block), chainId=str(chain_id), contractAddress=service.address)

    @app.get('/healthz')
    def hosting_health():
        # A shared RPC outage cannot be repaired by restarting a healthy process.
        # Financial actions still require the separate chain/runtime readiness check.
        if service is None:
            raise ServiceError('NOT_CONFIGURED', setup_error)
        return jsonify(status='alive')

    @app.get('/api/invoices')
    def invoices():
        account = address(request.args.get('address'))
        role = request.args.get('role', 'issued')
        if role not in ('issued', 'received'):
            raise ServiceError('INVALID_ROLE', 'Choose issued or received invoices.', 400)
        offset = decimal(request.args.get('offset', '0'), 'Offset')
        limit = decimal(request.args.get('limit', '20'), 'Page size', 1, 50)
        current, block = chain()
        return jsonify(current.invoices(account, role, offset, limit, block))

    @app.get('/api/invoices/<invoice_id>')
    def invoice(invoice_id):
        number = decimal(invoice_id, 'Invoice ID', 1)
        current, block = chain()
        return jsonify(invoice=current.invoice(number, block), observedBlock=str(block))

    @app.get('/api/invoices/<invoice_id>/history')
    def history(invoice_id):
        number = decimal(invoice_id, 'Invoice ID', 1)
        current, block = chain()
        return jsonify(current.history(number, block))

    @app.get('/api/transactions/<tx_hash>')
    def transaction(tx_hash):
        if not re.fullmatch(r'0x[0-9a-fA-F]{64}', tx_hash):
            raise ServiceError('INVALID_HASH', 'Enter a valid transaction hash.', 400)
        current, block = chain()
        return jsonify(current.transaction(tx_hash, block))

    @app.errorhandler(ServiceError)
    def service_error(error):
        return jsonify(error={'code': error.code, 'message': error.message}), error.status

    @app.errorhandler(Exception)
    def unexpected(error):
        if isinstance(error, HTTPException):
            return jsonify(error={'code': 'HTTP_ERROR', 'message': error.name}), error.code
        # RPC exception text may contain credentials; retain only safe diagnostics.
        status = getattr(getattr(error, 'response', None), 'status_code', None)
        app.logger.warning('Request unavailable: %s status=%s', type(error).__name__, status if isinstance(status, int) else None)
        return jsonify(error={'code': 'SERVICE_UNAVAILABLE', 'message': 'The network service is temporarily unavailable. Try again.'}), 503

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'"
        )
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        if request.path.startswith('/api/') or request.path == '/healthz':
            response.headers['Cache-Control'] = 'no-store'
        return response

    return app


if __name__ == '__main__':
    create_app().run(host='127.0.0.1', port=int(os.environ.get('PORT', '5000')), debug=False, use_reloader=False)
