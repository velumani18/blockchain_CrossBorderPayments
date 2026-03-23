// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CrossBorderPayment
 * @notice Routes cross-border payments with a configurable platform fee.
 * @dev Follows checks-effects-interactions pattern. Uses Solidity 0.8+ for overflow safety.
 *
 * Deployment: Use Remix IDE (https://remix.ethereum.org) on Sepolia testnet.
 * Constructor arg: 50 (= 0.5% fee in basis points)
 */
contract CrossBorderPayment {

    address public owner;
    uint256 public feePercentage; // basis points (50 = 0.5%)
    uint256 public totalFeesCollected;

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

    // ── Events ──────────────────────────────────────────────────────────
    event PaymentSent(
        uint256 indexed paymentId,
        address indexed sender,
        address indexed receiver,
        uint256 amount,
        uint256 fee,
        string  sourceCurrency,
        string  destCountry,
        uint256 timestamp
    );

    event FeeWithdrawn(address indexed owner, uint256 amount);

    // ── Modifiers ───────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    // ── Constructor ─────────────────────────────────────────────────────
    constructor(uint256 _feePercentage) {
        require(_feePercentage <= 1000, "Fee cannot exceed 10%");
        owner = msg.sender;
        feePercentage = _feePercentage;
    }

    // ── Core: Send Payment ──────────────────────────────────────────────
    /**
     * @notice Send ETH to a receiver, deducting a platform fee.
     * @param _receiver       Recipient wallet address
     * @param _sourceCurrency Source fiat currency code (e.g. "INR")
     * @param _destCountry    Destination country code (e.g. "IN")
     */
    function sendPayment(
        address payable _receiver,
        string calldata _sourceCurrency,
        string calldata _destCountry
    ) external payable {
        // ── Checks ──
        require(msg.value > 0, "Amount must be greater than 0");
        require(_receiver != address(0), "Invalid receiver address");
        require(_receiver != msg.sender, "Cannot send to yourself");

        uint256 fee = (msg.value * feePercentage) / 10000;
        uint256 transferAmount = msg.value - fee;

        // ── Effects (state changes BEFORE external call) ──
        uint256 paymentId = payments.length;
        payments.push(Payment({
            sender:         msg.sender,
            receiver:       _receiver,
            amount:         msg.value,
            fee:            fee,
            timestamp:      block.timestamp,
            sourceCurrency: _sourceCurrency,
            destCountry:    _destCountry
        }));

        userPaymentIds[msg.sender].push(paymentId);
        userPaymentIds[_receiver].push(paymentId);
        totalFeesCollected += fee;

        // ── Interactions (external call AFTER state changes) ──
        (bool success, ) = _receiver.call{value: transferAmount}("");
        require(success, "Transfer to receiver failed");

        emit PaymentSent(
            paymentId,
            msg.sender,
            _receiver,
            msg.value,
            fee,
            _sourceCurrency,
            _destCountry,
            block.timestamp
        );
    }

    // ── Owner: Withdraw accumulated fees ────────────────────────────────
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");

        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Withdrawal failed");

        emit FeeWithdrawn(owner, balance);
    }

    // ── View Functions ──────────────────────────────────────────────────
    function getPaymentCount() external view returns (uint256) {
        return payments.length;
    }

    function getUserPaymentIds(address _user) external view returns (uint256[] memory) {
        return userPaymentIds[_user];
    }

    function getPayment(uint256 _id) external view returns (Payment memory) {
        require(_id < payments.length, "Payment does not exist");
        return payments[_id];
    }
}
