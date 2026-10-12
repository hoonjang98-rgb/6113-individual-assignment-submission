import json
from pathlib import Path

import pytest
from web3 import Web3
from web3.exceptions import ContractLogicError, Web3RPCError

REVERT = (ContractLogicError, Web3RPCError)
VALUE = 10**15


def issue(contract, transact, accounts, issuer=0, client=1, value=VALUE, reference="INV-001"):
    receipt = transact(contract.functions.createInvoice(accounts[client], value, reference), accounts[issuer])
    invoice_id = contract.events.InvoiceCreated().process_receipt(receipt)[0]['args']['invoiceId']
    return invoice_id, receipt


def test_create_records_immutable_facts_and_event(contract, transact, accounts):
    invoice_id, receipt = issue(contract, transact, accounts)
    invoice = contract.functions.getInvoice(invoice_id).call()
    assert invoice[:4] == (accounts[0], accounts[1], VALUE, "INV-001")
    assert invoice[4] > 0 and invoice[5] == 0
    assert invoice[6] == receipt.blockNumber and invoice[7] == 0 and invoice[8] == 0
    assert contract.functions.invoiceCount().call() == 1


def test_exact_payment_transfers_and_marks_paid(contract, transact, accounts, w3):
    invoice_id, _ = issue(contract, transact, accounts)
    before = w3.eth.get_balance(accounts[0])
    receipt = transact(contract.functions.payInvoice(invoice_id), accounts[1], VALUE)
    invoice = contract.functions.getInvoice(invoice_id).call()
    assert w3.eth.get_balance(accounts[0]) - before == VALUE
    assert w3.eth.get_balance(contract.address) == 0
    assert invoice[8] == 1 and invoice[7] == receipt.blockNumber and invoice[5] >= invoice[4]
    event = contract.events.InvoicePaid().process_receipt(receipt)[0]['args']
    assert dict(event) == {'invoiceId': invoice_id, 'issuer': accounts[0], 'client': accounts[1], 'amountWei': VALUE}


@pytest.mark.parametrize('value', [0, VALUE - 1, VALUE + 1])
def test_wrong_payment_value_rejected_without_state_change(contract, transact, accounts, value):
    invoice_id, _ = issue(contract, transact, accounts)
    with pytest.raises(REVERT):
        contract.functions.payInvoice(invoice_id).transact({'from': accounts[1], 'value': value})
    assert contract.functions.getInvoice(invoice_id).call()[8] == 0


@pytest.mark.parametrize('caller', [0, 2])
def test_wrong_payer_rejected(contract, transact, accounts, caller):
    invoice_id, _ = issue(contract, transact, accounts)
    with pytest.raises(REVERT):
        contract.functions.payInvoice(invoice_id).transact({'from': accounts[caller], 'value': VALUE})


def test_duplicate_payment_and_cancel_after_payment_rejected(contract, transact, accounts, w3):
    invoice_id, _ = issue(contract, transact, accounts)
    transact(contract.functions.payInvoice(invoice_id), accounts[1], VALUE)
    before = w3.eth.get_balance(accounts[0])
    for function, sender, value in [(contract.functions.payInvoice(invoice_id), accounts[1], VALUE),
                                    (contract.functions.cancelInvoice(invoice_id), accounts[0], 0)]:
        with pytest.raises(REVERT):
            function.transact({'from': sender, 'value': value})
    assert w3.eth.get_balance(accounts[0]) == before


def test_issuer_cancel_then_pay_or_repeat_cancel_rejected(contract, transact, accounts, w3):
    invoice_id, _ = issue(contract, transact, accounts)
    receipt = transact(contract.functions.cancelInvoice(invoice_id), accounts[0])
    assert contract.functions.getInvoice(invoice_id).call()[8] == 2
    assert len(contract.events.InvoiceCancelled().process_receipt(receipt)) == 1
    assert w3.eth.get_balance(contract.address) == 0
    for function, sender, value in [(contract.functions.payInvoice(invoice_id), accounts[1], VALUE),
                                    (contract.functions.cancelInvoice(invoice_id), accounts[0], 0)]:
        with pytest.raises(REVERT):
            function.transact({'from': sender, 'value': value})


@pytest.mark.parametrize('caller', [1, 2])
def test_nonissuer_cannot_cancel(contract, transact, accounts, caller):
    invoice_id, _ = issue(contract, transact, accounts)
    with pytest.raises(REVERT):
        contract.functions.cancelInvoice(invoice_id).transact({'from': accounts[caller]})


@pytest.mark.parametrize('reference', ['', ' ', ' padded', 'padded ', 'x' * 33, 'line\nbreak', '\x00', '\u00e9'])
def test_invalid_reference_rejected(contract, accounts, reference):
    with pytest.raises(REVERT):
        contract.functions.createInvoice(accounts[1], VALUE, reference).transact({'from': accounts[0]})


@pytest.mark.parametrize('reference', ['A', 'A' * 32, 'INV / 001', '<b>PUBLIC</b>'])
def test_valid_reference_boundaries(contract, transact, accounts, reference):
    invoice_id, _ = issue(contract, transact, accounts, reference=reference)
    assert contract.functions.getInvoice(invoice_id).call()[3] == reference


