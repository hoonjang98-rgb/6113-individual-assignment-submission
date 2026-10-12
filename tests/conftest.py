"""Isolated local-chain fixtures. No personal wallet keys are used."""
import json
import os
from pathlib import Path
import socket
import subprocess
import time

import pytest
from web3 import Web3

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def w3():
    node = os.environ.get("NODE_BINARY", "node")
    result = subprocess.run(
        [node, str(ROOT / "tools/anvil-path.mjs")], capture_output=True,
        text=True, check=True, cwd=ROOT,
    )
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    child = subprocess.Popen(
        [result.stdout.strip(), "--host", "127.0.0.1", "--port", str(port),
         "--chain-id", "31337", "--hardfork", "shanghai", "--silent"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    chain = Web3(Web3.HTTPProvider(f"http://127.0.0.1:{port}", request_kwargs={"timeout": 5}))
    try:
        for _ in range(100):
            if child.poll() is not None:
                raise RuntimeError("Local test chain exited before readiness")
            if chain.is_connected():
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Local test chain unavailable")
        assert chain.eth.chain_id == 31337
        yield chain
    finally:
        child.terminate()
        child.wait(timeout=10)


@pytest.fixture(autouse=True)
def isolated_chain(w3):
    snapshot = w3.provider.make_request("evm_snapshot", [])['result']
    yield
    assert w3.provider.make_request("evm_revert", [snapshot])['result'] is True


@pytest.fixture
def accounts(w3):
    return w3.eth.accounts


@pytest.fixture
def deploy(w3, accounts):
    def deploy_contract(name, *args):
        artifact = json.loads((ROOT / "build" / f"{name}.json").read_text(encoding="utf-8"))
        factory = w3.eth.contract(abi=artifact['abi'], bytecode=artifact['bytecode'])
        receipt = w3.eth.wait_for_transaction_receipt(factory.constructor(*args).transact({'from': accounts[0]}))
        assert receipt.status == 1
        return w3.eth.contract(address=receipt.contractAddress, abi=artifact['abi'])
    return deploy_contract


@pytest.fixture
def contract(deploy):
    return deploy('FreelancePay')


@pytest.fixture
def transact(w3):
    def send(function, sender, value=0):
        tx = function.transact({'from': sender, 'value': value})
        receipt = w3.eth.wait_for_transaction_receipt(tx)
        assert receipt.status == 1
        return receipt
    return send
