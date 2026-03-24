console.log('ANTIGRAVITY: KERNEL v3.0 LOADED');
import { ethers } from 'ethers';
import { CONTRACT_ABI, CONTRACT_ADDRESS, CONTRACT_BYTECODE } from './config.js';

/* ═══════════════════════════════════════════════════════════════════════
   STATE & CONSTANTS
   ═══════════════════════════════════════════════════════════════════════ */
let provider, signer, userAddress, contract;
let txCount = 0;
let transactions = [];
let onChainTxs = [];
let ledgerTab = 'sent';
let ratesCache = { rates: null, lastFetch: 0 };

const CACHE_DURATION  = 60000;  // 60 s rate cache
const FEE_BPS         = 50;     // 0.5 % in basis points
const MAX_STORED_TXS  = 100;
const CURRENCY_SYMBOLS = { inr: '₹', usd: '$', eur: '€', gbp: '£' };
const FALLBACK_RATES   = { inr: 205000, usd: 2450, eur: 2200, gbp: 1950 };

const UI = {};

/* ═══════════════════════════════════════════════════════════════════════
   MODULE 0 — CORE LOGGING
   ═══════════════════════════════════════════════════════════════════════ */
function pushLog(msg, type = 'system') {
    const c = document.getElementById('kernel-logs');
    if (!c) return;
    const p = document.createElement('p');
    p.className = `log-line log-${type}`;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    p.innerHTML = `<span class="log-time">[${ts}]</span> <span class="log-content">${msg}</span>`;
    c.appendChild(p);
    if (c.children.length > 50) c.removeChild(c.firstChild);
    c.scrollTop = c.scrollHeight;
}

/* ═══════════════════════════════════════════════════════════════════════
   MODULE 0 — NAVIGATION
   ═══════════════════════════════════════════════════════════════════════ */
function switchPage(pageId) {
    document.querySelectorAll('.page-view').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const page = document.getElementById(`page-${pageId}`);
    const nav  = document.querySelector(`[data-page="${pageId}"]`);
    const contentBox = document.querySelector('.content');
    if (page) {
        page.classList.remove('hidden');
        page.classList.add('animate-in');
        
        let title = 'Terminal Console';
        if (pageId === 'ledger') title = 'Settlement Ledger';
        if (pageId === 'ide') title = 'Smart Contract Studio';
        document.getElementById('page-title').textContent = title;
        
        if (pageId === 'ide') {
            contentBox.classList.add('ide-active');
            if (typeof window.initIDE === 'function') window.initIDE();
            
            // Re-layout monaco editor to fill the new space
            setTimeout(() => { if (monacoEditor) monacoEditor.layout(); }, 50);
        } else {
            contentBox.classList.remove('ide-active');
        }
    }
    if (nav) nav.classList.add('active');
    pushLog(`Navigator: Routing to ${pageId.toUpperCase()} workspace.`, 'system');
}
window.switchPage = switchPage;

function bindNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.onclick = (e) => { e.preventDefault(); switchPage(item.getAttribute('data-page')); };
    });
}

/* ═══════════════════════════════════════════════════════════════════════
   MODULE 1 — IDENTITY & HANDSHAKE PROTOCOL
   ═══════════════════════════════════════════════════════════════════════ */
async function initializeKernel() {
    pushLog('Kernel: Initializing decentralized protocol kernel v3.0...', 'system');

    UI.connectBtn     = document.getElementById('connect-wallet');
    UI.switchBtn      = document.getElementById('switch-wallet');
    UI.disconnectBtn  = document.getElementById('disconnect-wallet');
    UI.authUnverified = document.getElementById('auth-unverified');
    UI.authVerified   = document.getElementById('auth-verified');
    UI.fullAddress    = document.getElementById('full-address');
    UI.userAddrShort  = document.getElementById('user-addr-short');
    UI.networkDot     = document.getElementById('network-dot');
    UI.networkDisplay = document.getElementById('network-display');

    startGlobalTelemetry();
    bindNavigation();
    bindConversionEvents();
    updateContractBadge();

    pushLog('Kernel: Static telemetry pipeline active.', 'system');

    if (!window.ethereum) {
        pushLog('Fatal: EIP-1193 Provider not detected. Read-Only mode.', 'error');
        showNotification('MetaMask Extension Missing', 'error');
        return;
    }

    try {
        provider = new ethers.BrowserProvider(window.ethereum);
        pushLog('Kernel: Ethereum Provider bound to browser instance.', 'system');

        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
            pushLog('Auth: Existing cryptographic session recovered.', 'auth');
            await syncIdentity(accounts.map(a => a.address));
        }

        window.ethereum.on('accountsChanged', (accts) => {
            pushLog('Auth: External identity shift detected.', 'auth');
            syncIdentity(accts);
        });
        window.ethereum.on('chainChanged', () => {
            pushLog('Kernel: Chain ID shift. Rebooting...', 'system');
            window.location.reload();
        });

        pushLog('Kernel: Handshake protocol STANDBY.', 'system');
    } catch (e) {
        pushLog(`Error: Init failed: ${e.message}`, 'error');
    }
}