def test_invalid_client_and_zero_amount(contract, accounts):
    for client, amount in [('0x' + '0' * 40, VALUE), (accounts[0], VALUE), (accounts[1], 0)]:
        with pytest.raises(REVERT):
            contract.functions.createInvoice(client, amount, 'INV').transact({'from': accounts[0]})


@pytest.mark.parametrize('invoice_id', [0, 1, 2**256 - 1])
def test_missing_invoice_rejected(contract, accounts, invoice_id):
    for function in [contract.functions.getInvoice(invoice_id), contract.functions.cancelInvoice(invoice_id),
                     contract.functions.payInvoice(invoice_id)]:
        with pytest.raises(REVERT):
            function.call({'from': accounts[0]})


def test_pagination_and_role_isolation(contract, transact, accounts):
    for n in range(7):
        issue(contract, transact, accounts, reference=f'INV-{n}')
    issue(contract, transact, accounts, issuer=2, client=3)
    assert contract.functions.getInvoiceIds(accounts[0], True, 0, 3).call() == [[7, 6, 5], 7]
    assert contract.functions.getInvoiceIds(accounts[1], False, 3, 3).call() == [[4, 3, 2], 7]
    assert contract.functions.getInvoiceIds(accounts[0], True, 6, 3).call() == [[1], 7]
    assert contract.functions.getInvoiceIds(accounts[0], True, 7, 3).call() == [[], 7]
    assert contract.functions.getInvoiceIds(accounts[0], True, 2**256 - 1, 50).call() == [[], 7]
    assert contract.functions.getInvoiceIds(accounts[0], False, 0, 20).call() == [[], 0]


@pytest.mark.parametrize('limit', [0, 51, 2**256 - 1])
def test_invalid_page_limit(contract, accounts, limit):
    with pytest.raises(REVERT):
        contract.functions.getInvoiceIds(accounts[0], True, 0, limit).call()


def test_payment_failure_rolls_back_and_can_be_retried(contract, deploy, transact, accounts, w3):
    recipient = deploy('TestRecipient', contract.address)
    transact(recipient.functions.issue(accounts[1], VALUE, 'REJECT'), accounts[0])
    invoice_id = recipient.functions.invoiceId().call()
    transact(recipient.functions.setMode(1), accounts[0])
    # Explicit gas submits a mined revert, rather than only a failed estimate.
    tx = contract.functions.payInvoice(invoice_id).transact({'from': accounts[1], 'value': VALUE, 'gas': 500000})
    receipt = w3.eth.wait_for_transaction_receipt(tx)
    assert receipt.status == 0 and len(receipt.logs) == 0
    invoice = contract.functions.getInvoice(invoice_id).call()
    assert invoice[8] == 0 and invoice[5] == 0 and invoice[7] == 0
    assert w3.eth.get_balance(contract.address) == 0 and w3.eth.get_balance(recipient.address) == 0
    transact(recipient.functions.setMode(0), accounts[0])
    transact(contract.functions.payInvoice(invoice_id), accounts[1], VALUE)
    assert w3.eth.get_balance(recipient.address) == VALUE


@pytest.mark.parametrize('mode', [2, 3])
def test_recipient_reentry_is_blocked_while_payment_succeeds(contract, deploy, transact, accounts, mode):
    recipient = deploy('TestRecipient', contract.address)
    transact(recipient.functions.issue(accounts[1], VALUE, 'REENTRY'), accounts[0])
    invoice_id = recipient.functions.invoiceId().call()
    transact(recipient.functions.setMode(mode), accounts[0])
    transact(contract.functions.payInvoice(invoice_id), accounts[1], VALUE)
    assert recipient.functions.callbackSucceeded().call() is False
    assert recipient.functions.callbackData().call()[:4] == Web3.keccak(text='ReentrantCall()')[:4]
    assert contract.functions.getInvoice(invoice_id).call()[8] == 1
    assert contract.functions.invoiceCount().call() == 1


def test_invoices_do_not_share_state_or_recipient(contract, transact, accounts, w3):
    first, _ = issue(contract, transact, accounts)
    second, _ = issue(contract, transact, accounts, issuer=2, client=1, value=7)
    first_balance = w3.eth.get_balance(accounts[0])
    second_balance = w3.eth.get_balance(accounts[2])
    transact(contract.functions.payInvoice(second), accounts[1], 7)
    assert w3.eth.get_balance(accounts[0]) == first_balance
    assert w3.eth.get_balance(accounts[2]) == second_balance + 7
    assert contract.functions.getInvoice(first).call()[8] == 0


def test_plain_transfer_rejected(contract, accounts, w3):
    with pytest.raises(REVERT):
        w3.eth.send_transaction({'from': accounts[0], 'to': contract.address, 'value': 1})


def test_runtime_matches_build(contract, w3):
    artifact = json.loads((Path(__file__).resolve().parents[1] / 'build/FreelancePay.json').read_text())
    assert w3.eth.get_code(contract.address).to_0x_hex() == artifact['deployedBytecode']
