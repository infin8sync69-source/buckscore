// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../core/SoulVerified.sol";
import "../lib/Fees.sol";

/**
 * @title BucksEscrow
 * @notice Conditional escrow for user↔user agreements on the Bucks Network.
 *
 * ─── Flow ──────────────────────────────────────────────────────────────────
 *
 *   Depositor  →  deposit()         Lock BUCKS in escrow.
 *   Depositor  →  confirmRelease()  Signal work is done; starts dispute window.
 *   Beneficiary →  claim()          Claim after dispute window (if no dispute).
 *   Either party → openDispute()    Raise a dispute within the dispute window.
 *   Soul Engine  → resolveDispute() Oracle-backed resolution (or owner fallback).
 *   Depositor  →  refund()          Reclaim funds if no action taken in timeout.
 *
 * ─── States ────────────────────────────────────────────────────────────────
 *
 *   Locked → Confirmed → Claimed  (normal)
 *           ↘ Disputed → Resolved (dispute)
 *   Locked →           → Refunded (timeout)
 *
 * ─── Timing ────────────────────────────────────────────────────────────────
 *
 *   DISPUTE_WINDOW  7 days after confirmRelease() — beneficiary can raise dispute.
 *   ESCROW_TIMEOUT  90 days after deposit — depositor can refund if no action.
 */
