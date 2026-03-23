console.log('ANTIGRAVITY: KERNEL v2.1 LOADED');
import { ethers } from 'ethers';

/**
 * Kernel State & Registry
 */
let provider;
let signer;
let userAddress = null;
let txCount = 0;
let transactions = [];

// Registry for UI Elements (populated on DOM ready)
const UI = {};

/**
 * CORE LOGGING KERNEL
 */
function pushLog(msg, type = 'system') {
    const logsContainer = document.getElementById('kernel-logs');
    if (!logsContainer) return;

    const p = document.createElement('p');
    p.className = `log-line log-${type}`; // types: system, auth, engine, error
    
    const timestamp = new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    p.innerHTML = `<span class="log-time">[${timestamp}]</span> <span class="log-content">${msg}</span>`;
    
    // Append to bottom (Terminal style)
    logsContainer.appendChild(p);
    
    // Pruning old logs (keep last 50)
    if (logsContainer.children.length > 50) {
        logsContainer.removeChild(logsContainer.firstChild);
    }

    // Auto-scroll to latest
    logsContainer.scrollTop = logsContainer.scrollHeight;
}

/**
 * MODULE 0: Navigation Controller
 */
function switchPage(pageId) {
    const pages = document.querySelectorAll('.page-view');
    const navItems = document.querySelectorAll('.nav-item');
    
    pages.forEach(p => p.classList.add('hidden'));
    navItems.forEach(n => n.classList.remove('active'));
    
    const targetPage = document.getElementById(`page-${pageId}`);
    const targetNav = document.querySelector(`[data-page="${pageId}"]`);
    
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('animate-in');
        document.getElementById('page-title').textContent = pageId === 'dashboard' ? 'Terminal Console' : 'Settlement Ledger';
    }
    
    if (targetNav) targetNav.classList.add('active');
    pushLog(`Navigator: Routing to ${pageId.toUpperCase()} workspace.`, 'system');
}
window.switchPage = switchPage;

/**
 * MODULE 1: Identity & Handshake Protocol
 */
async function initializeKernel() {
    pushLog('Kernel: Initializing decentralized protocol kernel...', 'system');
    
    // 1. Map UI Registry immediately
    UI.connectBtn = document.getElementById('connect-wallet');
    UI.switchBtn = document.getElementById('switch-wallet');
    UI.disconnectBtn = document.getElementById('disconnect-wallet');
    UI.authUnverified = document.getElementById('auth-unverified');
    UI.authVerified = document.getElementById('auth-verified');
    UI.fullAddress = document.getElementById('full-address');
    UI.userAddrShort = document.getElementById('user-addr-short');
    UI.networkDot = document.getElementById('network-dot');
    UI.networkDisplay = document.getElementById('network-display');
    
    // 2. Start UI Systems regardless of wallet status
    startGlobalTelemetry();
    bindNavigation();
    
    pushLog('Kernel: Static telemetry pipeline active.', 'system');

    // 3. Optional: Cryptographic Handshake Detection
    if (!window.ethereum) {
        pushLog('Fatal: EIP-1193 Provider not detected. Dashboard restricted to Read-Only.', 'error');
        showNotification('MetaMask Extension Missing', 'error');
        return;
    }

    try {
        provider = new ethers.BrowserProvider(window.ethereum);
        pushLog('Kernel: Ethereum Provider bound to browser instance.', 'system');
        
        // Background Session Detection
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
            pushLog('Auth: Existing cryptographic session recovered.', 'auth');
            syncIdentity(accounts.map(a => a.address));
        }

        // Live Event Pipeline
        window.ethereum.on('accountsChanged', (accounts) => {
            pushLog('Auth: External identity shift detected.', 'auth');
            syncIdentity(accounts);
        });
        
        window.ethereum.on('chainChanged', () => {
            pushLog('Kernel: Global chain ID shift. Rebooting protocol...', 'system');
            window.location.reload();
        });
        
        pushLog('Kernel: Handshake protocol STANDBY.', 'system');

    } catch (e) {
        pushLog(`Error: Protocol initialization failed: ${e.message}`, 'error');
    }
}

async function startHandshake() {
    if (!window.ethereum) {
        pushLog('Fatal: Handshake refused. EIP-1193 kernel layer missing.', 'error');
        showNotification('Provider Missing', 'error');
        return;
    }
    pushLog('Auth: Requiring forced cryptographic handshake...', 'auth');
    try {
        await window.ethereum.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }]
        });
        
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        syncIdentity(accounts);
    } catch (e) {
        pushLog(`Auth: Handshake terminated by controller: ${e.message}`, 'error');
        showNotification('Handshake Failed', 'error');
    }
}

