// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../core/SoulVerified.sol";

/**
 * @title BucksTransfer
 * @notice User↔user native BUCKS transfer contract with optional payment
 *         agreements, recurring-payment streams, and Soul Engine identity gating.
 *
 * ─── Features ──────────────────────────────────────────────────────────────
 *
 *  1. DIRECT TRANSFER  — send BUCKS to any address with an on-chain memo.
 *
 *  2. PAYMENT AGREEMENT — two parties (payer + payee) agree off-chain on
 *     terms; payer locks funds on-chain; payee claims them after the agreed
 *     release date; either party can cancel before release.
 *
 *  3. SOUL-GATED TRANSFER — optional flag requiring the recipient to hold a
 *     Soul Engine identity attestation above MIN_CONFIDENCE.
 *
 * ─── Native coin (BUCKS) ───────────────────────────────────────────────────
 *
 *  This contract handles the chain's native coin directly (msg.value).
 *  There is no ERC-20 wrapper; values are expressed in grain
 *  (1 BUCKS = 1e18 grain), the smallest indivisible unit.
 *
 *  1 BUCKS = the classical gold standard weight (mithqal).
 *
 * ─── ChainID ───────────────────────────────────────────────────────────────
 *  Mainnet: 8192  (0x2000)
 *  Testnet: 81920
 */
contract BucksTransfer is SoulVerified {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum AgreementStatus {
        Pending,   // payer locked funds; waiting for release date
        Released,  // payee claimed
        Cancelled  // cancelled by payer or payee
    }

    struct Agreement {
        address payable payer;
        address payable payee;
        uint256 amount;          // in grain
        uint256 releaseAt;       // unix timestamp — payee can claim after this
        uint256 cancelDeadline;  // payer can cancel before this (0 = anytime)
        bool    soulGated;       // if true, payee must hold identity attestation
        AgreementStatus status;
        string  memo;
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    uint256 private _nextId;
    mapping(uint256 => Agreement) public agreements;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event DirectTransfer(
        address indexed from,
        address indexed to,
        uint256 amount,
        string  memo
    );

    event AgreementCreated(
        uint256 indexed id,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint256 releaseAt
    );

    event AgreementReleased(uint256 indexed id, address indexed payee, uint256 amount);
    event AgreementCancelled(uint256 indexed id, address indexed cancelledBy);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /**
     * @param soulEngineAddr Soul Engine oracle address.
     *                       Pass address(0) to disable identity gating.
     */
    constructor(address soulEngineAddr) SoulVerified(soulEngineAddr) {}

    // -----------------------------------------------------------------------
    // 1. Direct transfer
    // -----------------------------------------------------------------------

    /**
     * @notice Send native BUCKS to `to` with an on-chain memo.
     * @param to        Recipient address.
     * @param memo      Plain-text note recorded in the event log.
     * @param soulGated If true, recipient must have a Soul Engine
     *                  identity attestation ≥ MIN_CONFIDENCE.
     */
    function transfer(address payable to, string calldata memo, bool soulGated)
        external
        payable
    {
        require(msg.value > 0,          "BucksTransfer: zero value");
        require(to != address(0),       "BucksTransfer: zero address");
        require(to != msg.sender,       "BucksTransfer: self-transfer");

        if (soulGated) {
            _requireAttestation(to, CLAIM_IDENTITY);
        }

        (bool sent,) = to.call{value: msg.value}("");
        require(sent, "BucksTransfer: send failed");

        emit DirectTransfer(msg.sender, to, msg.value, memo);
    }

    // -----------------------------------------------------------------------
    // 2. Payment agreements
    // -----------------------------------------------------------------------

    /**
     * @notice Create a payment agreement. Payer locks BUCKS now; payee claims
     *         them on or after `releaseAt`.
     *
     * @param payee          Recipient address.
     * @param releaseAt      Unix timestamp after which payee can claim.
     * @param cancelDeadline Payer can cancel before this timestamp.
     *                       Pass 0 to allow cancellation at any time before release.
     * @param soulGated      Require Soul Engine identity on claim.
     * @param memo           Description of the agreement.
     * @return id            Agreement ID.
     */
    function createAgreement(
        address payable payee,
        uint256 releaseAt,
        uint256 cancelDeadline,
        bool    soulGated,
        string  calldata memo
    )
        external
        payable
        returns (uint256 id)
    {
        require(msg.value > 0,               "BucksTransfer: zero value");
        require(payee != address(0),         "BucksTransfer: zero payee");
        require(payee != msg.sender,         "BucksTransfer: self-agreement");
        require(releaseAt > block.timestamp, "BucksTransfer: release in past");

        id = _nextId++;

        agreements[id] = Agreement({
            payer:          payable(msg.sender),
            payee:          payee,
            amount:         msg.value,
            releaseAt:      releaseAt,
            cancelDeadline: cancelDeadline,
            soulGated:      soulGated,
            status:         AgreementStatus.Pending,
            memo:           memo
        });

        emit AgreementCreated(id, msg.sender, payee, msg.value, releaseAt);
    }

    /**
     * @notice Payee claims the locked BUCKS after the release date.
     */
    function claimAgreement(uint256 id) external {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Pending, "BucksTransfer: not pending");
        require(msg.sender == a.payee,               "BucksTransfer: not payee");
        require(block.timestamp >= a.releaseAt,      "BucksTransfer: too early");

        if (a.soulGated) {
            _requireAttestation(msg.sender, CLAIM_IDENTITY);
        }

        a.status = AgreementStatus.Released;

        (bool sent,) = a.payee.call{value: a.amount}("");
        require(sent, "BucksTransfer: send failed");

        emit AgreementReleased(id, a.payee, a.amount);
    }

    /**
     * @notice Cancel a pending agreement and refund the payer.
     *
     * @dev  Payer can cancel before cancelDeadline (or anytime if deadline == 0).
     *       Payee can cancel at any time before release date.
     */
    function cancelAgreement(uint256 id) external {
        Agreement storage a = agreements[id];
        require(a.status == AgreementStatus.Pending, "BucksTransfer: not pending");

        bool isPayer = msg.sender == a.payer;
        bool isPayee = msg.sender == a.payee;
        require(isPayer || isPayee, "BucksTransfer: not party");

        if (isPayer) {
            // Payer can cancel before cancelDeadline (0 = no deadline restriction).
            if (a.cancelDeadline != 0) {
                require(block.timestamp < a.cancelDeadline, "BucksTransfer: cancel window closed");
            }
            require(block.timestamp < a.releaseAt, "BucksTransfer: already past release");
        }
        // Payee can cancel at any time before release.
        if (isPayee) {
            require(block.timestamp < a.releaseAt, "BucksTransfer: already past release");
        }

        a.status = AgreementStatus.Cancelled;

        (bool sent,) = a.payer.call{value: a.amount}("");
        require(sent, "BucksTransfer: refund failed");

        emit AgreementCancelled(id, msg.sender);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// @notice Return the current agreement count.
    function totalAgreements() external view returns (uint256) {
        return _nextId;
    }

    /// @notice Check if a given address has Soul Engine identity attestation.
    function hasIdentityAttestation(address subject)
        external
        view
        returns (bool verified, uint256 confidence)
    {
        return _queryAttestation(subject, CLAIM_IDENTITY);
    }

    // -----------------------------------------------------------------------
    // Receive
    // -----------------------------------------------------------------------

    /// @dev Reject plain ETH sends — use transfer() explicitly.
    receive() external payable { revert("BucksTransfer: use transfer()"); }
}
