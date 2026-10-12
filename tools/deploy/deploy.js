import { BrowserProvider, ContractFactory, formatEther, getAddress } from '/ethers.js';

const $ = (id) => document.getElementById(id);
const CHAIN = '0xaa36a7';
const providers = [];
let wallet, artifact, busy = false, record, context = 0;
let connecting = false, connectionState = 'idle', connectionErrorCode = null;
let activeAccount = null, activeChain = null, balanceWei = null;
let switching = false, networkPending = false, refreshingBalance = false;
let deploymentHash = '';
const pageId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
let lastObservation = { walletDetected: false, account: null, chainId: null };
let reportQueue = Promise.resolve();
function shareConnection(observation) {
  lastObservation = observation;
  if (!artifact?.connectionReportToken) return Promise.resolve();
  const payload = { pageId, ...observation, connectionState, errorCode: connectionErrorCode,
    deploymentHash: /^0x[0-9a-fA-F]{64}$/.test(deploymentHash) ? deploymentHash : null };
  reportQueue = reportQueue.then(async () => {
    try {
      const response = await fetch('/connection-status', { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Connection-Token': artifact.connectionReportToken,
      }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Connection report unavailable');
      $('connection-report').textContent = 'Connection status shared locally. Codex can check it now.';
    } catch { $('connection-report').textContent = 'Local connection check could not finish. Reload this page to retry.'; }
  });
  return reportQueue;
}
function selectWallet() {
  if (wallet) return wallet;
  wallet = providers[0] || window.ethereum?.providers?.find((provider) => provider.isMetaMask) || (window.ethereum?.isMetaMask ? window.ethereum : null);
  if (wallet) for (const event of ['accountsChanged', 'chainChanged']) wallet.on(event, () => refresh().catch(connectionReadError));
  return wallet;
}
function walletState(state, message, code = null) {
  connectionState = state; connectionErrorCode = code;
  $('wallet-status').textContent = message;
  renderControls();
  void shareConnection({ ...lastObservation, walletDetected: Boolean(wallet) });
}
function renderControls() {
  const connectionPending = connecting || connectionState === 'pending';
  $('connect').disabled = connectionPending || busy || switching || Boolean(activeAccount);
  $('connect').textContent = activeAccount ? '✓ Connected' : connectionPending ? 'Waiting for MetaMask…' : 'Connect MetaMask';
  $('connect').classList.toggle('is-active', Boolean(activeAccount));
  const onSepolia = activeChain === CHAIN;
  $('switch').disabled = !wallet || busy || connecting || switching || networkPending || onSepolia;
  $('switch').textContent = switching || networkPending ? 'Waiting for MetaMask…' : onSepolia ? '✓ Sepolia active' : 'Switch to Sepolia';
  $('switch').classList.toggle('is-active', onSepolia && !switching);
  $('refresh-wallet').disabled = refreshingBalance || busy;
  $('refresh-wallet').textContent = refreshingBalance ? 'Refreshing…' : 'Refresh balance';
  $('check').disabled = !wallet || busy || connecting || switching || networkPending;
  $('deploy').disabled = busy || connecting || switching || networkPending || !artifact || !activeAccount || !onSepolia || balanceWei === null || balanceWei === 0n || Boolean(deploymentHash) || Boolean(record);
}
function numericCode(error) {
  const code = error?.code ?? error?.info?.error?.code;
  return Number.isInteger(code) && code >= -100000 && code <= 100000 ? code : null;
}
function connectionReadError(error) {
  activeAccount = null; activeChain = null; balanceWei = null;
  $('account').textContent = 'Unavailable'; $('network').textContent = 'Unavailable'; $('balance').textContent = 'Unavailable';
  $('balance-panel').setAttribute('aria-busy', 'false');
  $('balance-status').textContent = 'Refresh failed. Open MetaMask and try again.';
  walletState('read-error', 'Could not read the wallet. Open MetaMask in this browser, unlock it, then select Refresh balance.', numericCode(error));
}
function readWallet(method, params) {
  // Read timeouts do not cancel or retry account approvals or transactions.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Wallet read timed out')), 10000);
    Promise.resolve().then(() => wallet.request({ method, ...(params ? { params } : {}) })).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
const storedHash = () => { try { return sessionStorage.getItem('freelancepay-deployment') || ''; } catch { return ''; } };
deploymentHash = storedHash();
$('hash').value = deploymentHash;
function remember(hash) {
  deploymentHash = hash; $('hash').value = hash;
  try { if (hash) sessionStorage.setItem('freelancepay-deployment', hash); else sessionStorage.removeItem('freelancepay-deployment'); } catch { /* Hash also remains in memory and on screen. */ }
  void shareConnection(lastObservation);
}
window.addEventListener('eip6963:announceProvider', (event) => {
  if (event.detail?.info?.rdns === 'io.metamask') providers.push(event.detail.provider);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
const say = (message) => { $('status').textContent = message; };
function errorText(error) {
  const code = error?.code ?? error?.info?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'The wallet request was declined. No new deployment is confirmed.';
  if (code === 'INSUFFICIENT_FUNDS') return 'This account needs Sepolia test ETH for the network fee.';
  return 'The wallet request could not finish. If a hash is shown, check that transaction before retrying.';
}
async function refresh() {
  const version = ++context;
  balanceWei = null;
  $('balance-panel').classList.remove('refresh-complete');
  $('balance-panel').setAttribute('aria-busy', 'true');
  $('balance-status').textContent = 'Refreshing account, network and balance…';
  renderControls();
  if (!wallet) {
    activeAccount = null; activeChain = null;
    $('balance-panel').setAttribute('aria-busy', 'false');
    $('balance-status').textContent = 'MetaMask is not available in this browser.';
    walletState('not-detected', 'MetaMask is not available in this browser. Open this page in the Chrome profile where MetaMask is installed.');
    await shareConnection({ walletDetected: false, account: null, chainId: null }); return null;
  }
  let accounts, chain;
  try { accounts = await readWallet('eth_accounts'); chain = await readWallet('eth_chainId'); }
  catch (error) { if (version === context) connectionReadError(error); return; }
  if (version !== context) return;
  const account = accounts[0] ? getAddress(accounts[0]) : null;
  activeAccount = account; activeChain = chain;
  if (chain === CHAIN) {
    networkPending = false;
    if (!switching) $('network-status').textContent = 'Sepolia is already active. No network change is needed.';
  } else if (!switching && !networkPending) $('network-status').textContent = 'Select Switch to Sepolia to request a network change in MetaMask.';
  $('account').textContent = account || 'Not connected';
  $('network').textContent = chain === CHAIN ? 'Ethereum Sepolia · 11155111' : `Wrong network (${chain}). Switch to Sepolia.`;
  $('balance').textContent = account && chain === CHAIN ? 'Checking…' : 'Not checked';
  // A late approval can be observed through this read even if its popup was hidden.
  if (account && !connecting) walletState('connected', 'Account connected. Check the network and balance before deploying.');
  else if (!account && connectionState === 'connected') walletState('idle', 'No account is shared with this page. Select Connect MetaMask.');
  else if (!account && connectionState === 'idle') walletState('idle', 'MetaMask detected. Select Connect MetaMask to request account access.');
  void shareConnection({ walletDetected: true, account, chainId: BigInt(chain).toString() });
  let balance = null;
  try { if (account && chain === CHAIN) balance = await readWallet('eth_getBalance', [account, 'latest']); }
  catch {
    if (version !== context) return;
    $('balance').textContent = 'Unavailable';
    $('balance-panel').setAttribute('aria-busy', 'false');
    $('balance-status').textContent = 'Balance refresh failed. Select Refresh balance to retry.';
    if (!connecting) walletState('connected', 'Account connected, but the balance could not be read. Select Refresh balance to retry.');
    return account;
  }
  if (version !== context) return;
  balanceWei = balance === null ? null : BigInt(balance);
  $('balance').textContent = balance === null ? 'Not checked' : `${formatEther(BigInt(balance))} Sepolia ETH`;
  $('balance-panel').setAttribute('aria-busy', 'false');
  $('balance-status').textContent = balance === null ? (account ? 'Switch to Sepolia to read your test ETH balance.' : 'Connect MetaMask to read your balance.') : `Updated at ${new Date().toLocaleTimeString('en-GB')}`;
  if (balance !== null) $('balance-panel').classList.add('refresh-complete');
  renderControls();
  return account;
}
$('connect').addEventListener('click', async () => {
  if (connecting || connectionState === 'pending' || busy || switching || activeAccount) return;
  let waitHint;
  try {
    if (!selectWallet()) { await refresh(); return; }
    connecting = true;
    $('deploy').disabled = true; $('switch').disabled = true; $('check').disabled = true;
    walletState('requesting', 'Connection request sent. Open MetaMask in this browser and review the account connection.');
    waitHint = setTimeout(() => walletState('waiting', 'Still waiting for MetaMask. Open the wallet directly in this browser, unlock it and look for the pending connection request. If this browser cannot show approvals, use regular Chrome.'), 8000);
    // Keep this permission request directly within the button's user gesture.
    const accounts = await wallet.request({ method: 'eth_requestAccounts' });
    clearTimeout(waitHint); connecting = false;
    if (!Array.isArray(accounts) || !accounts.length) {
      walletState('empty-account', 'MetaMask returned no account. Open the wallet and review this site’s account permissions, then retry.');
      await refresh(); return;
    }
    const account = await refresh();
    if (!account && account !== undefined) walletState('empty-account', 'The wallet has not shared an account with this page. Open MetaMask and review this site’s account permissions.');
  } catch (error) {
    clearTimeout(waitHint); connecting = false;
    const code = numericCode(error);
    if (code === -32002) walletState('pending', 'MetaMask already has a connection request pending (-32002). Open MetaMask in this browser to approve or dismiss it. After approving, select Refresh balance. After dismissing, reload this page before retrying.', code);
    else if (code === 4001) walletState('rejected', 'Connection was declined in MetaMask (4001). Select Connect MetaMask when you are ready to approve account access.', code);
    else if (code === 4200 || code === -32601) walletState('unsupported', 'This wallet connection method is unavailable in this browser. Open the page in regular Chrome with MetaMask.', code);
    else if (code === 4900 || code === 4901) walletState('disconnected', 'MetaMask cannot reach the requested network. Open the wallet, check its network connection, then select Refresh balance.', code);
    else walletState('error', `The connection request failed${code === null ? '' : ` (${code})`}. Open MetaMask directly in this browser and check for a pending request.`, code);
  } finally {
    clearTimeout(waitHint); connecting = false;
    renderControls();
  }
});
$('refresh-wallet').addEventListener('click', async () => {
  if (refreshingBalance || busy) return;
  refreshingBalance = true; renderControls();
  try { selectWallet(); await refresh(); }
  catch (error) { connectionReadError(error); }
  finally { refreshingBalance = false; renderControls(); }
});
$('switch').addEventListener('click', async () => {
  if (!wallet || busy || connecting || switching || networkPending) return;
  if (activeChain === CHAIN) { $('network-status').textContent = 'Sepolia is already active. No network change is needed.'; return; }
  let waitHint;
  switching = true; renderControls();
  $('network-status').textContent = 'Network change requested. Review the Sepolia request in MetaMask.';
  try {
    waitHint = setTimeout(() => { $('network-status').textContent = 'Still waiting for MetaMask. Open the wallet directly to review the network request.'; }, 8000);
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN }] });
    clearTimeout(waitHint);
    await refresh();
    $('network-status').textContent = activeChain === CHAIN ? 'Network updated. Sepolia is active.' : 'The wallet did not switch to Sepolia. Check MetaMask before retrying.';
  } catch (error) {
    const code = numericCode(error);
    if (code === 4001) $('network-status').textContent = 'Network change declined in MetaMask (4001). You can retry when ready.';
    else if (code === -32002) {
      networkPending = true;
      $('network-status').textContent = 'A network request is already pending in MetaMask (-32002). Open it to approve or dismiss the request. After approving, select Refresh balance. After dismissing, reload before retrying.';
    } else if (code === 4902) $('network-status').textContent = 'MetaMask does not recognize Sepolia (4902). Add or enable Sepolia in MetaMask, then retry.';
    else $('network-status').textContent = `Could not change the network${code === null ? '' : ` (${code})`}. Open MetaMask to check the request, then retry.`;
  } finally { clearTimeout(waitHint); switching = false; renderControls(); }
});
async function verify(hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid transaction hash');
  if (await wallet.request({ method: 'eth_chainId' }) !== CHAIN) { say('Switch to Sepolia before checking.'); return; }
  const provider = new BrowserProvider(wallet, 11155111);
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) { say('No receipt is available yet. Keep the hash and check again later.'); return; }
  if (receipt.status !== 1) {
    say('The deployment transaction reverted. It did not create a usable contract. Review the failure before retrying.');
    if (hash.toLowerCase() === deploymentHash.toLowerCase()) { remember(''); $('hash').value = hash; await refresh(); }
    return;
  }
  const tx = await provider.getTransaction(hash);
  if (!tx || tx.to !== null || tx.data.toLowerCase() !== artifact.bytecode.toLowerCase() || tx.value !== 0n || !receipt.contractAddress) {
    say('This transaction does not deploy the expected FreelancePay build.'); return;
  }
  const code = await provider.getCode(receipt.contractAddress);
  if (code.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) { say('The runtime code does not match the tested build.'); return; }
  if (await wallet.request({ method: 'eth_chainId' }) !== CHAIN) { say('Network changed during verification. Switch to Sepolia and check again.'); return; }
  record = { chainId: 11155111, contractAddress: receipt.contractAddress, transactionHash: receipt.hash,
    deployer: tx.from, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
    gasUsed: receipt.gasUsed.toString(), compiler: artifact.compiler, sourceSha256: artifact.sourceSha256,
    verification: 'Successful wallet receipt, expected creation data, exact runtime code', recordedAt: new Date().toISOString() };
  remember(receipt.hash);
  $('result').textContent = JSON.stringify(record, null, 2);
  $('explorer').href = `https://sepolia.etherscan.io/tx/${receipt.hash}`; $('explorer').hidden = false;
  $('download').disabled = false; say('Deployment verified. Share the contract address or transaction hash with Codex.');
  await refresh();
}
$('deploy').addEventListener('click', async () => {
  if (busy || deploymentHash || record) return;
  busy = true;
  try {
    await refresh();
    if (await wallet.request({ method: 'eth_chainId' }) !== CHAIN) { say('Switch to Sepolia first.'); return; }
    say('Review the Sepolia deployment and network fee in MetaMask.');
    const guardedWallet = { request: async (request) => {
      if (request.method === 'eth_sendTransaction' && await wallet.request({ method: 'eth_chainId' }) !== CHAIN) throw new Error('Wrong network');
      const result = await wallet.request(request);
      if (request.method === 'eth_sendTransaction' && /^0x[0-9a-fA-F]{64}$/.test(result)) {
        remember(result); say('Deployment submitted. Keep the hash while waiting for a receipt.');
      }
      return result;
    } };
    const provider = new BrowserProvider(guardedWallet, 11155111);
    const signer = await provider.getSigner();
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy({ chainId: 11155111 });
    const tx = contract.deploymentTransaction();
    remember(tx.hash);
    say('Deployment submitted. Keep the hash while waiting for a receipt.');
    await tx.wait(1, 120000); await verify(tx.hash);
  } catch (error) { say(errorText(error)); }
  finally { busy = false; await refresh().catch(() => {}); }
});
$('check').addEventListener('click', async () => {
  try { await verify($('hash').value.trim()); } catch { say('Could not verify this hash. Check its format, your network and the wallet connection.'); }
});
$('download').addEventListener('click', () => {
  if (!record) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'freelancepay-sepolia-deployment.json'; anchor.click(); URL.revokeObjectURL(url);
});
try {
  const response = await fetch('/artifact'); if (!response.ok) throw new Error('Build unavailable');
  artifact = await response.json(); $('build').textContent = `${artifact.compiler}\nSHA-256 ${artifact.sourceSha256}`;
} catch { say('The verified build is unavailable. Ask Codex to check the local setup.'); $('build').textContent = 'Build unavailable'; }
if (artifact) {
  try { selectWallet(); await refresh(); }
  catch (error) { connectionReadError(error); }
}
