"""Read-only chain integration. Wallets are the sole transaction signers."""
from contextvars import ContextVar
from email.utils import parsedate_to_datetime
import logging
import re
import time

from requests.exceptions import ConnectionError, HTTPError, SSLError, Timeout
from urllib3.util import Timeout as HTTPTimeout

from web3 import Web3
from web3.exceptions import TransactionNotFound

UINT256_MAX = 2**256 - 1
STATUSES = ('Pending', 'Paid', 'Cancelled')


class ReadOnlyHTTPProvider(Web3.HTTPProvider):
    """Small, request-scoped recovery budget for explicit public RPC reads only."""
    READ_METHODS = frozenset({'eth_chainId', 'eth_blockNumber', 'eth_getCode',
                              'eth_call', 'eth_getLogs', 'eth_getTransactionByHash',
                              'eth_getTransactionReceipt'})
    TRANSIENT_STATUSES = frozenset({408, 429, 500, 502, 503, 504})

    def __init__(self, endpoint_uri):
        super().__init__(endpoint_uri, request_kwargs={'timeout': 4},
                         exception_retry_configuration=None)
        self._read_scope = ContextVar('rpc_read_scope', default=None)

    def begin_request(self):
        return self._read_scope.set({'deadline': time.monotonic() + 20, 'retries': 0})

    def end_request(self, token):
        self._read_scope.reset(token)

    @staticmethod
    def _delay(error, retries):
        value = error.response.headers.get('Retry-After') if isinstance(error, HTTPError) and error.response is not None else None
        if value is not None:
            try:
                seconds = float(value) if value.isdigit() else parsedate_to_datetime(value).timestamp() - time.time()
                # Never retry earlier than a valid server delay. Long delays fail
                # visibly instead of holding a worker or silently shortening it.
                return max(0, seconds)
            except (ValueError, TypeError, OverflowError):
                pass
        return 0.25 * 2 ** retries

    def _make_request(self, method, request_data):
        if method not in self.READ_METHODS:
            return super()._make_request(method, request_data)
        state = self._read_scope.get()
        if state is None:
            state = {'deadline': time.monotonic() + 20, 'retries': 0}
        while True:
            remaining = state['deadline'] - time.monotonic()
            if remaining <= 0:
                raise Timeout('RPC read budget exhausted')
            kwargs = self.get_request_kwargs()
            cap = min(4, remaining)
            kwargs['timeout'] = HTTPTimeout(total=cap, connect=cap, read=cap)
            try:
                # Reuse the exact encoded method, parameters and block selector.
                return self._request_session_manager.make_post_request(self.endpoint_uri, request_data, **kwargs)
            except (HTTPError, Timeout, ConnectionError) as error:
                status = error.response.status_code if isinstance(error, HTTPError) and error.response is not None else None
                transient = (status in self.TRANSIENT_STATUSES if isinstance(error, HTTPError)
                             else not isinstance(error, SSLError))
                delay = self._delay(error, state['retries'])
                retry = (transient and state['retries'] < 2 and delay <= 2
                         and time.monotonic() + delay < state['deadline'])
                # No endpoint, exception text, response body or credential header.
                logging.getLogger(__name__).warning('RPC read failed: method=%s status=%s retry=%s', method, status, retry)
                if not retry:
                    raise
                state['retries'] += 1
                time.sleep(delay)


class ServiceError(Exception):
    def __init__(self, code, message, status=503):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def decimal(value, name, minimum=0, maximum=UINT256_MAX):
    if not isinstance(value, str) or not re.fullmatch(r'0|[1-9][0-9]{0,77}', value):
        raise ServiceError('INVALID_INPUT', f'{name} must be a whole decimal number.', 400)
    number = int(value)
    if number < minimum or number > maximum:
        raise ServiceError('INVALID_INPUT', f'{name} is outside the supported range.', 400)
    return number


def address(value):
    if not isinstance(value, str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}', value) or int(value, 16) == 0:
        raise ServiceError('INVALID_ADDRESS', 'Enter a valid nonzero Ethereum address.', 400)
    letters = value[2:]
    if not (letters.islower() or letters.isupper() or letters.isdigit()) and not Web3.is_checksum_address(value):
        raise ServiceError('INVALID_ADDRESS', 'The address checksum is invalid.', 400)
    return Web3.to_checksum_address(value)


