import { BrowserProvider, Contract, getAddress, parseEther, formatEther, ZeroAddress, MaxUint256 } from './vendor/ethers.min.js';

const $ = (id) => document.getElementById(id);
const disconnectKey = 'freelancepay:wallet-disconnected';
const selectedAccountKey = 'freelancepay:wallet-account';
let preferredAccount = null;
try { const saved = sessionStorage.getItem(selectedAccountKey); if (saved) preferredAccount = getAddress(saved); } catch { /* A saved public address never grants wallet permission. */ }
let locallyDisconnected = false;
try { locallyDisconnected = localStorage.getItem(disconnectKey) === 'true'; } catch { /* In-memory disconnect still works. */ }
const state = { config: null, wallet: null, account: null, accounts: [], chain: null, ready: false, role: 'issued', offset: 0n,
  total: 0n, context: 0, listRequest: 0, detailRequest: 0, busy: false, walletAction: null, locallyDisconnected,
  balanceBusy: false, balanceRequest: 0, handoff: null, invoice: null, draft: null, pending: null,
  page: null, listBusy: false, statusFilter: 'all', connectRequest: null, connectionCheckBusy: false };
const announced = [];
window.addEventListener('eip6963:announceProvider', ({ detail }) => {
  if (detail?.info?.rdns === 'io.metamask') announced.push(detail.provider);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
const short = (value) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '';
const eth = (value) => `${formatEther(BigInt(value))} ETH`;
function authorizedAccounts(accounts) {
  return [...new Set((Array.isArray(accounts) ? accounts : []).flatMap(account => {
    try { return [getAddress(account)]; } catch { return []; }
  }))];
}
function preferAccount(account) {
  preferredAccount = account;
  try { if (account) sessionStorage.setItem(selectedAccountKey, account); else sessionStorage.removeItem(selectedAccountKey); } catch { /* Selection still works for the current page. */ }
}
function chainTime(value) {
  try {
    const seconds = BigInt(value);
    if (seconds <= 0n || seconds > 8640000000000n) return 'Time unavailable';
    return new Date(Number(seconds) * 1000).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'short', hour12: false,
    });
  } catch { return 'Time unavailable'; }
}
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', error); };
const walletNotice = (message, error = false) => { $('wallet-status').hidden = !message; $('wallet-status').textContent = message; $('wallet-status').classList.toggle('error', error); };
const rightNetwork = () => state.config && BigInt(state.chain || 0) === BigInt(state.config.chainId);
function connectionNotice() {
  // Keep a failed health check visible when existing wallet permission is restored.
  if (!state.ready) return;
  if (!state.account) notice(state.locallyDisconnected ? 'Disconnected from FreelancePay. Use Connect MetaMask when you are ready.' : 'Connect MetaMask to create, pay and verify your invoices.');
  else if (!rightNetwork()) notice(`Your wallet must use ${state.config.networkName} to create or pay an invoice.`, true);
  else notice('Your wallet is connected. Select an invoice or create a new request.');
}
async function api(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'This request could not finish. Try again.');
  return data;
}
function empty(title, description) {
  const box = node('div', undefined, 'empty'); box.append(node('h3', title), node('p', description));
  $('invoice-list').replaceChildren(box);
}
function controls() {
  const walletBusy = state.busy || Boolean(state.walletAction) || state.connectionCheckBusy;
  const writable = state.account && state.ready && rightNetwork() && !walletBusy && !state.pending;
  $('new-invoice').disabled = !writable;
  $('connect').disabled = walletBusy || Boolean(state.account) || !state.config;
  $('connect').textContent = state.account ? `✓ Connected · ${short(state.account)}` : state.walletAction === 'connect' ? 'Waiting for MetaMask…' : 'Connect MetaMask ↗';
  $('check-connection').hidden = Boolean(state.account) && state.walletAction !== 'connect';
  $('check-connection').disabled = state.busy || state.connectionCheckBusy || Boolean(state.walletAction && state.walletAction !== 'connect') || !state.config;
  $('check-connection').textContent = state.connectionCheckBusy ? 'Checking connection…' : 'Check connection';
  $('switch-account').hidden = !state.account; $('switch-account').disabled = walletBusy;
  $('switch-account').textContent = state.walletAction === 'switch' ? 'Choose in MetaMask…' : 'Switch account';
  $('disconnect').hidden = !state.account && state.walletAction !== 'disconnect'; $('disconnect').disabled = walletBusy;
  $('disconnect').textContent = state.walletAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect';
  $('account').textContent = state.account || 'Wallet not connected';
  $('wallet-connection-details').hidden = !state.account;
  $('wallet-accounts').replaceChildren(...state.accounts.map(account =>
    node('li', `${account}${typeof account === 'string' && account.toLowerCase() === state.account?.toLowerCase() ? ' — Used for actions' : ''}`, 'address')));
  $('wallet-account-count').textContent = `MetaMask shares ${state.accounts.length} account${state.accounts.length === 1 ? '' : 's'} with this page.`;
  const availableAccounts = authorizedAccounts(state.accounts);
  $('account-picker').hidden = !state.account || availableAccounts.length < 2;
  $('active-account').replaceChildren(...availableAccounts.map(account => { const option = node('option', account); option.value = account; return option; }));
  $('active-account').value = state.account || '';
  $('active-account').disabled = walletBusy || availableAccounts.length < 2;
  $('network').textContent = state.config ? `${state.config.networkName}${state.account && !rightNetwork() ? ' · Switch your wallet network' : ''}` : 'Configuration unavailable';
  $('network-dot').classList.toggle('ready', Boolean(state.ready && (!state.account || rightNetwork())));
  $('switch').hidden = !state.account || rightNetwork(); $('switch').disabled = walletBusy;
  $('switch').textContent = state.walletAction === 'network' ? 'Switching network…' : `Switch to ${state.config?.networkName || 'required network'}`;
  $('wallet-balance').hidden = !state.account;
  $('refresh-balance').disabled = walletBusy || state.balanceBusy || !rightNetwork();
  $('refresh-balance').textContent = state.balanceBusy ? 'Refreshing…' : 'Refresh balance';
  $('previous').disabled = !state.account || state.listBusy || state.offset === 0n;
  $('next').disabled = !state.account || state.listBusy || !state.page || state.offset + 20n >= state.total;
  $('status-filter').disabled = !state.account || state.listBusy || !state.page;
  $('confirm-invoice').disabled = !writable;
  $('confirm-action').disabled = !writable;
  for (const button of $('detail-actions').querySelectorAll('button')) button.disabled = button.dataset.walletAction ? walletBusy : !writable;
}
function clearReview() {
  state.draft = null; $('review').hidden = true; $('confirm-invoice').hidden = true; $('edit-invoice').hidden = true; $('review-invoice').hidden = false;
  for (const id of ['reference', 'client', 'amount']) $(id).disabled = false;
}
function clearWalletView() {
  ++state.context; ++state.detailRequest; ++state.balanceRequest;
  state.account = null; state.accounts = []; state.invoice = null; state.offset = 0n; state.total = 0n;
  state.page = null; state.listBusy = false; state.statusFilter = 'all'; $('status-filter').value = 'all';
  state.chain = null; state.balanceBusy = false; actionDraft = null;
  $('detail').hidden = true; $('create-dialog').close(); $('action-dialog').close(); clearReview();
  $('detail-actions').replaceChildren(); $('page-info').textContent = 'No account selected';
  $('balance-value').textContent = '—'; $('balance-status').textContent = '';
  empty('Your invoices start here.', 'Connect MetaMask to see invoices for your account.'); controls();
}
function setDisconnected(value) {
  state.locallyDisconnected = value;
  if (value) preferAccount(null);
  try { localStorage.setItem(disconnectKey, String(value)); } catch { /* No wallet credentials are stored. */ }
}
function readWallet(method, params) {
  // Only bound read requests. A timeout never cancels or repeats an approval or transaction.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Wallet read timed out')), 10000);
    Promise.resolve().then(() => state.wallet.request({ method, ...(params ? { params } : {}) }))
      .then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
function finishConnection(request) {
  if (!request || state.connectRequest !== request) return;
  clearTimeout(request.waitHint); state.connectRequest = null;
  if (state.walletAction === 'connect') state.walletAction = null;
  controls();
}
async function refreshBalance() {
  if (!state.account || state.locallyDisconnected) return;
  const version = state.context, request = ++state.balanceRequest, account = state.account;
  if (!rightNetwork()) { $('balance-value').textContent = '—'; $('balance-status').textContent = 'Switch to the required network to read its test balance.'; return; }
  state.balanceBusy = true; $('balance-status').textContent = 'Reading the wallet balance…'; controls();
  try {
    const [chain, balance] = await Promise.all([readWallet('eth_chainId'), readWallet('eth_getBalance', [account, 'latest'])]);
    if (version !== state.context || request !== state.balanceRequest || state.locallyDisconnected) return;
    if (BigInt(chain) !== BigInt(state.config.chainId)) { await walletContext(); return; }
    $('balance-value').textContent = eth(balance);
    $('balance-status').textContent = `Balance updated at ${new Date().toLocaleTimeString('en-GB')}. Network fees are separate.`;
  } catch {
    if (version === state.context && request === state.balanceRequest) { $('balance-value').textContent = 'Unavailable'; $('balance-status').textContent = 'Balance could not be read. Use Refresh balance to retry.'; }
  } finally { if (request === state.balanceRequest) { state.balanceBusy = false; controls(); } }
}
async function walletContext() {
  if (state.locallyDisconnected) return;
  clearWalletView(); const version = state.context;
  controls(); empty('Updating wallet…', 'Refreshing this account and network.');
  try {
    const [accounts, chain] = await Promise.all([readWallet('eth_accounts'), readWallet('eth_chainId')]);
    if (version !== state.context || state.locallyDisconnected) return;
    const available = authorizedAccounts(accounts);
    if (preferredAccount && !available.includes(preferredAccount)) preferAccount(null);
    if (state.handoff && available.includes(state.handoff.account)) preferAccount(state.handoff.account);
    state.account = preferredAccount || available[0] || null; state.accounts = accounts.slice(); state.chain = chain; controls();
    if (state.account && state.connectRequest) {
      finishConnection(state.connectRequest);
      walletNotice('Connected. Use Issued by you to request payment or Sent to you to pay an invoice.');
    }
    connectionNotice();
    if (!state.account) { empty('Your invoices start here.', 'Connect MetaMask to see invoices for your account.'); $('page-info').textContent = 'No account selected'; return; }
    const handoff = state.handoff;
    const reachedTarget = handoff && state.account === handoff.account && rightNetwork();
    if (reachedTarget) setRole(handoff.role);
    await Promise.all([loadInvoices(), refreshBalance()]);
    if (version !== state.context) return;
    if (reachedTarget) {
      await showInvoice(handoff.invoiceId, true);
      if (version === state.context) { state.handoff = null; walletNotice(`Connected to ${state.account}. Invoice #${handoff.invoiceId} is ready to review.`); }
    }
    return true;
  } catch { if (version === state.context) { notice('Could not read the wallet account and network. Open MetaMask in this browser, then use Check connection.', true); walletNotice('MetaMask did not answer the wallet read. Approve or cancel any pending connection in its tab, then use Check connection. If you cancelled the request, reload this page before retrying.', true); controls(); } return false; }
}
function selectWallet() {
  if (!state.wallet) {
    state.wallet = announced[0] || window.ethereum?.providers?.find((p) => p.isMetaMask) || (window.ethereum?.isMetaMask ? window.ethereum : null);
    if (state.wallet) for (const name of ['accountsChanged', 'chainChanged', 'disconnect']) state.wallet.on(name, walletContext);
  }
  return state.wallet;
}
$('connect').addEventListener('click', async () => {
  if (state.walletAction || state.busy || state.connectionCheckBusy || state.account || !state.config) return;
  const request = { waitHint: null, keepPending: false }; state.connectRequest = request;
  state.walletAction = 'connect'; controls(); walletNotice('Approve this site’s connection in MetaMask. If no approval window appears, open the MetaMask tab in this browser. Return here and use Check connection after approving.');
  request.waitHint = setTimeout(() => {
    if (state.connectRequest === request) walletNotice('Still waiting for MetaMask. Open its tab in this browser and approve this site’s pending connection. Then return and use Check connection. This button reads the current permission without sending another approval request.');
  }, 8000);
  try {
    if (!selectWallet()) { walletNotice('MetaMask was not detected on this page. Enable it for this site in the same browser and reload.', true); return; }
    await state.wallet.request({ method: 'eth_requestAccounts' });
    if (state.connectRequest !== request) return;
    setDisconnected(false); const refreshed = await walletContext();
    if (state.connectRequest !== request || refreshed === false) return;
    walletNotice(state.account ? 'Connected. Use Issued by you to request payment or Sent to you to pay an invoice.' : 'MetaMask did not expose an account. Connect an account to this site.', !state.account);
  } catch (error) {
    if (state.connectRequest !== request) return;
    request.keepPending = (error?.code ?? error?.info?.error?.code) === -32002;
    walletNotice(request.keepPending ? 'A connection request is already waiting in MetaMask. Open its tab in this browser and approve it, then use Check connection. If you cancel it, reload this page before retrying.' : walletRequestError(error), true);
  } finally { clearTimeout(request.waitHint); if (!request.keepPending) finishConnection(request); }
});
$('check-connection').addEventListener('click', async () => {
  if (state.busy || state.connectionCheckBusy || (state.walletAction && state.walletAction !== 'connect') || !state.config) return;
  if (!selectWallet()) { walletNotice('MetaMask was not detected on this page. Enable it for this site in the same browser and reload.', true); return; }
  if (state.locallyDisconnected && !state.connectRequest) { walletNotice('You disconnected from this app. Use Connect MetaMask to start a new connection.'); return; }
  const version = state.context; state.connectionCheckBusy = true; controls();
  walletNotice('Checking which accounts MetaMask currently allows this site to use…');
  try {
    const accounts = await readWallet('eth_accounts');
    if (version !== state.context) return;
    if (!accounts.length) {
      walletNotice(state.connectRequest ? 'MetaMask has not allowed an account yet. Open its tab and approve the pending request for this site, then check again. If you cancelled it, reload this page before retrying.' : 'MetaMask is available, but this site has no account permission. Use Connect MetaMask and approve the request.', true);
      return;
    }
    setDisconnected(false); await walletContext();
  } catch {
    if (version === state.context) walletNotice('MetaMask did not answer the connection check. Open its tab in this browser and complete or cancel the pending request. A check does not send a new approval request.', true);
  } finally { state.connectionCheckBusy = false; controls(); }
});
function walletRequestError(error) {
  const code = error?.code ?? error?.info?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'The wallet request was cancelled. Your existing connection is unchanged.';
  if (code === -32002) return 'A request is already waiting in MetaMask. Open the extension and complete or cancel that request.';
  if (code === -32601 || code === 4200) return 'This wallet cannot open account selection here. Use MetaMask to change the account connected to this site, then refresh this page.';
  return 'The wallet request could not finish. Open MetaMask, check its connection to this site, and try again.';
}
async function switchAccount(handoff = null) {
  if (!state.wallet || !state.account || state.busy || state.walletAction) return;
  if (handoff && authorizedAccounts(state.accounts).includes(handoff.account)) return useConnectedAccount(handoff.account, handoff);
  if (!handoff && authorizedAccounts(state.accounts).length > 1) {
    $('account-picker').scrollIntoView({ block: 'center' }); $('active-account').focus();
    walletNotice('Choose Account for this app to use an already connected account. MetaMask will still ask you to approve each transaction.'); return;
  }
  const previousAccount = state.account;
  state.handoff = handoff; state.walletAction = 'switch';
  $('create-dialog').close(); $('action-dialog').close(); clearReview(); actionDraft = null;
  controls(); walletNotice(handoff ? `Choose ${handoff.account} in MetaMask. Select only that account for this step, then confirm the connection.` : 'Choose another account in MetaMask and confirm its connection to this site. If no window appears, open the extension.');
  try {
    await state.wallet.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
    state.handoff = handoff;
    await walletContext();
    if (handoff && state.account !== handoff.account) walletNotice(`MetaMask still exposes ${state.account || 'no account'}. Use Switch account and select only ${handoff.account} to continue this invoice.`, true);
    else if (state.account === previousAccount) walletNotice('MetaMask returned the same account. If more than one is connected, choose Account for this app. Otherwise, connect another account in MetaMask.');
    else if (!handoff) walletNotice(`Account changed to ${state.account || 'no account'}. Choose Sent to you to pay a request or Issued by you to create one.`);
  } catch (error) { walletNotice(walletRequestError(error), true); }
  finally { state.walletAction = null; controls(); }
}
async function useConnectedAccount(value, handoff = null) {
  if (!state.wallet || !state.account || state.busy || state.walletAction || state.connectionCheckBusy) { controls(); return; }
  let target;
  try { target = getAddress(value); } catch { controls(); return; }
  const version = state.context;
  state.walletAction = 'account'; state.handoff = handoff;
  $('create-dialog').close(); $('action-dialog').close(); clearReview(); actionDraft = null; controls();
  try {
    const available = authorizedAccounts(await readWallet('eth_accounts'));
    if (version !== state.context || state.locallyDisconnected) return;
    if (!available.includes(target)) {
      await walletContext(); walletNotice('This account is no longer connected. Connect it in MetaMask before choosing it here.', true); return;
    }
    preferAccount(target); await walletContext();
    if (state.account === target) walletNotice(`Using ${target} for this app. Choose Sent to you for received invoices or Issued by you for your requests.`);
  } catch { walletNotice('The connected accounts could not be checked. Try again after MetaMask is available.', true); }
  finally { state.walletAction = null; controls(); }
}
$('active-account').addEventListener('change', event => useConnectedAccount(event.target.value));
$('switch-account').addEventListener('click', () => switchAccount(state.handoff));
$('disconnect').addEventListener('click', async () => {
  if (!state.wallet || state.busy || state.walletAction) return;
  state.walletAction = 'disconnect'; state.handoff = null; setDisconnected(true); clearWalletView(); connectionNotice();
  walletNotice('Disconnecting this site from MetaMask…');
  try {
    await state.wallet.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
    walletNotice('Disconnected from FreelancePay and account permission revoked. This does not lock MetaMask itself. Submitted transactions are unchanged.');
  } catch {
    walletNotice('Disconnected from this app. MetaMask could not revoke its site permission; you can remove it in MetaMask. Automatic reconnection is off. Submitted transactions are unchanged.', true);
  } finally { state.walletAction = null; controls(); }
});
window.addEventListener('storage', event => {
  if (event.key === disconnectKey && event.newValue === 'true') { setDisconnected(true); state.handoff = null; clearWalletView(); connectionNotice(); walletNotice('Disconnected in another tab. Use Connect MetaMask to reconnect here.'); }
});
$('refresh-balance').addEventListener('click', refreshBalance);
$('switch').addEventListener('click', async () => {
  if (!state.wallet || state.busy || state.walletAction) return;
  const handoff = state.handoff;
  state.walletAction = 'network'; controls(); walletNotice('Complete the network request in MetaMask.');
  try { await state.wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${BigInt(state.config.chainId).toString(16)}` }] }); state.handoff = handoff; await walletContext(); }
  catch (error) { walletNotice(walletRequestError(error), true); }
  finally { state.walletAction = null; controls(); if (rightNetwork()) walletNotice(`Your wallet is on ${state.config.networkName}.`); }
});
async function health() {
  state.ready = false; controls();
  try { await api('/api/health'); state.ready = true; connectionNotice(); }
  catch (error) { notice(`${error.message} Use Refresh to retry the network check.`, true); }
  controls();
}
async function loadInvoices() {
  if (!state.account) return;
  const version = state.context, request = ++state.listRequest;
  const account = state.account, role = state.role, offset = state.offset;
  state.listBusy = true; state.page = null; controls(); $('page-info').textContent = 'Loading this page…';
  empty('Loading invoices…', 'Reading confirmed records from the network.');
  try {
    const data = await api(`/api/invoices?address=${encodeURIComponent(account)}&role=${role}&offset=${offset}`);
    if (version !== state.context || request !== state.listRequest) return;
    state.total = BigInt(data.total); state.page = data; renderInvoices();
  } catch (error) {
    if (version === state.context && request === state.listRequest) {
      empty('Invoices unavailable.', `${error.message} Use Refresh to retry${offset > 0n ? ' or Previous to return to the earlier page' : ''}.`);
      $('page-info').textContent = 'This page could not be loaded'; notice(error.message, true);
    }
  } finally { if (version === state.context && request === state.listRequest) { state.listBusy = false; controls(); } }
}
function renderInvoices() {
  const data = state.page;
  if (!data) return;
  const rows = state.statusFilter === 'all' ? data.items : data.items.filter(invoice => invoice.status === state.statusFilter);
  $('invoice-list').replaceChildren();
  if (!rows.length) {
    if (state.statusFilter !== 'all') empty(`No ${state.statusFilter.toLowerCase()} invoices on this page.`, 'Choose All statuses to see this page, or use Previous and Next to check other pages.');
    else empty('No invoices on this page.', state.role === 'issued' ? 'Create a payment request for your client to get started.' : 'Invoices addressed to this wallet will appear here.');
  }
  for (const invoice of rows) {
    const row = node('button', undefined, 'invoice-row'); row.type = 'button'; row.setAttribute('aria-label', `Open invoice ${invoice.id}, ${invoice.reference}, ${invoice.status}`);
    const heading = node('div'); heading.append(node('strong', invoice.reference), node('span', `Invoice #${invoice.id}`, 'small'));
    row.append(heading, node('span', short(state.role === 'issued' ? invoice.client : invoice.issuer), 'address'), node('span', eth(invoice.amountWei), 'amount'), node('span', invoice.status, `status ${invoice.status.toLowerCase()}`));
    row.addEventListener('click', () => showInvoice(invoice.id, true)); $('invoice-list').append(row);
  }
  const offset = BigInt(data.offset), from = data.items.length ? offset + 1n : 0n, to = data.items.length ? offset + BigInt(data.items.length) : 0n;
  $('page-info').textContent = state.statusFilter === 'all'
    ? `${data.total} ${state.role} · ${from}–${to} shown · Block ${data.observedBlock}`
    : `${rows.length} ${state.statusFilter.toLowerCase()} on this page · ${data.total} ${state.role} · Page ${from}–${to} · Block ${data.observedBlock}`;
}
$('status-filter').addEventListener('change', () => { state.statusFilter = $('status-filter').value; renderInvoices(); });
function setRole(role) {
  state.role = role; state.offset = 0n;
  ++state.listRequest; state.page = null; state.total = 0n; state.listBusy = false;
  state.statusFilter = 'all'; $('status-filter').value = 'all'; controls();
  for (const tab of ['issued', 'received']) { $(tab).classList.toggle('active', tab === role); $(tab).setAttribute('aria-pressed', String(tab === role)); }
  $('role-help').textContent = role === 'received' ? 'These requests can be paid by the connected account. Open an invoice to review its payment.' : 'To request a payment, create an invoice. To pay a request, choose Sent to you.';
}
for (const role of ['issued', 'received']) $(role).addEventListener('click', () => { setRole(role); loadInvoices(); });
$('previous').addEventListener('click', () => { state.offset = state.offset >= 20n ? state.offset - 20n : 0n; loadInvoices(); });
$('next').addEventListener('click', () => { state.offset += 20n; loadInvoices(); });
$('refresh').addEventListener('click', async () => { await health(); await loadInvoices(); if (state.invoice) await showInvoice(state.invoice.id); });
function facts(entries) {
  const list = node('dl', undefined, 'facts');
  for (const [label, value] of entries) { const item = node('div'); item.append(node('dt', label), node('dd', value)); list.append(item); }
  return list;
}
async function showInvoice(id, focusDetail = false) {
  const version = state.context, request = ++state.detailRequest;
  const restoreFocus = focusDetail || $('detail').contains(document.activeElement);
  $('detail-actions').replaceChildren(); $('detail').hidden = true;
  try {
    const data = await api(`/api/invoices/${id}`);
    if (version !== state.context || request !== state.detailRequest) return;
    state.invoice = data.invoice; const invoice = data.invoice;
    $('detail-title').textContent = `${invoice.reference} · #${id}`;
    $('detail-content').replaceChildren(node('span', invoice.status, `status ${invoice.status.toLowerCase()}`), facts([
      ['Amount', eth(invoice.amountWei)], ['Created', chainTime(invoice.createdAt)],
      ...(invoice.status === 'Pending' ? [] : [[invoice.status === 'Paid' ? 'Paid at' : 'Cancelled at', chainTime(invoice.settledAt)]]),
      ['Freelancer / issuer', invoice.issuer], ['Designated client', invoice.client], ['Observed block', data.observedBlock],
    ]));
    const handoffButton = (label, account, role) => {
      const button = node('button', label, 'button secondary'); button.dataset.walletAction = 'switch';
      button.addEventListener('click', () => switchAccount({ account, role, invoiceId: invoice.id }));
      $('detail-actions').append(button);
    };
    if (invoice.status === 'Pending' && state.account && invoice.client !== state.account) {
      $('detail-actions').append(node('p', `Next: payment by ${invoice.client}. If you control this test account, switch to it to review the payment.`, 'next-step'));
      handoffButton('Switch to client wallet', invoice.client, 'received');
    } else if (invoice.status === 'Paid' && state.account === invoice.client) {
      $('detail-actions').append(node('p', 'Payment is confirmed. You can switch to the issuer wallet to verify the same payment record.', 'next-step'));
      handoffButton('Switch to issuer wallet', invoice.issuer, 'issued');
    }
    const action = invoice.status === 'Pending' && state.account ? (invoice.client === state.account ? 'pay' : invoice.issuer === state.account ? 'cancel' : null) : null;
    if (action) {
      const button = node('button', action === 'pay' ? `Review payment · ${eth(invoice.amountWei)}` : 'Cancel unpaid invoice', action === 'pay' ? 'button primary' : 'text-button');
      button.addEventListener('click', () => reviewAction(action, invoice)); $('detail-actions').append(button);
    } else if (invoice.status === 'Pending') $('detail-actions').append(node('p', 'Only the designated client can pay; only the issuer can cancel.', 'small'));
    controls();
    $('detail').hidden = false; $('history').textContent = 'Reading event history…';
    if (restoreFocus) { $('detail').setAttribute('tabindex', '-1'); $('detail').focus({ preventScroll: true }); if (focusDetail) $('detail').scrollIntoView({ behavior: 'instant', block: 'start' }); }
    const history = await api(`/api/invoices/${id}/history`);
    if (version !== state.context || request !== state.detailRequest) return;
    $('history').replaceChildren();
    for (const event of history.items) {
      const item = node('div', undefined, 'activity'), metadata = node('div', undefined, 'activity-meta');
      const timestamp = event.event === 'InvoiceCreated' && event.blockNumber === invoice.createdBlock ? invoice.createdAt
        : event.event === `Invoice${invoice.status}` && event.blockNumber === invoice.settledBlock ? invoice.settledAt : null;
      metadata.append(node('span', event.event.replace('Invoice', 'Invoice ')), node('span', `${chainTime(timestamp)} · Block ${event.blockNumber}`, 'small'));
      item.append(metadata);
      const link = node('a', 'Transaction ↗');
      if (state.config.explorerUrl) { link.href = `${state.config.explorerUrl}/tx/${event.transactionHash}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link); }
      else item.append(node('span', short(event.transactionHash), 'address'));
      $('history').append(item);
    }
  } catch (error) { if (version === state.context && request === state.detailRequest) { $('history').textContent = error.message; notice(error.message, true); } }
}
$('close-detail').addEventListener('click', () => { ++state.detailRequest; state.invoice = null; $('detail').hidden = true; });
$('new-invoice').addEventListener('click', () => { $('create-form').reset(); $('form-error').textContent = ''; clearReview(); $('create-dialog').showModal(); });
$('close-create').addEventListener('click', () => $('create-dialog').close());
$('edit-invoice').addEventListener('click', clearReview);
$('create-form').addEventListener('submit', (event) => {
  event.preventDefault(); $('form-error').textContent = '';
  try {
    const reference = $('reference').value;
    if (!/^[\x20-\x7e]{1,32}$/.test(reference) || reference !== reference.trim()) throw new Error('Use 1–32 printable English characters with no leading or trailing spaces.');
    let client;
    try { client = getAddress($('client').value.trim()); } catch { throw new Error('Enter a valid Ethereum client address.'); }
    if (client === ZeroAddress || client === state.account) throw new Error('The client must be a different, nonzero wallet address.');
    const amount = $('amount').value.trim();
    if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(amount)) throw new Error('Enter a plain decimal amount with at most 18 decimal places.');
    const amountWei = parseEther(amount);
    if (amountWei <= 0n || amountWei > MaxUint256) throw new Error('Enter a positive amount within the supported range.');
    state.draft = { reference, client, amountWei, issuer: state.account };
    $('review').replaceChildren(node('strong', 'Check your request'), node('p', `Reference: ${reference}`), node('p', `Client: ${client}`), node('p', `Amount: ${eth(amountWei)}`), node('p', `Issuer: ${state.account}`));
    $('review').hidden = false; $('confirm-invoice').hidden = false; $('edit-invoice').hidden = false; $('review-invoice').hidden = true;
    for (const id of ['reference', 'client', 'amount']) $(id).disabled = true;
    $('confirm-invoice').focus();
  } catch (error) { $('form-error').textContent = error.message; }
});
$('confirm-invoice').addEventListener('click', () => {
  const draft = state.draft; if (!draft || draft.issuer !== state.account) return;
  $('create-dialog').close(); submit('create', null, draft);
});
let actionDraft;
function reviewAction(action, invoice) {
  actionDraft = { action, invoice, account: state.account };
  $('action-title').textContent = action === 'pay' ? 'Review your payment' : 'Cancel this invoice?';
  $('action-review').replaceChildren(facts([['Invoice', `${invoice.reference} · #${invoice.id}`], ['Amount', eth(invoice.amountWei)], ['Recipient', invoice.issuer], ['Client', invoice.client]]), node('p', action === 'pay' ? 'The exact invoice amount goes directly to the issuer. This payment cannot be reversed here.' : 'Cancellation is permanent. The client will no longer be able to pay this invoice.', 'small'));
  $('action-dialog').showModal();
}
$('close-action').addEventListener('click', () => $('action-dialog').close());
$('confirm-action').addEventListener('click', () => {
  if (!actionDraft || actionDraft.account !== state.account) return;
  $('action-dialog').close(); submit(actionDraft.action, actionDraft.invoice);
});
function walletError(error) {
  const code = error?.code ?? error?.info?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'The wallet request was declined. No transaction was submitted by this request.';
  if (code === 'INSUFFICIENT_FUNDS') return 'This wallet needs enough test ETH for the amount and network fee.';
  if (code === -32002) return 'A request is already open in MetaMask. Complete or decline it there.';
  if (code === 'CALL_EXCEPTION') return 'This action is no longer permitted, or the recipient cannot receive payment. Refresh the invoice and check its details.';
  if (code === 'NETWORK_ERROR') return 'The wallet network changed. Reconnect on the expected network and check any submitted transaction.';
  return error?.userMessage || 'The request could not finish. Check the wallet, network and current invoice details.';
}
const pendingKey = () => `freelancepay:${state.config.chainId}:${state.config.contractAddress}:pending`;
function savePending(value) {
  state.pending = value;
  try { if (value) sessionStorage.setItem(pendingKey(), JSON.stringify(value)); else sessionStorage.removeItem(pendingKey()); } catch { /* The visible hash remains usable. */ }
}
function txView(title, description, pending = state.pending) {
  $('transaction').hidden = false; $('tx-title').textContent = title; $('tx-description').textContent = description;
  $('tx-link').textContent = pending?.hash || ''; $('tx-link').removeAttribute('href');
  if (pending?.hash && state.config.explorerUrl) $('tx-link').href = `${state.config.explorerUrl}/tx/${pending.hash}`;
  $('tx-origin').textContent = pending ? `${state.config.networkName} · Submitted by ${pending.account}` : '';
  $('check-transaction').hidden = !pending; $('check-transaction').disabled = state.busy;
}
async function checkPending() {
  const pending = state.pending; if (!pending) return;
  try {
    const result = await api(`/api/transactions/${pending.hash}`);
    if (state.pending?.hash !== pending.hash) return;
    if (result.status === 'confirmed' || result.status === 'reverted') {
      txView(result.status === 'confirmed' ? 'Transaction confirmed' : 'Transaction reverted', result.status === 'confirmed' ? 'The transaction receipt confirms success. Invoice details below come from the current chain state.' : 'The transaction failed on-chain. Its requested changes were rolled back; the network fee may still apply.', pending);
      savePending(null); $('check-transaction').hidden = true;
      controls();
      await loadInvoices();
      const invoiceId = result.events?.[0]?.invoiceId || pending.invoiceId;
      if (invoiceId && state.account === pending.account) await showInvoice(invoiceId, true);
    } else txView(result.status === 'pending' ? 'Awaiting confirmation' : 'Outcome not yet available', 'Keep this transaction hash and check again. Do not send a duplicate request while its outcome is uncertain.', pending);
  } catch (error) { txView('Confirmation unavailable', `${error.message} Keep the hash and check again.`, pending); }
}
async function submit(action, invoice, draft) {
  if (state.busy || state.pending || state.walletAction) { notice('Complete the wallet request or check the previous transaction before submitting another request.', true); return; }
  if (!state.account || !rightNetwork() || !state.ready) { notice('Connect the correct account and network first.', true); return; }
  state.busy = true; controls(); const account = state.account, version = state.context;
  txView('Checking request', 'Checking current chain state before opening MetaMask.', null);
  try {
    await api('/api/health');
    // Capture the hash at the wallet boundary before ethers fetches the transaction.
    // A chain change after approval must not lose the submitted transaction.
    const guardedWallet = { request: async (request) => {
      if (request.method === 'eth_requestAccounts' || request.method === 'wallet_requestPermissions') {
        throw { code: 4100, message: 'Connect the selected account explicitly, then review the transaction again.' };
      }
      if (request.method === 'eth_sendTransaction') {
        const [chain, accounts] = await Promise.all([
          state.wallet.request({ method: 'eth_chainId' }), state.wallet.request({ method: 'eth_accounts' }),
        ]);
        if (version !== state.context || state.account !== account || BigInt(chain) !== BigInt(state.config.chainId)
          || !authorizedAccounts(accounts).includes(account) || request.params?.[0]?.from?.toLowerCase() !== account.toLowerCase()) {
          throw { code: 4901, message: 'The wallet context changed before submission.' };
        }
      }
      const result = await state.wallet.request(request);
      if (request.method === 'eth_sendTransaction' && /^0x[0-9a-fA-F]{64}$/.test(result)) {
        savePending({ hash: result, account, action, invoiceId: invoice?.id || null });
        txView('Awaiting confirmation', 'Your request was submitted. It is not confirmed yet.');
      }
      return result;
    } };
    const available = authorizedAccounts(await readWallet('eth_accounts'));
    if (version !== state.context || !available.includes(account)) throw { userMessage: 'The selected account is no longer connected. Connect it and review the request again.' };
    const provider = new BrowserProvider(guardedWallet, Number(state.config.chainId)); const signer = await provider.getSigner(account);
    if (version !== state.context || !rightNetwork()) throw { userMessage: 'The wallet context changed. Review the request again.' };
    const contract = new Contract(state.config.contractAddress, state.config.abi, signer);
    if (invoice) {
      const current = await contract.getInvoice(BigInt(invoice.id));
      if (Number(current.status) !== 0 || (action === 'pay' ? current.client : current.issuer) !== account || current.amountWei !== BigInt(invoice.amountWei)) throw { userMessage: 'The invoice or permitted account changed. Refresh and review it again.' };
    }
    if (version !== state.context || !rightNetwork()) throw { userMessage: 'The wallet context changed. Review the request again.' };
    txView('Awaiting wallet approval', 'Review the account, network, amount and fee in MetaMask.', null);
    const overrides = { chainId: BigInt(state.config.chainId) };
    const tx = action === 'create' ? await contract.createInvoice(draft.client, draft.amountWei, draft.reference, overrides)
      : action === 'pay' ? await contract.payInvoice(BigInt(invoice.id), { ...overrides, value: BigInt(invoice.amountWei) })
        : await contract.cancelInvoice(BigInt(invoice.id), overrides);
    savePending({ hash: tx.hash, account, action, invoiceId: invoice?.id || null });
    txView('Awaiting confirmation', 'Your request was submitted. It is not confirmed yet.');
    try { await tx.wait(1, 90000); }
    catch (error) {
      if (error.code === 'TRANSACTION_REPLACED' && error.receipt) {
        if (error.cancelled) { txView('Transaction replaced or cancelled', 'The original request was replaced. Refresh the invoice to see its current state.', state.pending); savePending(null); $('check-transaction').hidden = true; await loadInvoices(); return; }
        savePending({ ...state.pending, hash: error.receipt.hash });
      } else if (!error.receipt) throw error;
    }
    await checkPending();
  } catch (error) {
    if (state.pending) await checkPending();
    else { const message = walletError(error); txView('Request not completed', message, null); notice(message, true); }
  } finally { state.busy = false; controls(); $('check-transaction').disabled = false; if (state.invoice) await showInvoice(state.invoice.id); await refreshBalance(); }
}
$('check-transaction').addEventListener('click', checkPending);
try {
  state.config = await api('/api/config');
  if (state.config.explorerUrl && state.config.contractAddress) { $('contract-link').href = `${state.config.explorerUrl}/address/${state.config.contractAddress}`; $('contract-link').hidden = false; }
  await health();
  try {
    const pending = JSON.parse(sessionStorage.getItem(pendingKey()) || 'null');
    if (pending && /^0x[0-9a-fA-F]{64}$/.test(pending.hash) && /^0x[0-9a-fA-F]{40}$/.test(pending.account)) { state.pending = pending; txView('Checking previous transaction', 'Recovering the outcome from the network.'); await checkPending(); }
  } catch { /* Untrusted or unavailable session data is ignored. */ }
  // Restore existing site permission without opening a wallet approval request.
  if (selectWallet() && !state.locallyDisconnected) await walletContext();
} catch { notice('Application setup is unavailable. Refresh the page to retry.', true); }
controls();