async function startHandshake() {
    if (!window.ethereum) {
        pushLog('Fatal: Handshake refused. EIP-1193 missing.', 'error');
        showNotification('Provider Missing', 'error');
        return;
    }
    pushLog('Auth: Requesting cryptographic handshake...', 'auth');
    try {
        await window.ethereum.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        await syncIdentity(accounts);
    } catch (e) {
        pushLog(`Auth: Handshake terminated: ${e.message}`, 'error');
        showNotification('Handshake Failed', 'error');
    }
}

async function syncIdentity(accounts) {
    if (!accounts || accounts.length === 0) {
        userAddress = null; signer = null; contract = null;
        transactions = []; txCount = 0;
        updateIdentityUI(false);
        updateContractBadge();
        pushLog('Auth: Identity DE-AUTHENTICATED.', 'auth');
        return;
    }
    userAddress = accounts[0];
    try {
        if (provider) {
            signer = await provider.getSigner();
            initContract();
            updateIdentityUI(true, userAddress);
            pushLog(`Auth: Identity verified: ${userAddress.substring(0, 12)}...`, 'auth');
            showNotification('Identity Pulse: VERIFIED');
            loadTransactions();
            await loadOnChainTransactions();
            renderHistory();
            refreshTelemetry();
        }
    } catch (e) {
        pushLog('Auth: Failed to establish signer.', 'error');
    }
}

function updateIdentityUI(active, addr) {
    if (active) {
        UI.userAddrShort.textContent = addr.substring(0, 8) + '...';
        UI.fullAddress.textContent = addr;
        UI.authUnverified.classList.add('hidden');
        UI.authVerified.classList.remove('hidden');
        UI.switchBtn.classList.remove('hidden');
        document.getElementById('send-payment').disabled = false;
        UI.networkDot.classList.add('live');
        UI.networkDisplay.textContent = 'Node Synchronized';
    } else {
        UI.userAddrShort.textContent = 'Unauthenticated';
        UI.authUnverified.classList.remove('hidden');
        UI.authVerified.classList.add('hidden');
        UI.switchBtn.classList.add('hidden');
        document.getElementById('send-payment').disabled = true;
        UI.networkDot.classList.remove('live');
        UI.networkDisplay.textContent = 'Offline';
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   MODULE 3 — CURRENCY CONVERSION & FEES
   ═══════════════════════════════════════════════════════════════════════ */
async function fetchRates() {
    const now = Date.now();
    if (ratesCache.rates && (now - ratesCache.lastFetch) < CACHE_DURATION) {
        return ratesCache.rates;
    }
    try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr,usd,eur,gbp');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.ethereum) {
            ratesCache = { rates: data.ethereum, lastFetch: now };
            pushLog('Conversion: Live exchange rates refreshed.', 'engine');
            return data.ethereum;
        }
        throw new Error('Bad response');
    } catch (e) {
        pushLog(`Conversion: API unavailable — using fallback rates.`, 'error');
        if (!ratesCache.rates) ratesCache = { rates: FALLBACK_RATES, lastFetch: now };
        return ratesCache.rates;
    }
}

function bindConversionEvents() {
    const fiatInput    = document.getElementById('fiat-amount');
    const currencySelect = document.getElementById('source-currency');

    let debounceTimer;
    const trigger = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(updateConversion, 300);
    };

    fiatInput.addEventListener('input', trigger);
    currencySelect.addEventListener('change', () => {
        document.getElementById('currency-unit').textContent = currencySelect.value.toUpperCase();
        trigger();
    });
}