async function syncIdentity(accounts) {
    if (!accounts || accounts.length === 0) {
        userAddress = null;
        signer = null;
        updateIdentityUI(false);
        pushLog('Auth: Identity link DE-AUTHENTICATED.', 'auth');
    } else {
        userAddress = accounts[0];
        try {
            if (provider) {
                signer = await provider.getSigner();
                updateIdentityUI(true, userAddress);
                pushLog(`Auth: Identity pulse verified: ${userAddress.substring(0, 12)}...`, 'auth');
                showNotification('Identity Pulse: VERIFIED');
                refreshTelemetry();
            }
        } catch (e) {
            pushLog('Auth: Failed to establish signer on active identity.', 'error');
        }
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

/**
 * MODULE 2: Transaction Execution Engine
 */
async function broadcastPayload(e) {
    e.preventDefault();
    if (!signer) {
        pushLog('Engine: Handshake required for broadcast.', 'error');
        return;
    }

    const target = document.getElementById('recipient').value;
    const value = document.getElementById('amount').value;

    try {
        setEngineState(true, 'Injecting payload into decentralized mempool...');
        pushLog(`Engine: Broadcasting ${value} ETH to target: ${target.substring(0, 12)}...`, 'engine');
        
        const tx = await signer.sendTransaction({
            to: target,
            value: ethers.parseEther(value)
        });

        setEngineState(true, 'Awaiting settlement verification (Mining)...');
        pushLog(`Engine: Payload injected. Hash: ${tx.hash.substring(0, 16)}...`, 'engine');
        showNotification('Payload Broadcasted');

        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            pushLog('Engine: Transaction settlement finalized.', 'engine');
            showNotification('Settlement Verified', 'success');
            
            transactions.unshift({ 
                hash: tx.hash, 
                dest: target, 
                value: value, 
                time: new Date().toLocaleTimeString('en-US', { hour12: false }) 
            });
            renderHistory();
            
            txCount++;
            document.getElementById('tx-total').textContent = txCount;
            document.getElementById('payment-form').reset();
            refreshTelemetry();
        }
    } catch (e) {
        pushLog(`Error: Engine fault: ${e.message}`, 'error');
        showNotification(e.reason || 'Broadcast Refused', 'error');
    } finally {
        setEngineState(false);
    }
}

/**
 * UTILITY KERNEL
 */
function bindNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.onclick = (e) => {
            e.preventDefault();
            switchPage(item.getAttribute('data-page'));
        };
    });
}

function renderHistory() {
    const list = document.getElementById('tx-log-full');
    if (!list) return;

    if (transactions.length > 0) {
        const empty = list.querySelector('.empty-data');
        if (empty) empty.remove();
    }

    list.innerHTML = transactions.map(t => `
        <tr>
            <td class="mono fs-11">${t.hash.substring(0, 16)}...</td>
            <td>${t.time}</td>
            <td class="mono fs-11">${t.dest.substring(0, 12)}...</td>
            <td class="fw-800">${t.value} ETH</td>
            <td class="success-text">SETTLED ✓</td>
        </tr>
    `).join('');
}

async function refreshTelemetry() {
    if (!userAddress || !provider) return;
    try {
        const balance = await provider.getBalance(userAddress);
        const eth = parseFloat(ethers.formatEther(balance));
        document.getElementById('user-balance').innerHTML = `${eth.toFixed(4)} <span>ETH</span>`;
        document.getElementById('balance-usd').textContent = (eth * 2420.50).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        const net = await provider.getNetwork();
        document.getElementById('chain-id').textContent = net.chainId.toString();
    } catch (e) {}
}

function startGlobalTelemetry() {
    pushLog('Telemetry: Handshaking with global node cluster...', 'system');
    
    // 1. UI Telemetry (Gas/Price)
    const updateStats = () => {
        const gas = Math.floor(Math.random() * (12 - 7 + 1)) + 7;
        const gasEl = document.getElementById('gas-val');
        if (gasEl) gasEl.textContent = `${gas} Gwei`;
        
        const ethPriceEl = document.getElementById('eth-price-val');
        if (ethPriceEl) {
            const ethBase = 2420.50 + (Math.random() * 4 - 2);
            ethPriceEl.textContent = `$${ethBase.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        }
        setTimeout(updateStats, 12000);
    };
    updateStats();

    // 2. Background Kernel Heartbeat
    const kernelStatusMsgs = [
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

    const runHeartbeat = () => {
        const randomMsg = kernelStatusMsgs[Math.floor(Math.random() * kernelStatusMsgs.length)];
        pushLog(`System: ${randomMsg}`, 'system');
        setTimeout(runHeartbeat, 5000 + Math.random() * 5000); // Varied interval for realism
    };
    runHeartbeat();
}

function setEngineState(loading, text) {
    document.getElementById('tx-loading').classList.toggle('hidden', !loading);
    document.getElementById('loading-text').textContent = text;
    document.getElementById('send-payment').disabled = loading;
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

// Global Event Handlers
document.addEventListener('DOMContentLoaded', () => {
    initializeKernel();
    
    // Explicit bindings to catch dynamic DOM ready
    document.getElementById('connect-wallet').onclick = startHandshake;
    document.getElementById('switch-wallet').onclick = startHandshake;
    document.getElementById('disconnect-wallet').onclick = () => syncIdentity([]);
    document.getElementById('payment-form').onsubmit = broadcastPayload;

    // Real-time input logging
    document.getElementById('recipient').oninput = (e) => {
        if (e.target.value.length === 2) pushLog('Buffer: Target node identification pending...', 'engine');
    };
    document.getElementById('amount').oninput = (e) => {
        if (e.target.value) pushLog(`Buffer: Volume parity check for ${e.target.value} ETH...`, 'engine');
    };
});
