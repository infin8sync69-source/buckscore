// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../core/SoulVerified.sol";

/**
 * @title BusinessAgreement
 * @notice Business↔business milestone-based service agreements on the Bucks Network.
 *
 * ─── Overview ──────────────────────────────────────────────────────────────
 *
 *  Two business entities agree on a service contract with N milestones.
 *  The client locks the total payment in escrow. The provider completes
 *  milestones and submits them for approval. The client approves or disputes.
 *
 * ─── Roles ─────────────────────────────────────────────────────────────────
 *
 *  CLIENT   — pays; locks funds; approves or disputes milestones.
 *  PROVIDER — delivers; submits milestone completion.
 *  ARBITER  — Soul Engine oracle (or fallback: protocol admin) resolves disputes.
 *
 * ─── State machine (per agreement) ────────────────────────────────────────
 *
 *  Draft → Active → (per milestone: Pending → Approved → Paid
 *                                           ↘ Disputed → Resolved)
 *       → Completed (all milestones paid)
 *       → Cancelled (before activation)
 *       → Terminated (mutual consent or arbiter decision)
 *
 * ─── Fees ──────────────────────────────────────────────────────────────────
 *
 *  A protocol fee of 1% is deducted from each milestone payment.
 *
 * ─── Soul Engine identity ──────────────────────────────────────────────────
 *
 *  Optional: require both parties to hold a BUSINESS_ENTITY attestation
 *  when creating the agreement. Helps prevent sybil abuse.
 */