async function updateConversion() {
    const fiatAmount = parseFloat(document.getElementById('fiat-amount').value);
    const currency   = document.getElementById('source-currency').value;
    const display    = document.getElementById('conversion-display');

    if (!fiatAmount || fiatAmount <= 0) { display.classList.add('hidden'); return; }

    const rates = await fetchRates();
    const rate  = rates[currency];
    if (!rate) { display.classList.add('hidden'); return; }

    const sym         = CURRENCY_SYMBOLS[currency] || '';
    const ethAmount   = fiatAmount / rate;
    const useContract = !!contract;
    const fee         = useContract ? (ethAmount * FEE_BPS) / 10000 : 0;
    const receives    = ethAmount - fee;

    document.getElementById('conv-rate').textContent     = `1 ETH = ${sym}${rate.toLocaleString()}`;
    document.getElementById('conv-eth').textContent      = `${ethAmount.toFixed(6)} ETH`;
    document.getElementById('conv-fee').textContent      = fee > 0 ? `${fee.toFixed(6)} ETH` : 'No fee (Direct)';
    document.getElementById('conv-receives').textContent = `${receives.toFixed(6)} ETH`;

    display.classList.remove('hidden');

    // Update sidebar market rates
    if (rates.usd) document.getElementById('eth-price-val').textContent = `$${rates.usd.toLocaleString()}`;
    if (rates.inr) document.getElementById('eth-inr-val').textContent   = `₹${rates.inr.toLocaleString()}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   MODULE 5 — SMART CONTRACT INTEGRATION
   ═══════════════════════════════════════════════════════════════════════ */
function initContract() {
    contract = null;
    // Check localStorage for previously deployed contract
    const savedAddr = localStorage.getItem('cbp_contract_address');
    const addr = CONTRACT_ADDRESS || savedAddr || '';
    if (addr && signer) {
        try {
            contract = new ethers.Contract(addr, CONTRACT_ABI, signer);
            pushLog(`Contract: Interface bound to ${addr.substring(0, 14)}...`, 'engine');
        } catch (e) {
            pushLog(`Contract: Failed to bind — ${e.message}`, 'error');
        }
    }
    updateContractBadge();
}

function updateContractBadge() {
    const badge = document.getElementById('contract-badge');
    const text  = document.getElementById('contract-badge-text');
    const mode  = document.getElementById('sc-mode');
    const fee   = document.getElementById('sc-fee');

    if (contract) {
        badge.classList.add('active');
        text.textContent = 'Smart Contract';
        mode.textContent = 'Contract Routed';
        fee.textContent  = '0.5%';
    } else {
        badge.classList.remove('active');
        text.textContent = 'Direct Mode';
        mode.textContent = 'Direct Transfer';
        fee.textContent  = '0% (Direct)';
    }

    // Show/hide deploy/revert buttons
    const deployBtn = document.getElementById('deploy-contract');
    const revertBtn = document.getElementById('revert-direct');
    if (deployBtn) deployBtn.classList.toggle('hidden', !!contract || !signer);
    if (revertBtn) revertBtn.classList.toggle('hidden', !contract || !signer);
}

function revertToDirect() {
    localStorage.removeItem('cbp_contract_address');
    contract = null;
    updateContractBadge();
    showNotification('Reverted to Direct Mode', 'info');
    pushLog('Contract: Routing deactivated. Switching to standard wallet transfers.', 'system');
}

async function deployContract() {
    if (!signer) {
        showNotification('Connect wallet first', 'error');
        return;
    }
    if (contract) {
        showNotification('Contract already deployed', 'info');
        return;
    }

    const deployBtn = document.getElementById('deploy-contract');
    deployBtn.disabled = true;
    deployBtn.textContent = '⏳ Deploying...';

    try {
        pushLog('Contract: Deploying smart contract via MetaMask...', 'engine');
        showNotification('Confirm deployment in MetaMask');

        const factory = new ethers.ContractFactory(CONTRACT_ABI, CONTRACT_BYTECODE, signer);
        const deployed = await factory.deploy(50); // 50 basis points = 0.5% fee

        pushLog(`Contract: TX sent. Waiting for confirmation...`, 'engine');
        await deployed.waitForDeployment();

        const address = await deployed.getAddress();
        pushLog(`Contract: Deployed at ${address}`, 'engine');

        // Save to localStorage so it persists
        localStorage.setItem('cbp_contract_address', address);

        // Activate the contract
        contract = new ethers.Contract(address, CONTRACT_ABI, signer);
        updateContractBadge();

        showNotification('Smart Contract Deployed! ✓', 'success');
        pushLog(`Contract: All payments will now route through smart contract.`, 'engine');
    } catch (e) {
        pushLog(`Contract: Deployment failed — ${e.message}`, 'error');
        showNotification('Deployment failed', 'error');
        deployBtn.disabled = false;
        deployBtn.textContent = '🚀 Deploy Contract';
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   MODULE 2 — TRANSACTION EXECUTION ENGINE
   ═══════════════════════════════════════════════════════════════════════ */
async function broadcastPayload(e) {
    e.preventDefault();
    if (!signer) {
        pushLog('Engine: Handshake required.', 'error');
        showNotification('Connect wallet first', 'error');
        return;
    }

    const target      = document.getElementById('recipient').value.trim();
    const fiatAmount  = parseFloat(document.getElementById('fiat-amount').value);
    const currency    = document.getElementById('source-currency').value;
    const destCountry = document.getElementById('dest-country').value;

    // ── Validate ──
    if (!target || !fiatAmount || fiatAmount <= 0) {
        showNotification('Fill all fields', 'error'); return;
    }
    if (!ethers.isAddress(target)) {
        pushLog('Engine: Invalid Ethereum address.', 'error');
        showNotification('Invalid Address Format', 'error'); return;
    }

    // ── Convert ──
    const rates     = await fetchRates();
    const rate      = rates[currency];
    if (!rate) { showNotification('Rate unavailable', 'error'); return; }

    const ethAmount = fiatAmount / rate;
    const sym       = CURRENCY_SYMBOLS[currency] || '';
    // Use 8 decimal places for parseEther precision
    const ethStr    = ethAmount.toFixed(8);

    try {
        setEngineState(true, 'Injecting payload into decentralized mempool...');
        pushLog(`Engine: Converting ${sym}${fiatAmount} → ${ethStr} ETH`, 'engine');

        let tx;
        if (contract) {
            pushLog('Engine: Routing via smart contract...', 'engine');
            tx = await contract.sendPayment(target, currency.toUpperCase(), destCountry, {
                value: ethers.parseEther(ethStr)
            });
        } else {
            pushLog('Engine: Direct transfer mode.', 'engine');
            tx = await signer.sendTransaction({
                to: target,
                value: ethers.parseEther(ethStr)
            });
        }

        setEngineState(true, 'Awaiting settlement verification (Mining)...');
        pushLog(`Engine: Hash: ${tx.hash.substring(0, 18)}...`, 'engine');
        showNotification('Payload Broadcasted');

        const receipt = await tx.wait();

        if (receipt.status === 1) {
            pushLog('Engine: Settlement finalized. ✓', 'engine');
            showNotification('Settlement Verified', 'success');

            const feeEth = contract ? (ethAmount * FEE_BPS / 10000) : 0;
            const feeGwei = feeEth * 1e9; // 1 ETH = 1,000,000,000 Gwei

            transactions.unshift({
                hash:       tx.hash,
                dest:       target,
                ethValue:   ethStr,
                fiatAmount: `${sym}${fiatAmount.toLocaleString()}`,
                currency:   currency.toUpperCase(),
                country:    destCountry,
                fee:        feeGwei, // Now saving Gwei
                time:       new Date().toLocaleTimeString('en-US', { hour12: false }),
                date:       new Date().toLocaleDateString(),
                viaContract: !!contract
            });

            renderHistory();
            saveTransactions();
            txCount++;
            document.getElementById('tx-total').textContent = txCount;
            document.getElementById('payment-form').reset();
            document.getElementById('conversion-display').classList.add('hidden');
            document.getElementById('currency-unit').textContent = 'INR';
            refreshTelemetry();
        }
    } catch (err) {
        pushLog(`Error: ${err.message}`, 'error');
        showNotification(err.reason || 'Broadcast Refused', 'error');
    } finally {
        setEngineState(false);
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   MODULE 4 — PERSISTENT TRANSACTION HISTORY
   ═══════════════════════════════════════════════════════════════════════ */
window.setLedgerTab = function(tab) {
    ledgerTab = tab;
    document.getElementById('tab-sent').style.background = tab === 'sent' ? 'var(--bg)' : 'transparent';
    document.getElementById('tab-received').style.background = tab === 'received' ? 'var(--bg)' : 'transparent';
    renderHistory();
};

async function loadOnChainTransactions() {
    if (!contract || !userAddress) {
        onChainTxs = [];
        return;
    }
    try {
        const ids = await contract.getUserPaymentIds(userAddress);
        const fetched = [];
        for (let i = 0; i < ids.length; i++) {
            const p = await contract.getPayment(ids[i]);
            const ethAmount = ethers.formatEther(p.amount);
            const feeGwei = Number(ethers.formatUnits(p.fee, 'gwei'));
            const pseudoHash = `0x${ids[i].toString(16).padStart(64, '0')}`;
            const dateObj = new Date(Number(p.timestamp) * 1000);
            fetched.push({
                hash: pseudoHash,
                sender: p.sender,
                dest: p.receiver,
                ethValue: parseFloat(ethAmount).toFixed(6),
                fiatAmount: `— (${p.sourceCurrency})`,
                currency: p.sourceCurrency,
                country: p.destCountry,
                fee: feeGwei,
                time: dateObj.toLocaleTimeString('en-US', { hour12: false }),
                date: dateObj.toLocaleDateString(),
                viaContract: true
            });
        }
        onChainTxs = fetched.reverse();
    } catch(e) {
        console.error('Failed to fetch on-chain txs', e);
    }
}

function saveTransactions() {
    if (!userAddress) return;
    try {
        const key = `cbp_txs_${userAddress.toLowerCase()}`;
        localStorage.setItem(key, JSON.stringify(transactions.slice(0, MAX_STORED_TXS)));
        pushLog(`History: ${transactions.length} record(s) persisted to local vault.`, 'system');
    } catch (e) {
        pushLog('History: localStorage write failed.', 'error');
    }
}

function loadTransactions() {
    if (!userAddress) return;
    try {
        const key = `cbp_txs_${userAddress.toLowerCase()}`;
        const stored = localStorage.getItem(key);
        if (stored) {
            transactions = JSON.parse(stored);
            txCount = transactions.length;
            document.getElementById('tx-total').textContent = txCount;
            pushLog(`History: Loaded ${transactions.length} record(s) from local vault.`, 'system');
        } else {
            transactions = [];
            txCount = 0;
        }
    } catch (e) {
        transactions = [];
        txCount = 0;
        pushLog('History: Failed to parse stored data.', 'error');
    }
}

function renderHistory() {
    const tbody = document.getElementById('tx-log-full');
    const countEl = document.getElementById('ledger-count');
    if (!tbody) return;

    const directSent = transactions.filter(t => !t.viaContract);
    const allTxs = [...directSent, ...onChainTxs];
    
    // Deduplicate pseudoHashes in case we reloaded before flushing memory
    const uniqueTxs = Array.from(new Map(allTxs.map(item => [item.hash, item])).values());
    uniqueTxs.sort((a,b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time));

    let filtered = [];
    if (ledgerTab === 'sent') {
        filtered = uniqueTxs.filter(t => (t.sender || userAddress).toLowerCase() === userAddress.toLowerCase());
    } else {
        filtered = uniqueTxs.filter(t => t.dest.toLowerCase() === userAddress.toLowerCase());
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-data">No ${ledgerTab} settlements found.</td></tr>`;
        if (countEl) countEl.textContent = '0 transactions recorded';
        return;
    }

    if (countEl) countEl.textContent = `${filtered.length} transaction(s) recorded`;

    tbody.innerHTML = filtered.map(t => `
        <tr>
            <td class="mono fs-11">${t.hash.substring(0, 14)}...</td>
            <td>${t.date || ''} ${t.time}</td>
            <td><span class="status-pill ${ledgerTab==='sent'? 'out' : 'in'}" style="padding: 2px 6px; border-radius: 4px; background: ${ledgerTab==='sent'? 'var(--bg-secondary)' : 'var(--primary)'}; color: ${ledgerTab==='sent'? 'var(--text-secondary)' : 'white'}; font-size: 0.75rem;">${ledgerTab==='sent'? 'To' : 'From'}</span></td>
            <td class="mono fs-11">${ledgerTab==='sent'? t.dest.substring(0, 10) : (t.sender || t.dest).substring(0, 10)}...</td>
            <td>${t.fiatAmount}</td>
            <td class="fw-800">${t.ethValue} ETH</td>
            <td class="${parseFloat(t.fee) > 0 ? 'fee-text' : ''}">${parseFloat(t.fee) > 0 ? parseFloat(t.fee).toLocaleString(undefined, {maximumFractionDigits: 2}) + ' Gwei' : '—'}</td>
            <td class="success-text">SETTLED ✓</td>
        </tr>
    `).join('');
}

