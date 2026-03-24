console.log('ANTIGRAVITY: KERNEL v3.0 LOADED');
import { ethers } from 'ethers';
import { CONTRACT_ABI, CONTRACT_ADDRESS, CONTRACT_BYTECODE, SUPPORTED_TOKENS, ERC20_ABI } from './config.js';

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
    detectAndSetCountry(); // Auto-detect sender's country on boot

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

            // Click-to-copy wallet address
            const fullAddrEl = document.getElementById('full-address');
            const copyHint   = document.getElementById('copy-hint');
            if (fullAddrEl) {
                fullAddrEl.onclick = () => {
                    navigator.clipboard.writeText(userAddress).then(() => {
                        if (copyHint) { copyHint.style.display = 'inline'; setTimeout(() => { copyHint.style.display = 'none'; }, 2000); }
                        pushLog('Auth: Wallet address copied to clipboard.', 'system');
                    });
                };
            }

            loadTransactions();
            await loadOnChainTransactions();
            renderHistory();
            refreshTelemetry();
            detectAndSetCountry();      // Re-run to tie country to wallet address in localStorage
            checkNewReceivedPayments(); // Show banner if new payments arrived
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
    const assetSelect    = document.getElementById('transfer-asset');
    const approveBtn     = document.getElementById('approve-token');

    let debounceTimer;
    const trigger = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(updateConversion, 300);
    };

    if (fiatInput) fiatInput.addEventListener('input', trigger);
    currencySelect.addEventListener('change', () => {
        document.getElementById('currency-unit').textContent = currencySelect.value.toUpperCase();
        trigger();
    });
    assetSelect.addEventListener('change', () => {
        if (assetSelect.value === 'ETH' || !contract) {
            approveBtn.classList.add('hidden');
            document.getElementById('send-payment').disabled = !signer;
        } else {
            approveBtn.classList.remove('hidden');
            approveBtn.disabled = false;
            approveBtn.textContent = 'Approve Asset';
            document.getElementById('send-payment').disabled = true;
        }
        trigger();
    });
}