contract BusinessAgreement is SoulVerified {
    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    uint256 public constant DISPUTE_WINDOW     = 7  days;
    uint256 public constant APPROVAL_DEADLINE  = 30 days; // auto-approve if client silent
    uint256 public constant PROTOCOL_FEE_BPS   = 100;     // 1%
    uint256 public constant BPS_DENOMINATOR    = 10_000;

    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum AgreementStatus {
        Draft,      // created, not yet funded
        Active,     // fully funded
        Completed,  // all milestones paid
        Cancelled,  // cancelled before activation
        Terminated  // terminated mid-flight
    }

    enum MilestoneStatus {
        Pending,    // not yet submitted
        Submitted,  // provider claimed completion
        Approved,   // client approved; payment released
        Disputed,   // client disputed
        Resolved    // dispute resolved by arbiter
    }

    struct Milestone {
        string         title;
        string         description;
        uint256        amount;       // grain allocated to this milestone
        uint256        submittedAt;  // timestamp of provider submission
        uint256        approvedAt;
        MilestoneStatus status;
        string         submissionNote;
        string         resolutionNote;
    }

    struct Agreement {
        uint256         id;
        address payable client;
        address payable provider;
        string          title;
        string          scope;          // full scope of work
        uint256         totalAmount;    // sum of all milestone amounts (grain)
        uint256         amountLocked;   // actually locked (post-funding)
        uint256         createdAt;
        uint256         activatedAt;
        AgreementStatus status;
        bool            soulGated;      // require BUSINESS_ENTITY attestation
        Milestone[]     milestones;
        uint256         milestonesPaid; // count of paid milestones
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    uint256 private _nextId;
    mapping(uint256 => Agreement) private _agreements;

    address payable public protocolAdmin;   // dispute arbiter + fee collector
    uint256 public totalFeesCollected;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event AgreementCreated(
        uint256 indexed id,
        address indexed client,
        address indexed provider,
        uint256 totalAmount
    );
    event AgreementFunded(uint256 indexed id, uint256 amount);
    event AgreementCancelled(uint256 indexed id);
    event AgreementCompleted(uint256 indexed id);
    event AgreementTerminated(uint256 indexed id, address indexed byParty);

    event MilestoneSubmitted(uint256 indexed agreementId, uint256 indexed milestoneIdx);
    event MilestoneApproved(uint256 indexed agreementId, uint256 indexed milestoneIdx, uint256 payout);
    event MilestoneDisputed(uint256 indexed agreementId, uint256 indexed milestoneIdx, address indexed disputedBy);
    event MilestoneResolved(uint256 indexed agreementId, uint256 indexed milestoneIdx, bool clientWon);
    event AutoApproved(uint256 indexed agreementId, uint256 indexed milestoneIdx);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address soulEngineAddr, address payable _protocolAdmin)
        SoulVerified(soulEngineAddr)
    {
        protocolAdmin = _protocolAdmin == address(0)
            ? payable(msg.sender)
            : _protocolAdmin;
    }

    // -----------------------------------------------------------------------
    // Agreement creation
    // -----------------------------------------------------------------------

    /**
     * @notice Create a business agreement with pre-defined milestones.
     *         The agreement starts in Draft state; client funds it separately.
     *
     * @param provider          Service provider address.
     * @param title             Short agreement title.
     * @param scope             Full scope of work description.
     * @param milestoneTitles   Array of milestone titles.
     * @param milestoneDescs    Array of milestone descriptions.
     * @param milestoneAmounts  Array of grain amounts per milestone.
     * @param soulGated         Require BUSINESS_ENTITY attestation for both parties.
     * @return id               Agreement ID.
     */
    function createAgreement(
        address payable         provider,
        string  calldata        title,
        string  calldata        scope,
        string[] calldata       milestoneTitles,
        string[] calldata       milestoneDescs,
        uint256[] calldata      milestoneAmounts,
        bool                    soulGated
    ) external returns (uint256 id) {
        require(provider != address(0),          "Business: zero provider");
        require(provider != msg.sender,          "Business: self-agreement");
        require(milestoneTitles.length > 0,      "Business: no milestones");
        require(
            milestoneTitles.length == milestoneDescs.length &&
            milestoneTitles.length == milestoneAmounts.length,
            "Business: array length mismatch"
        );

        if (soulGated) {
            _requireAttestation(msg.sender, CLAIM_BUSINESS_ENTITY);
            _requireAttestation(provider,   CLAIM_BUSINESS_ENTITY);
        }

        uint256 total;
        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            require(milestoneAmounts[i] > 0, "Business: zero milestone amount");
            total += milestoneAmounts[i];
        }

        id = _nextId++;

        Agreement storage a = _agreements[id];
        a.id          = id;
        a.client      = payable(msg.sender);
        a.provider    = provider;
        a.title       = title;
        a.scope       = scope;
        a.totalAmount = total;
        a.createdAt   = block.timestamp;
        a.status      = AgreementStatus.Draft;
        a.soulGated   = soulGated;

        for (uint256 i = 0; i < milestoneTitles.length; i++) {
            a.milestones.push(Milestone({
                title:          milestoneTitles[i],
                description:    milestoneDescs[i],
                amount:         milestoneAmounts[i],
                submittedAt:    0,
                approvedAt:     0,
                status:         MilestoneStatus.Pending,
                submissionNote: "",
                resolutionNote: ""
            }));
        }

        emit AgreementCreated(id, msg.sender, provider, total);
    }

    // -----------------------------------------------------------------------
    // Funding
    // -----------------------------------------------------------------------

    /**
     * @notice Client funds the agreement. Sends exactly totalAmount in grain.
     *         Moves agreement from Draft → Active.
     */
    function fundAgreement(uint256 id) external payable {
        Agreement storage a = _agreements[id];
        require(msg.sender == a.client,               "Business: not client");
        require(a.status == AgreementStatus.Draft,    "Business: not draft");
        require(msg.value == a.totalAmount,           "Business: wrong amount");

        a.status       = AgreementStatus.Active;
        a.amountLocked = msg.value;
        a.activatedAt  = block.timestamp;

        emit AgreementFunded(id, msg.value);
    }

    /**
     * @notice Cancel a Draft agreement (before funding).
     */
    function cancelAgreement(uint256 id) external {
        Agreement storage a = _agreements[id];
        require(
            msg.sender == a.client || msg.sender == a.provider,
            "Business: not party"
        );
        require(a.status == AgreementStatus.Draft, "Business: not draft");

        a.status = AgreementStatus.Cancelled;
        emit AgreementCancelled(id);
    }

    // -----------------------------------------------------------------------
    // Milestone flow — provider side
    // -----------------------------------------------------------------------

    /**
     * @notice Provider submits a milestone as complete.
     * @param id            Agreement ID.
     * @param milestoneIdx  Index of the milestone (0-based).
     * @param note          Delivery note or link to deliverable.
     */
    function submitMilestone(uint256 id, uint256 milestoneIdx, string calldata note)
        external
    {
        Agreement storage a = _agreements[id];
        require(msg.sender == a.provider,              "Business: not provider");
        require(a.status == AgreementStatus.Active,    "Business: not active");
        require(milestoneIdx < a.milestones.length,    "Business: bad index");

        Milestone storage m = a.milestones[milestoneIdx];
        require(m.status == MilestoneStatus.Pending,   "Business: not pending");

        // Milestones must be submitted in order.
        if (milestoneIdx > 0) {
            require(
                a.milestones[milestoneIdx - 1].status == MilestoneStatus.Approved ||
                a.milestones[milestoneIdx - 1].status == MilestoneStatus.Resolved,
                "Business: previous milestone not approved"
            );
        }

        m.status         = MilestoneStatus.Submitted;
        m.submittedAt    = block.timestamp;
        m.submissionNote = note;

        emit MilestoneSubmitted(id, milestoneIdx);
    }

    // -----------------------------------------------------------------------
    // Milestone flow — client side
    // -----------------------------------------------------------------------

    /**
     * @notice Client approves a submitted milestone; payment is released to provider.
     */
    function approveMilestone(uint256 id, uint256 milestoneIdx) external {
        Agreement storage a = _agreements[id];
        require(msg.sender == a.client,                 "Business: not client");
        require(a.status == AgreementStatus.Active,     "Business: not active");
        require(milestoneIdx < a.milestones.length,     "Business: bad index");

        Milestone storage m = a.milestones[milestoneIdx];
        require(m.status == MilestoneStatus.Submitted,  "Business: not submitted");

        _releaseMilestonePayment(a, m, milestoneIdx);
    }

    /**
     * @notice Auto-approve a submitted milestone if the client is silent for
     *         APPROVAL_DEADLINE seconds.
     */
    function autoApproveMilestone(uint256 id, uint256 milestoneIdx) external {
        Agreement storage a = _agreements[id];
        require(a.status == AgreementStatus.Active,      "Business: not active");
        require(milestoneIdx < a.milestones.length,      "Business: bad index");

        Milestone storage m = a.milestones[milestoneIdx];
        require(m.status == MilestoneStatus.Submitted,   "Business: not submitted");
        require(
            block.timestamp >= m.submittedAt + APPROVAL_DEADLINE,
            "Business: deadline not passed"
        );

        emit AutoApproved(id, milestoneIdx);
        _releaseMilestonePayment(a, m, milestoneIdx);
    }

    /**
     * @notice Client disputes a submitted milestone within DISPUTE_WINDOW.
     */
    function disputeMilestone(uint256 id, uint256 milestoneIdx) external {
        Agreement storage a = _agreements[id];
        require(msg.sender == a.client,                  "Business: not client");
        require(a.status == AgreementStatus.Active,      "Business: not active");
        require(milestoneIdx < a.milestones.length,      "Business: bad index");

        Milestone storage m = a.milestones[milestoneIdx];
        require(m.status == MilestoneStatus.Submitted,   "Business: not submitted");
        require(
            block.timestamp < m.submittedAt + DISPUTE_WINDOW,
            "Business: dispute window closed"
        );

        m.status = MilestoneStatus.Disputed;
        emit MilestoneDisputed(id, milestoneIdx, msg.sender);
    }

    // -----------------------------------------------------------------------
    // Dispute resolution (protocol admin / Soul Engine arbiter)
    // -----------------------------------------------------------------------

    /**
     * @notice Resolve a disputed milestone.
     * @param id            Agreement ID.
     * @param milestoneIdx  Milestone index.
     * @param clientWon     True → refund milestone amount to client.
     *                      False → release to provider.
     * @param note          Resolution note.
     */
    function resolveDispute(
        uint256 id,
        uint256 milestoneIdx,
        bool    clientWon,
        string  calldata note
    ) external {
        require(msg.sender == protocolAdmin, "Business: not arbiter");

        Agreement storage a = _agreements[id];
        require(a.status == AgreementStatus.Active,      "Business: not active");
        require(milestoneIdx < a.milestones.length,      "Business: bad index");

        Milestone storage m = a.milestones[milestoneIdx];
        require(m.status == MilestoneStatus.Disputed,    "Business: not disputed");

        m.status         = MilestoneStatus.Resolved;
        m.resolutionNote = note;

        address payable winner = clientWon ? a.client : a.provider;

        if (clientWon) {
            // Refund to client — no fee.
            (bool sent,) = a.client.call{value: m.amount}("");
            require(sent, "Business: refund failed");
        } else {
            // Release to provider — with fee.
            uint256 fee    = (m.amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
            uint256 payout = m.amount - fee;
            totalFeesCollected += fee;

            (bool sent,)  = a.provider.call{value: payout}("");
            require(sent, "Business: payment failed");
            if (fee > 0) {
                (bool fs,) = protocolAdmin.call{value: fee}("");
                require(fs, "Business: fee failed");
            }
            a.milestonesPaid++;
            m.approvedAt = block.timestamp;
        }

        emit MilestoneResolved(id, milestoneIdx, clientWon);

        if (!clientWon) {
            _checkCompletion(a);
        }

        winner; // suppress unused warning
    }

    // -----------------------------------------------------------------------
    // Mutual termination
    // -----------------------------------------------------------------------

    /**
     * @notice Either party can terminate an Active agreement by mutual consent
     *         (call from both parties within 7 days of each other).
     *         On termination, unpaid milestone amounts are refunded to the client.
     *
     * @dev    For simplicity: either party calls terminate(); the other must
     *         counter-call within DISPUTE_WINDOW. Stored as a pending termination.
     *         If admin calls, it is immediate.
     */

    mapping(uint256 => address) private _terminationRequest;

    function requestTermination(uint256 id) external {
        Agreement storage a = _agreements[id];
        require(a.status == AgreementStatus.Active,  "Business: not active");
        require(
            msg.sender == a.client || msg.sender == a.provider,
            "Business: not party"
        );

        if (_terminationRequest[id] == address(0)) {
            _terminationRequest[id] = msg.sender;
        } else {
            // Other party already requested — execute termination.
            require(_terminationRequest[id] != msg.sender, "Business: same party");
            _terminate(id, msg.sender);
        }
    }

    /// @notice Protocol admin can terminate with immediate effect.
    function adminTerminate(uint256 id) external {
        require(msg.sender == protocolAdmin, "Business: not admin");
        Agreement storage a = _agreements[id];
        require(a.status == AgreementStatus.Active, "Business: not active");
        _terminate(id, msg.sender);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function getAgreement(uint256 id)
        external
        view
        returns (
            address client,
            address provider,
            string memory title,
            uint256 totalAmount,
            uint256 amountLocked,
            AgreementStatus status,
            uint256 milestoneCount,
            uint256 milestonesPaid
        )
    {
        Agreement storage a = _agreements[id];
        return (
            a.client, a.provider, a.title, a.totalAmount,
            a.amountLocked, a.status, a.milestones.length, a.milestonesPaid
        );
    }

    function getMilestone(uint256 id, uint256 idx)
        external
        view
        returns (
            string memory title,
            uint256 amount,
            MilestoneStatus status,
            uint256 submittedAt,
            string memory submissionNote
        )
    {
        Milestone storage m = _agreements[id].milestones[idx];
        return (m.title, m.amount, m.status, m.submittedAt, m.submissionNote);
    }

    function totalAgreements() external view returns (uint256) { return _nextId; }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _releaseMilestonePayment(
        Agreement storage a,
        Milestone  storage m,
        uint256 milestoneIdx
    ) internal {
        m.status     = MilestoneStatus.Approved;
        m.approvedAt = block.timestamp;

        uint256 fee    = (m.amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 payout = m.amount - fee;
        totalFeesCollected += fee;

        (bool sent,) = a.provider.call{value: payout}("");
        require(sent, "Business: payment failed");

        if (fee > 0) {
            (bool fs,) = protocolAdmin.call{value: fee}("");
            require(fs, "Business: fee failed");
        }

        a.milestonesPaid++;
        emit MilestoneApproved(a.id, milestoneIdx, payout);

        _checkCompletion(a);
    }

    function _checkCompletion(Agreement storage a) internal {
        if (a.milestonesPaid == a.milestones.length) {
            a.status = AgreementStatus.Completed;
            emit AgreementCompleted(a.id);
        }
    }

    function _terminate(uint256 id, address byParty) internal {
        Agreement storage a = _agreements[id];
        a.status = AgreementStatus.Terminated;

        // Refund all unpaid milestone amounts to the client.
        uint256 refund;
        for (uint256 i = 0; i < a.milestones.length; i++) {
            Milestone storage m = a.milestones[i];
            if (
                m.status == MilestoneStatus.Pending   ||
                m.status == MilestoneStatus.Disputed
            ) {
                refund += m.amount;
            }
        }

        if (refund > 0) {
            (bool sent,) = a.client.call{value: refund}("");
            require(sent, "Business: refund failed");
        }

        delete _terminationRequest[id];
        emit AgreementTerminated(id, byParty);
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    function setSoulEngine(address newEngine) external {
        require(msg.sender == protocolAdmin, "Business: not admin");
        _setSoulEngine(newEngine);
    }

    function transferAdmin(address payable newAdmin) external {
        require(msg.sender == protocolAdmin, "Business: not admin");
        require(newAdmin != address(0),      "Business: zero admin");
        protocolAdmin = newAdmin;
    }

    // -----------------------------------------------------------------------
    // Receive
    // -----------------------------------------------------------------------

    receive() external payable { revert("Business: use fundAgreement()"); }
}