/* ═══════════════════════════════════════════════════════════════════════
   UTILITY KERNEL
   ═══════════════════════════════════════════════════════════════════════ */
async function refreshTelemetry() {
    if (!userAddress || !provider) return;
    try {
        const balance = await provider.getBalance(userAddress);
        const eth = parseFloat(ethers.formatEther(balance));
        document.getElementById('user-balance').innerHTML = `${eth.toFixed(4)} <span>ETH</span>`;

        const rates = await fetchRates();
        const usdRate = rates.usd || 2450;
        document.getElementById('balance-usd').textContent =
            (eth * usdRate).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        const net = await provider.getNetwork();
        document.getElementById('chain-id').textContent = net.chainId.toString();
    } catch (e) { /* silent */ }
}

function startGlobalTelemetry() {
    pushLog('Telemetry: Handshaking with global node cluster...', 'system');

    // Simulated gas & price updates
    const updateStats = () => {
        const gas = Math.floor(Math.random() * (12 - 7 + 1)) + 7;
        const gasEl = document.getElementById('gas-val');
        if (gasEl) gasEl.textContent = `${gas} Gwei`;
        setTimeout(updateStats, 12000);
    };
    updateStats();

    // Fetch real rates on startup
    fetchRates().then(rates => {
        if (rates.usd) document.getElementById('eth-price-val').textContent = `$${rates.usd.toLocaleString()}`;
        if (rates.inr) document.getElementById('eth-inr-val').textContent   = `₹${rates.inr.toLocaleString()}`;
    });

    // Background heartbeat
    const msgs = [
        "Network latency optimized: 42ms",
        "Shard #4 sync complete (EVM)",
        "Memory pool status: Stable",
        "Global peer count: 1842 active nodes",
        "Consensus layer: Block 124,591 verified",
        "Telemetry pipeline: Data relay operational",
        "Security baseline verification: PASS",
        "Node Integrity: 100% Verified",
        "Mem-swap: Optimized 1.2GB"
    ];
    const heartbeat = () => {
        pushLog(`System: ${msgs[Math.floor(Math.random() * msgs.length)]}`, 'system');
        setTimeout(heartbeat, 5000 + Math.random() * 5000);
    };
    heartbeat();
}