contract BucksEscrow is SoulVerified {
    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    uint256 public constant DISPUTE_WINDOW  = 7  days;
    uint256 public constant ESCROW_TIMEOUT  = 90 days;

    // Protocol fee (taken on successful claims): 0.5% = 50 basis points.
    uint256 public constant FEE_BPS         = 50;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum EscrowStatus {
        Locked,      // funds deposited, awaiting confirmation
        Confirmed,   // depositor confirmed; dispute window running
        Claimed,     // beneficiary claimed (success)
        Disputed,    // dispute raised; awaiting resolution
        Resolved,    // dispute resolved (beneficiary or depositor won)
        Refunded     // timeout refund to depositor
    }

    struct Escrow {
        address payable depositor;
        address payable beneficiary;
        uint256 amount;          // grain locked (excluding protocol fee)
        uint256 depositedAt;
        uint256 confirmedAt;     // 0 if not yet confirmed
        EscrowStatus status;
        string  description;     // human-readable agreement terms
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    uint256 private _nextId;
    mapping(uint256 => Escrow) public escrows;

    address payable public feeCollector;
    uint256 public totalFeesCollected;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event EscrowDeposited(
        uint256 indexed id,
        address indexed depositor,
        address indexed beneficiary,
        uint256 amount
    );
    event EscrowConfirmed(uint256 indexed id, uint256 confirmedAt);
    event EscrowClaimed(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event EscrowDisputed(uint256 indexed id, address indexed raisedBy);
    event EscrowResolved(uint256 indexed id, address indexed winner, uint256 amount);
    event EscrowRefunded(uint256 indexed id, address indexed depositor, uint256 amount);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address soulEngineAddr, address payable _feeCollector)
        SoulVerified(soulEngineAddr)
    {
        feeCollector = _feeCollector == address(0)
            ? payable(msg.sender)
            : _feeCollector;
    }

    // -----------------------------------------------------------------------
    // Depositor flow
    // -----------------------------------------------------------------------

    /**
     * @notice Deposit native BUCKS into escrow.
     * @param beneficiary  The address entitled to receive funds on success.
     * @param description  Human-readable terms of the escrow agreement.
     * @return id          Escrow ID.
     */
    function deposit(address payable beneficiary, string calldata description)
        external
        payable
        returns (uint256 id)
    {
        require(msg.value > 0,             "Escrow: zero value");
        require(beneficiary != address(0), "Escrow: zero beneficiary");
        require(beneficiary != msg.sender, "Escrow: self-escrow");

        id = _nextId++;

        escrows[id] = Escrow({
            depositor:    payable(msg.sender),
            beneficiary:  beneficiary,
            amount:       msg.value,
            depositedAt:  block.timestamp,
            confirmedAt:  0,
            status:       EscrowStatus.Locked,
            description:  description
        });

        emit EscrowDeposited(id, msg.sender, beneficiary, msg.value);
    }

    /**
     * @notice Depositor confirms the beneficiary's work. Starts the dispute window.
     */
    function confirmRelease(uint256 id) external {
        Escrow storage e = escrows[id];
        require(msg.sender == e.depositor,      "Escrow: not depositor");
        require(e.status == EscrowStatus.Locked, "Escrow: not locked");

        e.status      = EscrowStatus.Confirmed;
        e.confirmedAt = block.timestamp;

        emit EscrowConfirmed(id, block.timestamp);
    }

    /**
     * @notice Depositor can refund if the escrow times out without confirmation.
     */
    function refund(uint256 id) external {
        Escrow storage e = escrows[id];
        require(msg.sender == e.depositor,       "Escrow: not depositor");
        require(e.status == EscrowStatus.Locked,  "Escrow: not locked");
        require(
            block.timestamp >= e.depositedAt + ESCROW_TIMEOUT,
            "Escrow: timeout not reached"
        );

        e.status = EscrowStatus.Refunded;

        (bool sent,) = e.depositor.call{value: e.amount}("");
        require(sent, "Escrow: refund failed");

        emit EscrowRefunded(id, e.depositor, e.amount);
    }

    // -----------------------------------------------------------------------
    // Beneficiary flow
    // -----------------------------------------------------------------------

    /**
     * @notice Beneficiary claims the escrowed funds after the dispute window.
     *         A protocol fee (FEE_BPS basis points) is deducted.
     */
    function claim(uint256 id) external {
        Escrow storage e = escrows[id];
        require(msg.sender == e.beneficiary,          "Escrow: not beneficiary");
        require(e.status == EscrowStatus.Confirmed,   "Escrow: not confirmed");
        require(
            block.timestamp >= e.confirmedAt + DISPUTE_WINDOW,
            "Escrow: dispute window active"
        );

        e.status = EscrowStatus.Claimed;

        (uint256 fee, uint256 payout) = Fees.split(e.amount, FEE_BPS);

        totalFeesCollected += fee;

        (bool sent,) = e.beneficiary.call{value: payout}("");
        require(sent, "Escrow: claim failed");

        if (fee > 0) {
            (bool feeSent,) = feeCollector.call{value: fee}("");
            require(feeSent, "Escrow: fee transfer failed");
        }

        emit EscrowClaimed(id, e.beneficiary, payout);
    }

    // -----------------------------------------------------------------------
    // Dispute flow
    // -----------------------------------------------------------------------

    /**
     * @notice Either party can open a dispute within the DISPUTE_WINDOW
     *         after the depositor called confirmRelease().
     */
    function openDispute(uint256 id) external {
        Escrow storage e = escrows[id];
        bool isPayer = msg.sender == e.depositor;
        bool isPayee = msg.sender == e.beneficiary;
        require(isPayer || isPayee,                    "Escrow: not party");
        require(e.status == EscrowStatus.Confirmed,    "Escrow: not confirmed");
        require(
            block.timestamp < e.confirmedAt + DISPUTE_WINDOW,
            "Escrow: dispute window closed"
        );

        e.status = EscrowStatus.Disputed;

        emit EscrowDisputed(id, msg.sender);
    }

    /**
     * @notice Resolve a disputed escrow.
     *
     * @dev  In production this would be called by the Soul Engine oracle or an
     *       approved arbitrator. For this implementation, the fee collector
     *       (protocol admin) acts as the dispute resolver. In Phase 5 this
     *       can be upgraded to a fully on-chain oracle-driven resolution.
     *
     * @param id        Escrow ID.
     * @param toDepositor  True → refund to depositor. False → release to beneficiary.
     */
    function resolveDispute(uint256 id, bool toDepositor) external {
        require(msg.sender == feeCollector, "Escrow: not resolver");
        Escrow storage e = escrows[id];
        require(e.status == EscrowStatus.Disputed, "Escrow: not disputed");

        e.status = EscrowStatus.Resolved;

        address payable winner = toDepositor ? e.depositor : e.beneficiary;

        (bool sent,) = winner.call{value: e.amount}("");
        require(sent, "Escrow: resolve transfer failed");

        emit EscrowResolved(id, winner, e.amount);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// @notice Total number of escrows created.
    function totalEscrows() external view returns (uint256) { return _nextId; }

    /// @notice Whether the dispute window is still active.
    function disputeWindowActive(uint256 id) external view returns (bool) {
        Escrow storage e = escrows[id];
        if (e.status != EscrowStatus.Confirmed) return false;
        return block.timestamp < e.confirmedAt + DISPUTE_WINDOW;
    }

    // -----------------------------------------------------------------------
    // Receive
    // -----------------------------------------------------------------------

    receive() external payable { revert("Escrow: use deposit()"); }
}
