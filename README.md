# 🌍 CrossBorderPay | Blockchain Payment Portal

A fully functional, decentralized web application for cross-border cryptocurrency payments. This system allows users to seamlessly convert fiat currencies (INR, USD, EUR, GBP) to Ethereum, broadcast transactions via MetaMask, and route payments through a custom Solidity smart contract with automated fee deduction.

Built with **Vite**, **Vanilla JS/CSS**, **ethers.js**, and the **CoinGecko API**.

---

## ✨ Key Features

1. **🔒 Secure Identity & Wallet Protocol**
   - Seamless MetaMask integration (EIP-1193 standard).
   - Real-time detection of account and network changes.
   - Dynamic UI state (Connect/Disconnect Handshake).

2. **💱 Live Fiat-to-Crypto Conversion (CoinGecko)**
   - Fetches live ETH market rates for **INR, USD, EUR, and GBP**.
   - Intelligent 60-second caching to prevent API rate-limiting.
   - Dynamic calculation of Platform Fees and Final Recipient amounts.

3. **📜 Immutable Settlement Ledger (Local storage)**
   - Persistent transaction history saved directly in the browser.
   - Tracks Source Fiat, ETH Volume, Network Fees, and TX Hashes.
   - Session data survives page reloads and is grouped by wallet address.

4. **⚡ Smart Contract Routing (UI-Driven Deployment)**
   - Includes a custom Solidity Smart Contract (`CrossBorderPayment.sol`).
   - Deploy the contract directly from the UI using MetaMask—no terminal needed!
   - Auto-routes transactions through the contract, deducting a 0.5% fee.
   - Real-time UI badges ("Direct Transfer" vs "Contract Routed").

---

## 🛠️ Technology Stack

- **Frontend Core:** HTML5, CSS3 (Custom Variables, Flexbox, Grid), Vanilla JavaScript (ES6+).
- **Build Tool:** Vite (for fast, modern development).
- **Blockchain/Web3:** `ethers.js` (v6.x) for all Ethereum/MetaMask interactions.
- **Smart Contract:** Solidity `^0.8.20`.
- **External Data:** CoinGecko Public API.

---

## 🚀 How to Run the Project Locally

### Prerequisites
1. **Node.js** installed (v16+ recommended).
2. **MetaMask** browser extension installed and set up.
3. Your MetaMask network set to **Sepolia Test Network**, with some Sepolia Test ETH. (You can get free test ETH from faucets like Google Web3 Faucet or Alchemy).

### Installation & Setup

1. **Clone/Open the repository inside your terminal.**
2. **Install the dependencies:**
   ```bash
   npm install
   ```
3. **Start the development server:**
   ```bash
   npm run dev
   ```
4. **Open the App:** Navigate to `http://localhost:5173` in your brave/chrome browser.

---

## 💻 How to Use the App

### 1. Connect Wallet
- Click the **"Initialize Secure Handshake"** button.
- Approve the connection in the MetaMask popup. Your balance and telemetry will appear at the top.

### 2. Deploy Smart Contract (Optional but Recommended)
- Look at the **Smart Contract** box on the left sidebar.
- Click **🚀 Deploy Contract**. 
- Confirm the deployment in MetaMask. (This costs a small amount of test ETH gas).
- Wait a few seconds. The UI will automatically update to **Contract Routed (0.5% Fee)**, and the contract address is saved to your browser automatically.

### 3. Send a Payment
- In the **Transaction Core** box, enter the **Recipient Address** (e.g., another Sepolia wallet you own).
- Select the **Destination Country** and **Currency** (e.g., USA, USD).
- Enter the **Amount** in fiat (e.g., 500). The system will automatically convert this to ETH based on live market rates.
- Click **"Broadcast Payload"**.
- MetaMask will pop up asking you to confirm the transaction.
- Once confirmed, the transaction is permanently logged in the **Blockchain Ledger** (accessible via the left menu).

---

## 📁 Project Structure

```
blockchain_CrossBorderPayments/
├── index.html               # Main application markup
├── style.css                # Custom premium UI styling and animations
├── main.js                  # Core application logic & ethers.js integration
├── config.js                # Contract ABI, Bytecode, and State management
├── contracts/
│   └── CrossBorderPayment.sol # The Solidity smart contract source code
├── package.json             # Project dependencies (Vite, ethers)
└── vite.config.js           # Build tool configuration
```

---

## 🔐 Security & Architecture Notes
- **Zero-Backend Architecture**: The app relies entirely on decentralized infrastructure (The Ethereum Blockchain) and direct API queries. No centralized database or backend server is required.
- **Checks-Effects-Interactions**: The Smart Contract follows optimal security paradigms to prevent reentrancy and arithmetic overflows.
- **Client-Side Keys**: At no point are private keys ever exposed or requested in the UI or codebase. All execution signing is securely isolated inside the MetaMask vaulted environment.