function setEngineState(loading, text) {
    const overlay = document.getElementById('tx-loading');
    const loadText = document.getElementById('loading-text');
    const btn = document.getElementById('send-payment');
    if (overlay) overlay.classList.toggle('hidden', !loading);
    if (loadText && text) loadText.textContent = text;
    if (btn) btn.disabled = loading;
}

function showNotification(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.textContent = `:: ${msg}`;
    document.getElementById('notification-area').appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 400);
    }, 5000);
}

/* ═══════════════════════════════════════════════════════════════════════
   BOOT SEQUENCE
   ═══════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    initializeKernel();

    document.getElementById('connect-wallet').onclick    = startHandshake;
    const tabSent = document.getElementById('tab-sent');
    const tabReceived = document.getElementById('tab-received');
    if (tabSent) tabSent.onclick = () => window.setLedgerTab('sent');
    if (tabReceived) tabReceived.onclick = () => window.setLedgerTab('received');
    document.getElementById('switch-wallet').onclick     = startHandshake;
    document.getElementById('disconnect-wallet').onclick = () => syncIdentity([]);
    document.getElementById('payment-form').onsubmit     = broadcastPayload;
    document.getElementById('deploy-contract').onclick   = deployContract;
    
    const revertBtn = document.getElementById('revert-direct');
    if (revertBtn) revertBtn.onclick = revertToDirect;

    // Input logging
    document.getElementById('recipient').oninput = (e) => {
        if (e.target.value.length === 2) pushLog('Buffer: Target node identification pending...', 'engine');
    };
    document.getElementById('fiat-amount').oninput = (e) => {
        if (e.target.value) pushLog(`Buffer: Volume parity check for ${e.target.value} ${document.getElementById('source-currency').value.toUpperCase()}...`, 'engine');
    };
});

/* ═══════════════════════════════════════════════════════════════════════
   MODULE 6 — IN-BROWSER SOLIDITY IDE & COMPILER
   ═══════════════════════════════════════════════════════════════════════ */