class ChainService:
    def __init__(self, w3, contract_address, chain_id, artifact):
        self.w3, self.chain_id, self.artifact = w3, chain_id, artifact
        self.address = address(contract_address)
        self.contract = w3.eth.contract(address=self.address, abi=artifact['abi'])

    def snapshot(self):
        if self.w3.eth.chain_id != self.chain_id:
            raise ServiceError('WRONG_CHAIN', 'The server is connected to the wrong network.')
        block = self.w3.eth.block_number
        code = self.w3.eth.get_code(self.address, block_identifier=block).to_0x_hex()
        if code.lower() != self.artifact['deployedBytecode'].lower():
            raise ServiceError('CONTRACT_MISMATCH', 'The configured contract does not match this application build.')
        return block

    def invoice(self, invoice_id, block):
        count = self.contract.functions.invoiceCount().call(block_identifier=block)
        if invoice_id > count:
            raise ServiceError('INVOICE_NOT_FOUND', 'This invoice does not exist.', 404)
        return self._read_invoice(invoice_id, block)

    def _read_invoice(self, invoice_id, block):
        values = self.contract.functions.getInvoice(invoice_id).call(block_identifier=block)
        return {
            'id': str(invoice_id), 'issuer': values[0], 'client': values[1],
            'amountWei': str(values[2]), 'reference': values[3], 'createdAt': str(values[4]),
            'settledAt': str(values[5]), 'createdBlock': str(values[6]),
            'settledBlock': str(values[7]), 'status': STATUSES[values[8]],
        }

    def invoices(self, account, role, offset, limit, block):
        ids, total = self.contract.functions.getInvoiceIds(account, role == 'issued', offset, limit).call(block_identifier=block)
        return {'items': [self._read_invoice(i, block) for i in ids], 'total': str(total),
                'offset': str(offset), 'limit': limit, 'observedBlock': str(block)}

    def history(self, invoice_id, block):
        invoice = self.invoice(invoice_id, block)
        blocks = {int(invoice['createdBlock']), int(invoice['settledBlock'])} - {0}
        event_types = [self.contract.events.InvoiceCreated(), self.contract.events.InvoicePaid(),
                       self.contract.events.InvoiceCancelled()]
        decoders = {Web3.keccak(text=f"{event.abi['name']}({','.join(item['type'] for item in event.abi['inputs'])})").to_0x_hex(): event
                    for event in event_types}
        items = []
        for number in sorted(blocks):
            logs = self.w3.eth.get_logs({'address': self.address, 'fromBlock': number, 'toBlock': number,
                                         'topics': [None, '0x' + format(invoice_id, '064x')]})
            for log in logs:
                decoder = decoders.get(log['topics'][0].to_0x_hex()) if log['topics'] else None
                if decoder is None:
                    continue
                event = decoder.process_log(log)
                items.append({'event': event['event'], 'invoiceId': str(event['args']['invoiceId']),
                              'transactionHash': log['transactionHash'].to_0x_hex(),
                              'blockNumber': str(log['blockNumber']), 'transactionIndex': log['transactionIndex'],
                              'logIndex': log['logIndex']})
        items.sort(key=lambda item: (int(item['blockNumber']), item['transactionIndex'], item['logIndex']))
        expected = ['InvoiceCreated'] + ([] if invoice['status'] == 'Pending' else ['Invoice' + invoice['status']])
        if [item['event'] for item in items] != expected:
            raise ServiceError('HISTORY_UNAVAILABLE', 'Complete event history is temporarily unavailable. Try again.')
        return {'items': items, 'observedBlock': str(block)}

    def transaction(self, tx_hash, block):
        try:
            tx = self.w3.eth.get_transaction(tx_hash)
        except TransactionNotFound:
            return {'hash': tx_hash, 'status': 'unknown', 'observedBlock': str(block)}
        direct = tx['to'] is not None and tx['to'].lower() == self.address.lower()
        result = {'hash': tx_hash, 'from': tx['from'], 'observedBlock': str(block)}
        try:
            receipt = self.w3.eth.get_transaction_receipt(tx_hash)
        except TransactionNotFound:
            # A routed wallet call cannot be attributed before its receipt exists.
            return {**result, 'status': 'pending' if direct else 'unknown'}
        events = []
        if receipt.status == 1:
            for log in receipt.logs:
                if log['address'].lower() != self.address.lower():
                    continue
                for event_type in [self.contract.events.InvoiceCreated, self.contract.events.InvoicePaid,
                                   self.contract.events.InvoiceCancelled]:
                    from web3.exceptions import MismatchedABI
                    try:
                        event = event_type().process_log(log)
                        events.append({'event': event['event'], 'invoiceId': str(event['args']['invoiceId'])})
                        break
                    except MismatchedABI:
                        continue
        # Wallets may wrap a call in another contract. Only this verified contract's
        # decoded events in a successful receipt establish a routed interaction.
        if not direct and not events:
            raise ServiceError('UNRELATED_TRANSACTION', 'No confirmed FreelancePay event was found in this transaction.', 400)
        return {**result, 'status': 'confirmed' if receipt.status == 1 else 'reverted',
                'blockNumber': str(receipt.blockNumber), 'blockHash': receipt.blockHash.to_0x_hex(),
                'gasUsed': str(receipt.gasUsed), 'events': events}