async function updateConversion() {
    const fiatAmount = parseFloat(document.getElementById('fiat-amount').value);
    const currency   = document.getElementById('source-currency').value;
    const asset      = document.getElementById('transfer-asset').value;
    const display    = document.getElementById('conversion-display');

    const rates = await fetchRates();
    const rate  = rates[currency]; // FIAT to ETH rate
    if (!rate) { display.classList.add('hidden'); return; }

    const sym = CURRENCY_SYMBOLS[currency] || '';

    // Update sidebar market rates dynamically based on selected fiat peg & execution asset
    const primaryLabel = document.getElementById('market-primary-label');
    const primaryVal = document.getElementById('market-primary-val');
    const secLabel = document.getElementById('market-secondary-label');
    const secVal = document.getElementById('market-secondary-val');

    if (asset === 'ETH') {
        if (primaryLabel) primaryLabel.textContent = `ETH / ${currency.toUpperCase()}`;
        if (primaryVal) primaryVal.textContent = `${sym}${rates[currency].toLocaleString(undefined, {maximumFractionDigits: 2})}`;
        
        const otherCurrency = currency === 'usd' ? 'inr' : 'usd';
        const otherSym = CURRENCY_SYMBOLS[otherCurrency];
        if (secLabel) secLabel.textContent = `ETH / ${otherCurrency.toUpperCase()}`;
        if (secVal) secVal.textContent = `${otherSym}${rates[otherCurrency].toLocaleString(undefined, {maximumFractionDigits: 2})}`;
    } else {
        // For Stablecoins pegged to USD
        const fiatRate = rates[currency] / rates.usd; // fiat equivalent of 1 USD
        if (primaryLabel) primaryLabel.textContent = `${asset} / USD`;
        if (primaryVal) primaryVal.textContent = `$1.00`;
        
        if (secLabel) secLabel.textContent = `${asset} / ${currency.toUpperCase()}`;
        if (secVal) secVal.textContent = `${sym}${fiatRate.toFixed(2)}`;
    }

    if (!fiatAmount || fiatAmount <= 0) { display.classList.add('hidden'); return; }

    let cryptoAmount = 0;

    // Stablecoin conversion (pegged to USD)
    if (asset !== 'ETH') {
        const usdRate = rates.usd;
        const fiatPerUsd = rate / usdRate;
        cryptoAmount = fiatAmount / fiatPerUsd;
    } else {
        cryptoAmount = fiatAmount / rate;
    }

    const useContract = !!contract;
    const fee         = useContract ? (cryptoAmount * FEE_BPS) / 10000 : 0;
    const receives    = cryptoAmount - fee;

    document.getElementById('conv-rate').textContent     = asset === 'ETH' ? `1 ETH = ${sym}${rate.toLocaleString()}` : `1 ${asset} = ${sym}${(rate/rates.usd).toFixed(2)}`;
    document.getElementById('conv-eth').textContent      = `${cryptoAmount.toFixed(6)} ${asset}`;
    document.getElementById('conv-fee').textContent      = fee > 0 ? `${fee.toFixed(6)} ${asset}` : 'No fee (Direct)';
    document.getElementById('conv-receives').textContent = `${receives.toFixed(6)} ${asset}`;

    display.classList.remove('hidden');
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
    const approveBtn = document.getElementById('approve-token');
    const assetSelect = document.getElementById('transfer-asset');

    if (contract) {
        badge.classList.add('active');
        text.textContent = 'Smart Contract';
        mode.textContent = 'Contract Routed';
        fee.textContent  = '0.5%';
        if (assetSelect && assetSelect.value !== 'ETH') {
            if (approveBtn) approveBtn.classList.remove('hidden');
        }
    } else {
        badge.classList.remove('active');
        text.textContent = 'Direct Mode';
        mode.textContent = 'Direct Transfer';
        fee.textContent  = '0% (Direct)';
        if (approveBtn) approveBtn.classList.add('hidden');
    }

    // Show deploy when wallet connected + no contract; show revert when contract is active
    const deployBtn = document.getElementById('deploy-contract');
    const revertBtn = document.getElementById('revert-direct');
    if (deployBtn) deployBtn.classList.toggle('hidden', !!contract || !signer);
    if (revertBtn) revertBtn.classList.toggle('hidden', !contract || !signer);

    // Allow sending payments even in direct mode
    const sendBtn = document.getElementById('send-payment');
    if (contract && assetSelect && assetSelect.value !== 'ETH') {
        if (sendBtn) sendBtn.disabled = true;
    } else {
        if (sendBtn && signer) sendBtn.disabled = false;
    }
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
async function approveToken() {
    if (!signer || !contract) {
        showNotification('Connect wallet and deploy contract first', 'error');
        return;
    }
    
    const asset = document.getElementById('transfer-asset').value;
    if (asset === 'ETH') return;

    const tokenAddress = SUPPORTED_TOKENS[asset];
    if (!tokenAddress) {
        showNotification('Token not configured for this network', 'error');
        return;
    }

    const fiatAmount = parseFloat(document.getElementById('fiat-amount').value);
    const currency   = document.getElementById('source-currency').value;
    if (!fiatAmount || fiatAmount <= 0) return;

    const rates = await fetchRates();
    const rate = rates[currency];
    if (!rate) return;
    
    const usdRate = rates.usd;
    const fiatPerUsd = rate / usdRate;
    const cryptoAmount = fiatAmount / fiatPerUsd;

    const btn = document.getElementById('approve-token');
    btn.disabled = true;
    btn.textContent = '⏳ Approving...';

    try {
        setEngineState(true, `Requesting allowance for ${asset}...`);
        pushLog(`Token: Requesting approval from user...`, 'engine');
        
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
        let decimals = 18;
        try { decimals = Number(await tokenContract.decimals()); } catch(e) {}
        
        const amountWei = ethers.parseUnits(cryptoAmount.toFixed(Math.min(decimals, 6)), decimals);

        const tx = await tokenContract.approve(await contract.getAddress(), amountWei);
        pushLog(`Token: Approval TX sent. Hash: ${tx.hash.substring(0, 15)}...`, 'engine');
        
        await tx.wait();
        
        pushLog(`Token: Approval confirmed. ✓`, 'engine');
        showNotification(`${asset} Approved! You can now send.`, 'success');
        
        document.getElementById('send-payment').disabled = false;
        btn.textContent = '✓ Approved';
    } catch (err) {
        pushLog(`Token Error: ${err.message}`, 'error');
        showNotification('Approval failed', 'error');
        btn.disabled = false;
        btn.textContent = 'Approve Asset';
    } finally {
        setEngineState(false);
    }
}

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
    const destCountry = document.getElementById('dest-country')?.value || 'Global';
    const asset       = document.getElementById('transfer-asset').value;

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

    const sym       = CURRENCY_SYMBOLS[currency] || '';
    let strAmount   = '';
    let isERC20     = asset !== 'ETH';
    let decimals    = 18;

    if (isERC20) {
        const usdRate = rates.usd;
        const fiatPerUsd = rate / usdRate;
        const cryptoAmount = fiatAmount / fiatPerUsd;
        
        try {
            const tokenContract = new ethers.Contract(SUPPORTED_TOKENS[asset], ERC20_ABI, signer);
            decimals = Number(await tokenContract.decimals());
        } catch(e) { decimals = 18; }
        
        strAmount = cryptoAmount.toFixed(Math.min(decimals, 6)); // ensure safe precision
    } else {
        const ethAmount = fiatAmount / rate;
        strAmount = ethAmount.toFixed(8);
    }

    try {
        setEngineState(true, 'Injecting payload into decentralized mempool...');
        pushLog(`Engine: Converting ${sym}${fiatAmount} → ${strAmount} ${asset}`, 'engine');

        let tx;
        if (!contract) {
            pushLog(`Engine: Smart Contract missing. Initiating DIRECT P2P Transfer...`, 'engine');
            if (isERC20) {
                const amountWei = ethers.parseUnits(strAmount, decimals);
                const tokenContract = new ethers.Contract(SUPPORTED_TOKENS[asset], ERC20_ABI, signer);
                tx = await tokenContract.transfer(target, amountWei);
            } else {
                tx = await signer.sendTransaction({
                    to: target,
                    value: ethers.parseEther(strAmount)
                });
            }
        } else {
            const sourceCountry = document.getElementById('source-country').value;
            pushLog(`Engine: Routing ${asset} via smart contract...`, 'engine');

            if (isERC20) {
                const amountWei = ethers.parseUnits(strAmount, decimals);
                tx = await contract.sendTokenPayment(
                    SUPPORTED_TOKENS[asset],
                    target,
                    amountWei,
                    currency.toUpperCase(),
                    sourceCountry,
                    destCountry
                );
            } else {
                tx = await contract.sendPayment(target, currency.toUpperCase(), sourceCountry, destCountry, {
                    value: ethers.parseEther(strAmount)
                });
            }
        }

        setEngineState(true, 'Awaiting settlement verification (Mining)...');
        pushLog(`Engine: Hash: ${tx.hash.substring(0, 18)}...`, 'engine');
        showNotification('Payload Broadcasted');

        const receipt = await tx.wait();

        if (receipt.status === 1) {
            pushLog('Engine: Settlement finalized. ✓', 'engine');
            showNotification('Settlement Verified', 'success');

            const feeCrypto = contract ? (parseFloat(strAmount) * FEE_BPS / 10000) : 0;
            const feeFormatted = isERC20 ? feeCrypto.toFixed(6) : (feeCrypto * 1e9).toFixed(2); // Gwei for ETH, tokens for ERC20

            transactions.unshift({
                hash:         tx.hash,
                dest:         target,
                sender:       userAddress,
                ethValue:     strAmount,
                assetName:    asset,
                fiatAmount:   `${sym}${fiatAmount.toLocaleString()}`,
                currency:     currency.toUpperCase(),
                sourceCountry: document.getElementById('source-country').value,
                country:      destCountry,
                fee:          feeFormatted,
                time:         new Date().toLocaleTimeString('en-US', { hour12: false }),
                date:         new Date().toLocaleDateString(),
                viaContract:  !!contract
            });

            renderHistory();
            saveTransactions();
            txCount++;
            const txTotalEl = document.getElementById('tx-total');
            if (txTotalEl) txTotalEl.textContent = txCount;
            document.getElementById('payment-form').reset();
            document.getElementById('conversion-display').classList.add('hidden');
            document.getElementById('currency-unit').textContent = 'INR';
            
            // Reset approve states
            const approveBtn = document.getElementById('approve-token');
            if (approveBtn) {
                approveBtn.disabled = false;
                approveBtn.textContent = 'Approve Asset';
            }
            if (isERC20) document.getElementById('send-payment').disabled = true;

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
    document.getElementById('tab-sent').style.background = tab === 'sent' ? 'var(--card-bg)' : 'transparent';
    document.getElementById('tab-received').style.background = tab === 'received' ? 'var(--card-bg)' : 'transparent';
    if (tab === 'received') window.dismissReceivedBanner(); // Mark as seen when user opens received tab
    renderHistory();
};

async function loadOnChainTransactions() {
    if (!provider || !userAddress) {
        onChainTxs = [];
        return;
    }
    try {
        pushLog('Chain: Querying on-chain events via global index logs...', 'engine');
        const iface = new ethers.Interface(CONTRACT_ABI);
        const paymentSentTopic = iface.getEvent("PaymentSent").topicHash;
        const paddedAddress = ethers.zeroPadValue(userAddress, 32);

        // 1. If a local contract is deployed/saved, query it safely from block 0
        const queryPromises = [];
        if (typeof contract !== 'undefined' && contract && contract.target) {
            queryPromises.push(provider.getLogs({
                address: contract.target,
                fromBlock: 0,
                toBlock: 'latest',
                topics: [paymentSentTopic, null, paddedAddress, null] // Topic 1=token, 2=sender
            }).catch(() => []));
            queryPromises.push(provider.getLogs({
                address: contract.target,
                fromBlock: 0,
                toBlock: 'latest',
                topics: [paymentSentTopic, null, null, paddedAddress] // Topic 1=token, 2=sender, 3=receiver
            }).catch(() => []));
        }

        // 2. Query ANY contract from the last ~9000 blocks, but split into safe RPC chunks of 1500
        const currentBlock = await provider.getBlockNumber().catch(() => 0);
        const CHUNK_SIZE = 1500;
        const TARGET_BLOCKS = 9000;
        const startBlock = Math.max(0, currentBlock - TARGET_BLOCKS);

        for (let b = startBlock; b <= currentBlock; b += CHUNK_SIZE + 1) {
            let endB = Math.min(b + CHUNK_SIZE, currentBlock);
            if (b > endB) break;
            
            queryPromises.push(provider.getLogs({
                fromBlock: b,
                toBlock: endB,
                topics: [paymentSentTopic, null, paddedAddress, null] // Topic 2 is sender
            }).catch(() => []));
            queryPromises.push(provider.getLogs({
                fromBlock: b,
                toBlock: endB,
                topics: [paymentSentTopic, null, null, paddedAddress] // Topic 3 is receiver
            }).catch(() => []));
        }

        const logResults = await Promise.all(queryPromises);
        let allLogs = [];
        logResults.forEach(arr => { allLogs = allLogs.concat(arr); });
        
        // Deduplicate by real tx hash + paymentId (extracted from logs to be safe)
        const uniqueLogs = Array.from(
            new Map(allLogs.map(log => [log.transactionHash + log.topics[1], log])).values()
        );

        const fetched = uniqueLogs.map(log => {
            const parsed = iface.parseLog(log);
            const args = parsed.args;
            const ethAmount = ethers.formatEther(args.amount);
            const feeGwei   = Number(ethers.formatUnits(args.fee, 'gwei'));
            const dateObj   = new Date(Number(args.timestamp) * 1000);
            const tokenAddr = args.token.toLowerCase();
            let assetName = 'ETH';
            for (const [name, addr] of Object.entries(SUPPORTED_TOKENS)) {
                if (addr.toLowerCase() === tokenAddr) {
                    assetName = name;
                    break;
                }
            }

            return {
                hash:          log.transactionHash,
                paymentId:     args.paymentId.toString(),
                token:         args.token,
                assetName:     assetName,
                sender:        args.sender,
                dest:          args.receiver,
                ethValue:      assetName === 'ETH' ? parseFloat(ethAmount).toFixed(6) : ethAmount, // Raw units for tokens if decimals unknown
                fiatAmount:    `\u2014 (${args.sourceCurrency})`,
                currency:      args.sourceCurrency,
                sourceCountry: args.sourceCountry || '\u2014',
                country:       args.destCountry,
                fee:           feeGwei,
                time:          dateObj.toLocaleTimeString('en-US', { hour12: false }),
                date:          dateObj.toLocaleDateString(),
                viaContract:   true
            };
        });

        onChainTxs = fetched.sort((a, b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time));
        pushLog(`Chain: Loaded ${onChainTxs.length} on-chain transaction(s) from global index.`, 'engine');
    } catch(e) {
        console.error('Failed to fetch on-chain txs', e);
        pushLog('Chain: Failed to query global on-chain events.', 'error');
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
    const tbody   = document.getElementById('tx-log-full');
    const countEl = document.getElementById('ledger-count');
    if (!tbody) return;

    const directSent = transactions.filter(t => !t.viaContract);
    const allTxs     = [...directSent, ...onChainTxs];

    // Deduplicate by real hash
    const uniqueTxs = Array.from(new Map(allTxs.map(item => [item.hash, item])).values());
    uniqueTxs.sort((a, b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time));

    let filtered = [];
    if (ledgerTab === 'sent') {
        filtered = uniqueTxs.filter(t => (t.sender || userAddress).toLowerCase() === userAddress.toLowerCase());
    } else {
        filtered = uniqueTxs.filter(t => t.dest.toLowerCase() === userAddress.toLowerCase());
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-data">No ${ledgerTab} settlements found.</td></tr>`;
        if (countEl) countEl.textContent = '0 transactions recorded';
        return;
    }

    if (countEl) countEl.textContent = `${filtered.length} transaction(s) recorded`;

    const EXPLORER = 'https://sepolia.etherscan.io/tx/';
    const shortAddr = (a) => a ? `${a.substring(0, 8)}...${a.slice(-4)}` : '—';
    const copyTx = (hash) => { navigator.clipboard.writeText(hash); showNotification('TX Hash copied!', 'info'); };

    tbody.innerHTML = filtered.map(t => {
        const senderDisplay   = (t.sender   || userAddress);
        const receiverDisplay = t.dest;
        const assetStr = t.assetName || 'ETH';
        const ethAmtDisplay = `${parseFloat(t.ethValue).toFixed(4)} ${assetStr}`;
        const feeDisplay = parseFloat(t.fee) > 0
            ? (assetStr === 'ETH' ? `${parseFloat(t.fee).toLocaleString(undefined, { maximumFractionDigits: 2 })} Gwei` : `${parseFloat(t.fee).toFixed(3)} ${assetStr}`)
            : '—';
        
        const toCountryDisplay = (ledgerTab === 'sent') ? 'Global' : (t.country || '—');
        const fromCountryDisplay = (ledgerTab === 'received') ? 'Global' : (t.sourceCountry || '—');

        return `
        <tr>
            <td class="mono fs-11">
                <a href="${EXPLORER}${t.hash}" target="_blank" rel="noopener" title="View on Sepolia Etherscan">${t.hash.substring(0, 12)}...</a>
                <span onclick="navigator.clipboard.writeText('${t.hash}')" title="Copy full hash" style="cursor:pointer; margin-left:4px; opacity:0.6;">⎘</span>
            </td>
            <td>${t.date || ''} ${t.time}</td>
            <td class="mono fs-11" title="${senderDisplay}">${shortAddr(senderDisplay)}</td>
            <td><span class="country-chip">${fromCountryDisplay}</span></td>
            <td class="mono fs-11" title="${receiverDisplay}">${shortAddr(receiverDisplay)}</td>
            <td><span class="country-chip">${toCountryDisplay}</span></td>
            <td>${t.fiatAmount}</td>
            <td class="fw-800">${ethAmtDisplay}</td>
            <td class="${parseFloat(t.fee) > 0 ? 'fee-text' : ''}">${feeDisplay}</td>
            <td class="success-text">SETTLED ✓</td>
        </tr>`;
    }).join('');
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
        const baseCurrencyToken = document.getElementById('source-currency')?.value || 'usd';
        const rate = rates[baseCurrencyToken] || rates.usd || 2450;
        
        let currencyFormat = baseCurrencyToken.toUpperCase();
        let locale = 'en-US';
        if (baseCurrencyToken === 'inr') locale = 'en-IN';
        if (baseCurrencyToken === 'eur') locale = 'de-DE';
        if (baseCurrencyToken === 'gbp') locale = 'en-GB';

        document.getElementById('balance-usd').textContent =
            (eth * rate).toLocaleString(locale, { style: 'currency', currency: currencyFormat });

        const net = await provider.getNetwork();
        const chainIdEl = document.getElementById('chain-id');
        if (chainIdEl) chainIdEl.textContent = net.chainId.toString();
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
   MODULE 6 — GEO-DETECTION & RECEIVED PAYMENT NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════════════ */

async function detectAndSetCountry() {
    try {
        let code = 'US';
        let name = 'United States';
        try {
            const res = await fetch('https://ipapi.co/json/');
            if (!res.ok) throw new Error('API limit');
            const data = await res.json();
            if (data.country_code) {
                code = data.country_code;
                name = data.country_name;
            }
        } catch (e1) {
            const fb = await fetch('https://get.geojs.io/v1/ip/geo.json');
            if (fb.ok) {
                const fData = await fb.json();
                if (fData.country_code) {
                    code = fData.country_code;
                    name = fData.country;
                }
            }
        }

        // Persist tied to wallet address so receiver's country is also stored
        if (userAddress) {
            localStorage.setItem(`cbp_country_${userAddress.toLowerCase()}`, JSON.stringify({ code, name }));
        }

        // Auto-set the source-country and currency
        const sel = document.getElementById('source-country');
        const disp = document.getElementById('source-country-display-text');
        if (sel && disp && code) {
            sel.value = code;
            disp.textContent = name;
            
            // Auto-set currency based on country
            const currencyMap = {
                'IN': { code: 'inr', symbol: 'INR (₹)' },
                'US': { code: 'usd', symbol: 'USD ($)' },
                'UK': { code: 'gbp', symbol: 'GBP (£)' },
                'GB': { code: 'gbp', symbol: 'GBP (£)' },
                'EU': { code: 'eur', symbol: 'EUR (€)' },
                'DE': { code: 'eur', symbol: 'EUR (€)' },
                'FR': { code: 'eur', symbol: 'EUR (€)' },
                'IT': { code: 'eur', symbol: 'EUR (€)' },
            };
            const curr = currencyMap[code] || { code: 'usd', symbol: 'USD ($)' }; // Default
            document.getElementById('source-currency').value = curr.code;
            const curDisp = document.getElementById('source-currency-display-text');
            if (curDisp) curDisp.textContent = curr.symbol;
            const curUnit = document.getElementById('currency-unit');
            if (curUnit) curUnit.textContent = curr.code.toUpperCase();
            if (typeof updateConversion === 'function') updateConversion();
            if (typeof refreshTelemetry === 'function') refreshTelemetry();
        }

        // Show detected country badge in the identity panel
        const badge = document.getElementById('user-country-display');
        if (badge && name) badge.textContent = `📍 ${name}`;

        pushLog(`Geo: Location resolved — ${name} (${code}).`, 'system');
    } catch (e) {
        pushLog('Geo: Country auto-detection unavailable or failed.', 'error');
    }
}

function checkNewReceivedPayments() {
    if (!userAddress) return;
    const key          = `cbp_last_seen_received_${userAddress.toLowerCase()}`;
    const lastSeenStr  = localStorage.getItem(key);
    const allTxs       = [...transactions, ...onChainTxs];
    const receivedTxs  = allTxs.filter(t => t.dest && t.dest.toLowerCase() === userAddress.toLowerCase());
    const currentCount = receivedTxs.length;

    if (lastSeenStr === null) {
        // First-ever login: set baseline silently, no banner shown
        localStorage.setItem(key, currentCount.toString());
        return;
    }

    const newCount = currentCount - parseInt(lastSeenStr, 10);
    if (newCount > 0) {
        showReceivedBanner(newCount, receivedTxs.slice(0, newCount));
    }
}

function showReceivedBanner(count, newTxs) {
    const banner = document.getElementById('received-banner');
    if (!banner) return;
    const latest   = newTxs[0];
    const ethAmt   = latest ? `${latest.ethValue} ETH` : '';
    const fromAddr = latest ? `${(latest.sender || latest.dest).substring(0, 10)}...` : '';
    const detail   = count === 1
        ? `${ethAmt} received from <span class="mono fs-11">${fromAddr}</span>`
        : `${count} new incoming transactions need your attention.`;

    banner.innerHTML = `
        <div class="received-banner-inner">
            <div class="banner-icon-wrap">💸</div>
            <div class="banner-text">
                <strong>You have ${count} new received payment${count > 1 ? 's' : ''}!</strong>
                <span>${detail}</span>
            </div>
            <button class="banner-action" onclick="window.goToReceived()">View in Ledger →</button>
            <button class="banner-dismiss" onclick="window.dismissReceivedBanner()">✕</button>
        </div>
    `;
    banner.style.opacity = '0';
    banner.style.transition = 'opacity 0.3s ease';
    banner.classList.remove('hidden');
    setTimeout(() => { banner.style.opacity = '1'; }, 50);
    pushLog(`Inbox: ${count} new received payment(s) detected.`, 'auth');
    showNotification(`💸 ${count} new payment${count > 1 ? 's' : ''} received!`, 'success');
}

window.goToReceived = function() {
    switchPage('ledger');
    window.setLedgerTab('received');
};

window.dismissReceivedBanner = function() {
    const banner = document.getElementById('received-banner');
    if (banner) {
        banner.style.opacity = '0';
        setTimeout(() => banner.classList.add('hidden'), 300);
    }
    if (!userAddress) return;
    const key           = `cbp_last_seen_received_${userAddress.toLowerCase()}`;
    const allTxs        = [...transactions, ...onChainTxs];
    const totalReceived = allTxs.filter(t => t.dest && t.dest.toLowerCase() === userAddress.toLowerCase()).length;
    localStorage.setItem(key, totalReceived.toString());
};

// ── Demo Mode: Manual country override for presentations ──────────────
window.overrideCountry = function(value) {
    if (!value) {
        // Reset to auto-detect
        detectAndSetCountry();
        return;
    }
    const [code, name] = value.split('|');

    // Update source-country and currency
    const sel = document.getElementById('source-country');
    const disp = document.getElementById('source-country-display-text');
    if (sel && disp && code) {
        sel.value = code;
        disp.textContent = name;
        
        // Auto-set currency based on country
        const currencyMap = {
            'IN': { code: 'inr', symbol: 'INR (₹)' },
            'US': { code: 'usd', symbol: 'USD ($)' },
            'UK': { code: 'gbp', symbol: 'GBP (£)' },
            'GB': { code: 'gbp', symbol: 'GBP (£)' },
            'EU': { code: 'eur', symbol: 'EUR (€)' },
        };
        const curr = currencyMap[code] || { code: 'usd', symbol: 'USD ($)' }; // Default
        document.getElementById('source-currency').value = curr.code;
        const curDisp = document.getElementById('source-currency-display-text');
        if (curDisp) curDisp.textContent = curr.symbol;
        const curUnit = document.getElementById('currency-unit');
        if (curUnit) curUnit.textContent = curr.code.toUpperCase();
        if (typeof updateConversion === 'function') updateConversion();
        if (typeof refreshTelemetry === 'function') refreshTelemetry();
    }

    // Update identity badge
    const badge = document.getElementById('user-country-display');
    if (badge) badge.textContent = `📍 ${name} (Demo)`;

    // Persist to localStorage
    if (userAddress) {
        localStorage.setItem(`cbp_country_${userAddress.toLowerCase()}`, JSON.stringify({ code, name }));
    }

    pushLog(`Demo: Country manually overridden to ${name} (${code}).`, 'auth');
    showNotification(`Country set to ${name} for demo`, 'info');
};


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
    const approveBtn = document.getElementById('approve-token');
    if (approveBtn) approveBtn.onclick = approveToken;
    
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

    // Auto-fetch market intelligence on boot
    updateConversion();
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
    function sendPayment(address payable _receiver, string calldata _sourceCurrency, string calldata _sourceCountry, string calldata _destCountry) 
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

        emit PaymentSent(paymentId, msg.sender, _receiver, msg.value, fee, _sourceCurrency, _sourceCountry, _destCountry, block.timestamp);
    }

    /**
     * @dev ERC20 token payment routing with platform fee.
     *      User must approve the contract as spender first.
     */
    function sendTokenPayment(address _token, address _receiver, uint256 _amount, string calldata _sourceCurrency, string calldata _sourceCountry, string calldata _destCountry) 
        external whenNotPaused notBlacklisted(msg.sender) notBlacklisted(_receiver)
    {
        require(_amount > 0, "Zero amount");
        require(_token != address(0), "Invalid token");

        uint256 fee = (_amount * feePercentage) / 10000;
        uint256 transferAmount = _amount - fee;

        // Record payment (using msg.value=0 as it's a token payment)
        uint256 paymentId = payments.length;
        payments.push(Payment({
            sender: msg.sender, receiver: _receiver, amount: _amount, fee: fee,
            timestamp: block.timestamp, sourceCurrency: _sourceCurrency, destCountry: _destCountry
        }));

        userPaymentIds[msg.sender].push(paymentId);
        userPaymentIds[_receiver].push(paymentId);
        totalFeesCollected += fee; // Note: In a real app, you'd track tokens separately

        // Pull tokens from sender
        bool pulled = IERC20(_token).transferFrom(msg.sender, address(this), _amount);
        require(pulled, "Token pull failed");

        // Send tokens to receiver
        bool sent = IERC20(_token).transfer(_receiver, transferAmount);
        require(sent, "Token send failed");

        emit PaymentSent(paymentId, msg.sender, _receiver, _amount, fee, _sourceCurrency, _sourceCountry, _destCountry, block.timestamp);
    }

    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Treasury empty");
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Withdrawal execution fault");
        emit FeeWithdrawn(owner, balance);
    }
    
    // Minimal IERC20 for internal use
    interface IERC20 {
        function transfer(address to, uint256 value) external returns (bool);
        function transferFrom(address from, address to, uint256 value) external returns (bool);
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