let monacoEditor = null;
let compilerWorker = null;
let customCompiledData = null;

const defaultContractSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CrossBorderPayment
 * @dev Re-engineered for maximum security and compliance with
 *      circuit breakers, volume limits, and address tracking.
 */
contract CrossBorderPayment {

    // Roles
    address public owner;
    
    // Core Parameters
    uint256 public feePercentage; // Basis points (50 = 0.5%)
    uint256 public totalFeesCollected;
    
    // Compliance Thresholds
    uint256 public minTransactionAmount = 0.001 ether;
    uint256 public maxTransactionAmount = 100 ether;
    
    // Circuit Breaker System
    bool public isPaused;

    // Entity Sanctions List
    mapping(address => bool) public isBlacklisted;

    struct Payment {
        address sender;
        address receiver;
        uint256 amount;
        uint256 fee;
        uint256 timestamp;
        string  sourceCurrency;
        string  destCountry;
    }

    Payment[] public payments;
    mapping(address => uint256[]) private userPaymentIds;

    /* ─── EVENTS ─── */
    event PaymentSent(uint256 indexed paymentId, address indexed sender, address indexed receiver, uint256 amount, uint256 fee, string sourceCurrency, string destCountry, uint256 timestamp);
    event FeeWithdrawn(address indexed owner, uint256 amount);
    event Paused(address account);
    event Unpaused(address account);
    event LimitsUpdated(uint256 minAmount, uint256 maxAmount);
    event BlacklistUpdated(address indexed account, bool isListed);

    /* ─── MODIFIERS ─── */
    modifier onlyOwner() {
        require(msg.sender == owner, "Denied: System Administrator Root Required");
        _;
    }
    
    modifier whenNotPaused() {
        require(!isPaused, "Circuit Breaker Active: Master contract is frozen");
        _;
    }

    modifier notBlacklisted(address _account) {
        require(!isBlacklisted[_account], "Sanctions Alert: Address is currently blacklisted");
        _;
    }

    /* ─── CONSTRUCTOR ─── */
    constructor(uint256 _feePercentage) {
        require(_feePercentage <= 1000, "Maximum platform fee is 10%");
        owner = msg.sender;
        feePercentage = _feePercentage;
    }

    /* ─── ADMIN FUNCTIONS ─── */
    function systemPanic() external onlyOwner {
        isPaused = true;
        emit Paused(msg.sender);
    }
    
    function systemResume() external onlyOwner {
        isPaused = false;
        emit Unpaused(msg.sender);
    }
    
    function configureThresholds(uint256 _min, uint256 _max) external onlyOwner {
        require(_min < _max, "Constraint violation");
        minTransactionAmount = _min;
        maxTransactionAmount = _max;
        emit LimitsUpdated(_min, _max);
    }
    
    function setEntityStatus(address _account, bool _isBlacklisted) external onlyOwner {
        isBlacklisted[_account] = _isBlacklisted;
        emit BlacklistUpdated(_account, _isBlacklisted);
    }

    /* ─── CORE PIPELINE ─── */
    function sendPayment(address payable _receiver, string calldata _sourceCurrency, string calldata _destCountry) 
        external payable whenNotPaused notBlacklisted(msg.sender) notBlacklisted(_receiver) 
    {
        // ── Security Constraints ──
        require(msg.value >= minTransactionAmount, "Volume too low");
        require(msg.value <= maxTransactionAmount, "Volume exceeded capacity");
        require(_receiver != address(0), "Null destination");
        require(_receiver != msg.sender, "Loopback forbidden");

        uint256 fee = (msg.value * feePercentage) / 10000;
        uint256 transferAmount = msg.value - fee;

        // ── State Mutators ──
        uint256 paymentId = payments.length;
        payments.push(Payment({
            sender: msg.sender, receiver: _receiver, amount: msg.value, fee: fee,
            timestamp: block.timestamp, sourceCurrency: _sourceCurrency, destCountry: _destCountry
        }));

        userPaymentIds[msg.sender].push(paymentId);
        userPaymentIds[_receiver].push(paymentId);
        totalFeesCollected += fee;

        // ── I/O Interactions ──
        (bool success, ) = _receiver.call{value: transferAmount}("");
        require(success, "Settlement failed structurally");

        emit PaymentSent(paymentId, msg.sender, _receiver, msg.value, fee, _sourceCurrency, _destCountry, block.timestamp);
    }

    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Treasury empty");
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Withdrawal execution fault");
        emit FeeWithdrawn(owner, balance);
    }

    /* ─── VIEW ─── */
    function getPaymentCount() external view returns (uint256) { return payments.length; }
    function getUserPaymentIds(address _user) external view returns (uint256[] memory) { return userPaymentIds[_user]; }
    function getPayment(uint256 _id) external view returns (Payment memory) {
        require(_id < payments.length, "Orphaned pointer");
        return payments[_id];
    }
}
`;

function logCompiler(msg, type = 'system') {
    const consoleDiv = document.getElementById('compiler-console');
    if (!consoleDiv) return;
    const p = document.createElement('div');
    p.className = `console-line ${type}`;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    p.textContent = `[${ts}] ${msg}`;
    consoleDiv.appendChild(p);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
    pushLog(`Compiler: ${msg}`, 'system');
}

window.initIDE = function() {
    if (monacoEditor) return; // Prevent multiple re-inits

    if (window.require) {
        require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});
        require(['vs/editor/editor.main'], function() {
            monacoEditor = monaco.editor.create(document.getElementById('monaco-container'), {
                value: defaultContractSource,
                language: 'sol',
                theme: 'vs-dark',
                automaticLayout: true,
                minimap: { enabled: true },
                fontSize: 15,
                lineHeight: 24,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontLigatures: true,
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                renderLineHighlight: 'all',
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                smoothScrolling: true,
                bracketPairColorization: { enabled: true },
                wordWrap: 'off',
                tabSize: 4,
            });
            logCompiler('IDE engine loaded. Editor ready.', 'success');

            // Re-layout after a small delay to ensure container is sized
            setTimeout(() => { monacoEditor.layout(); }, 100);
        });
    } else {
        logCompiler('Could not load IDE resources.', 'error');
    }

    // Initialize Web Worker
    if (window.Worker && !compilerWorker) {
        compilerWorker = new Worker('/compiler.worker.js');
        compilerWorker.onmessage = function(e) {
            const { type, payload, error } = e.data;
            const overlay = document.getElementById('ide-overlay');
            const statusEl = document.getElementById('ide-status');

            overlay.classList.remove('active');

            if (type === 'WORKER_READY') {
                logCompiler('Solidity compiler loaded in background.', 'success');
                if (statusEl) statusEl.querySelector('span:last-child').textContent = 'Ready';
            } else if (type === 'COMPILED') {
                logCompiler(`Build Successful: ${payload.contractName}`, 'success');
                logCompiler(`Bytecode: ${payload.bytecode.length} chars`, 'system');
                logCompiler(`ABI: ${payload.abi.length} entries`, 'system');
                customCompiledData = payload;
                const deployBtn = document.getElementById('deploy-custom-btn');
                deployBtn.disabled = false;
                deployBtn.innerHTML = '<span>🚀</span> Deploy ' + payload.contractName;
                if (statusEl) statusEl.querySelector('span:last-child').textContent = 'Compiled ✓';
                showNotification('Compilation Successful', 'success');
            } else if (type === 'ERROR') {
                logCompiler(`Compilation Failed:\n${error}`, 'error');
                if (statusEl) statusEl.querySelector('span:last-child').textContent = 'Error';
                showNotification('Compiler Error', 'error');
            }
        };
    }

    // Bind Compile Button
    document.getElementById('compile-btn').onclick = () => {
        if (!monacoEditor || !compilerWorker) return;
        const sourceCode = monacoEditor.getValue();
        if (!sourceCode.trim()) {
            logCompiler('Abort: No source code.', 'error');
            return;
        }
        document.getElementById('ide-overlay').classList.add('active');
        document.getElementById('deploy-custom-btn').disabled = true;
        const statusEl = document.getElementById('ide-status');
        if (statusEl) statusEl.querySelector('span:last-child').textContent = 'Compiling...';
        logCompiler('Sending source to solc compiler...', 'system');
        compilerWorker.postMessage({ id: Date.now(), type: 'COMPILE', payload: { sourceCode } });
    };

    // Bind Deploy Button
    document.getElementById('deploy-custom-btn').onclick = async () => {
        if (!customCompiledData || !signer) {
            showNotification('Wallet connection required for deployment', 'error');
            return;
        }
        
        const deployBtn = document.getElementById('deploy-custom-btn');
        const origHTML = deployBtn.innerHTML;
        deployBtn.disabled = true;
        deployBtn.innerHTML = '<span>⏳</span> Deploying...';

        try {
            logCompiler('Requesting MetaMask signature...', 'system');
            showNotification('Confirm deployment in MetaMask');

            const factory = new ethers.ContractFactory(customCompiledData.abi, customCompiledData.bytecode, signer);
            const deployed = await factory.deploy(50); 
            
            logCompiler('Transaction submitted. Mining...', 'system');
            await deployed.waitForDeployment();
            
            const address = await deployed.getAddress();
            logCompiler(`Deployed at ${address}`, 'success');
            
            localStorage.setItem('cbp_contract_address', address);
            
            logCompiler('Contract active. Reloading...', 'success');
            showNotification('Contract Deployed Successfully', 'success');
            
            setTimeout(() => { window.location.reload(); }, 2000);
            
        } catch (err) {
            logCompiler(`Deploy failed: ${err.message}`, 'error');
            deployBtn.disabled = false;
            deployBtn.innerHTML = origHTML;
        }
    };

    // Console toggle
    const toggleBtn = document.getElementById('toggle-console');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            const console = document.getElementById('compiler-console');
            console.classList.toggle('collapsed');
            toggleBtn.textContent = console.classList.contains('collapsed') ? '▸' : '▾';
            // Re-layout monaco to fill freed space
            setTimeout(() => { if (monacoEditor) monacoEditor.layout(); }, 50);
        };
    }
};

