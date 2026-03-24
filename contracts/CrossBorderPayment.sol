// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CrossBorderPayment
 * @notice Routes cross-border payments with a configurable platform fee, transaction limits, and emergency pause mechanism.
 * @dev Follows checks-effects-interactions pattern. Uses Solidity 0.8+ for overflow safety.
 *
 * Deployment: Use Remix IDE or In-Browser IDE.
 * Constructor arg: 50 (= 0.5% fee in basis points)
 */
contract CrossBorderPayment {

    address public owner;
    uint256 public feePercentage; // basis points (50 = 0.5%)
    uint256 public totalFeesCollected;
    
    // Limits
    uint256 public minTransactionAmount = 0.001 ether;
    uint256 public maxTransactionAmount = 100 ether;
    
    // Circuit Breaker
    bool public isPaused;

    // Blacklist (Compliance)
    mapping(address => bool) public isBlacklisted;

    struct Payment {
        address sender;
        address receiver;
        uint256 amount;
        uint256 fee;
        uint256 timestamp;
        string  sourceCurrency;
        string  sourceCountry;
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
        string  sourceCountry,
        string  destCountry,
        uint256 timestamp
    );

    event FeeWithdrawn(address indexed owner, uint256 amount);
    event Paused(address account);
    event Unpaused(address account);
    event LimitsUpdated(uint256 minAmount, uint256 maxAmount);
    event BlacklistUpdated(address indexed account, bool isListed);

    // ── Modifiers ───────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized: Owner only");
        _;
    }
    
    modifier whenNotPaused() {
        require(!isPaused, "Contract is currently paused for maintenance");
        _;
    }

    modifier notBlacklisted(address _account) {
        require(!isBlacklisted[_account], "Account is restricted for compliance");
        _;
    }

    // ── Constructor ─────────────────────────────────────────────────────
    constructor(uint256 _feePercentage) {
        require(_feePercentage <= 1000, "Fee cannot exceed 10%");
        owner = msg.sender;
        feePercentage = _feePercentage;
        isPaused = false;
    }

    // ── Admin Functions ─────────────────────────────────────────────────
    function pause() external onlyOwner {
        isPaused = true;
        emit Paused(msg.sender);
    }
    
    function unpause() external onlyOwner {
        isPaused = false;
        emit Unpaused(msg.sender);
    }
    
    function updateLimits(uint256 _min, uint256 _max) external onlyOwner {
        require(_min < _max, "Min limit must be less than Max");
        minTransactionAmount = _min;
        maxTransactionAmount = _max;
        emit LimitsUpdated(_min, _max);
    }
    
    function setBlacklistStatus(address _account, bool _status) external onlyOwner {
        isBlacklisted[_account] = _status;
        emit BlacklistUpdated(_account, _status);
    }

    // ── Core: Send Payment ──────────────────────────────────────────────
    /**
     * @notice Send ETH to a receiver, deducting a platform fee.
     * @param _receiver       Recipient wallet address
     * @param _sourceCurrency Source fiat currency code (e.g. "INR")
     * @param _sourceCountry  Sender's country code (e.g. "IN")
     * @param _destCountry    Destination country code (e.g. "US")
     */
    function sendPayment(
        address payable _receiver,
        string calldata _sourceCurrency,
        string calldata _sourceCountry,
        string calldata _destCountry
    ) 
        external 
        payable 
        whenNotPaused 
        notBlacklisted(msg.sender)
        notBlacklisted(_receiver) 
    {
        // ── Checks ──
        require(msg.value >= minTransactionAmount, "Amount below minimum threshold");
        require(msg.value <= maxTransactionAmount, "Amount exceeds maximum threshold");
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
            sourceCountry:  _sourceCountry,
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
            _sourceCountry,
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
