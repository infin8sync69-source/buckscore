// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../core/SoulVerified.sol";

/**
 * @title CommunityTreasury
 * @notice User↔community governance and treasury contract for the Bucks Network.
 *
 * ─── Overview ──────────────────────────────────────────────────────────────
 *
 *  A Community is a named on-chain entity with:
 *   • A treasury of native BUCKS.
 *   • A member set (join with optional membership fee).
 *   • A governance system: members propose → vote → execute.
 *
 * ─── Governance flow ───────────────────────────────────────────────────────
 *
 *  1. Member calls propose()     — submit a spending or config proposal.
 *  2. Members call vote()        — each member gets one vote per proposal.
 *  3. After votingPeriod ends    — anyone calls execute() if quorum reached.
 *  4. On execution:
 *       • BUCKS_TRANSFER type → sends BUCKS to the target address.
 *       • MEMBER_REMOVE type  → removes a member.
 *       • PARAM_UPDATE type   → updates a governance parameter.
 *
 * ─── Soul Engine integration ───────────────────────────────────────────────
 *
 *  Optional: admin can enable soulGatedMembership.
 *  When enabled, join() requires a Soul Engine community-member attestation.
 *  The admin can also attest arbitrary member claims via verifyMember().
 */
contract CommunityTreasury is SoulVerified {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum ProposalType { BUCKS_TRANSFER, MEMBER_REMOVE, PARAM_UPDATE }

    enum ProposalStatus { Active, Passed, Rejected, Executed, Cancelled }

    struct Proposal {
        uint256        id;
        address        proposer;
        ProposalType   kind;
        address        target;       // recipient (BUCKS_TRANSFER) or member (MEMBER_REMOVE)
        uint256        amount;       // grain to transfer (BUCKS_TRANSFER)
        bytes32        paramKey;     // param name (PARAM_UPDATE)
        uint256        paramValue;   // param new value (PARAM_UPDATE)
        string         description;
        uint256        votingEnds;
        uint256        yesVotes;
        uint256        noVotes;
        ProposalStatus status;
    }

    struct Member {
        bool    active;
        uint256 joinedAt;
        uint256 votingWeight; // 1 per member (equal governance)
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    // — Community identity —
    string  public name;
    string  public description;
    address public admin;

    // — Membership —
    mapping(address => Member)  public members;
    address[]                   private _memberList;
    uint256                     public  memberCount;
    uint256                     public  membershipFee; // grain; 0 = free

    // — Treasury —
    uint256 public totalReceived;

    // — Governance parameters —
    uint256 public votingPeriod;   // seconds (default 3 days)
    uint256 public quorumBps;      // basis points of memberCount (default 3000 = 30%)

    // — Proposals —
    uint256                        private _nextProposalId;
    mapping(uint256 => Proposal)   public  proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // — Soul Engine gating —
    bool public soulGatedMembership;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event MemberJoined(address indexed member, uint256 fee);
    event MemberRemoved(address indexed member, address indexed byProposal);
    event Donated(address indexed from, uint256 amount);
    event ProposalCreated(uint256 indexed id, address indexed proposer, ProposalType kind);
    event VoteCast(uint256 indexed id, address indexed voter, bool support);
    event ProposalExecuted(uint256 indexed id);
    event ProposalRejected(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event ParamUpdated(bytes32 indexed key, uint256 newValue);

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyAdmin() {
        require(msg.sender == admin, "Community: not admin");
        _;
    }

    modifier onlyMember() {
        require(members[msg.sender].active, "Community: not member");
        _;
    }

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /**
     * @param _name              Community display name.
     * @param _description       Short description.
     * @param _membershipFee     Grain required to join (0 = free).
     * @param _votingPeriod      Voting window in seconds (min 1 hour).
     * @param _quorumBps         Quorum as basis points of member count.
     * @param _soulGated         Require Soul Engine attestation on join.
     * @param soulEngineAddr     Soul Engine oracle address.
     */
    constructor(
        string  memory _name,
        string  memory _description,
        uint256 _membershipFee,
        uint256 _votingPeriod,
        uint256 _quorumBps,
        bool    _soulGated,
        address soulEngineAddr
    ) SoulVerified(soulEngineAddr) {
        require(bytes(_name).length > 0,   "Community: empty name");
        require(_votingPeriod >= 1 hours,  "Community: voting period too short");
        require(_quorumBps <= 10_000,      "Community: quorum > 100%");

        name                  = _name;
        description           = _description;
        membershipFee         = _membershipFee;
        votingPeriod          = _votingPeriod;
        quorumBps             = _quorumBps;
        soulGatedMembership   = _soulGated;
        admin                 = msg.sender;

        // Admin is the founding member (no fee).
        _addMember(msg.sender);
    }

    // -----------------------------------------------------------------------
    // Membership
    // -----------------------------------------------------------------------

    /**
     * @notice Join the community. If soulGated, caller must have a Soul Engine
     *         community-member attestation. If a fee is set, it goes to treasury.
     */
    function join() external payable {
        require(!members[msg.sender].active, "Community: already member");
        require(msg.value >= membershipFee,  "Community: insufficient fee");

        if (soulGatedMembership) {
            _requireAttestation(msg.sender, CLAIM_COMMUNITY_MEMBER);
        }

        _addMember(msg.sender);
        emit MemberJoined(msg.sender, msg.value);

        if (msg.value > membershipFee) {
            // Refund overpayment.
            (bool sent,) = payable(msg.sender).call{value: msg.value - membershipFee}("");
            require(sent, "Community: refund failed");
        }
    }

    /**
     * @notice Voluntarily leave the community.
     */
    function leave() external onlyMember {
        require(msg.sender != admin, "Community: admin cannot leave");
        _removeMember(msg.sender);
    }

    // -----------------------------------------------------------------------
    // Treasury
    // -----------------------------------------------------------------------

    /**
     * @notice Donate BUCKS to the treasury. Anyone can donate.
     */
    function donate() external payable {
        require(msg.value > 0, "Community: zero donation");
        totalReceived += msg.value;
        emit Donated(msg.sender, msg.value);
    }

    /// @notice Current treasury balance in grain.
    function treasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // -----------------------------------------------------------------------
    // Governance — propose
    // -----------------------------------------------------------------------

    /**
     * @notice Propose a BUCKS transfer from the treasury.
     */
    function proposeBucksTransfer(
        address target,
        uint256 amount,
        string calldata desc
    ) external onlyMember returns (uint256) {
        require(target != address(0),       "Community: zero target");
        require(amount > 0,                 "Community: zero amount");
        require(amount <= address(this).balance, "Community: insufficient treasury");
        return _createProposal(ProposalType.BUCKS_TRANSFER, target, amount, bytes32(0), 0, desc);
    }

    /**
     * @notice Propose to remove a member.
     */
    function proposeMemberRemoval(address member, string calldata desc)
        external
        onlyMember
        returns (uint256)
    {
        require(members[member].active, "Community: not a member");
        require(member != admin,        "Community: cannot remove admin");
        return _createProposal(ProposalType.MEMBER_REMOVE, member, 0, bytes32(0), 0, desc);
    }

    /**
     * @notice Propose a governance parameter update.
     * @param paramKey   One of: keccak256("votingPeriod"), keccak256("quorumBps"),
     *                            keccak256("membershipFee").
     */
    function proposeParamUpdate(
        bytes32 paramKey,
        uint256 newValue,
        string calldata desc
    ) external onlyMember returns (uint256) {
        return _createProposal(ProposalType.PARAM_UPDATE, address(0), 0, paramKey, newValue, desc);
    }

    // -----------------------------------------------------------------------
    // Governance — vote
    // -----------------------------------------------------------------------

    /**
     * @notice Cast a vote on a proposal.
     * @param id      Proposal ID.
     * @param support True = yes, false = no.
     */
    function vote(uint256 id, bool support) external onlyMember {
        Proposal storage p = proposals[id];
        require(p.status == ProposalStatus.Active, "Community: not active");
        require(block.timestamp <= p.votingEnds,   "Community: voting ended");
        require(!hasVoted[id][msg.sender],         "Community: already voted");

        hasVoted[id][msg.sender] = true;

        if (support) {
            p.yesVotes += members[msg.sender].votingWeight;
        } else {
            p.noVotes  += members[msg.sender].votingWeight;
        }

        emit VoteCast(id, msg.sender, support);
    }

    // -----------------------------------------------------------------------
    // Governance — execute
    // -----------------------------------------------------------------------

    /**
     * @notice Execute a passed proposal.
     *         Anyone can call this after the voting period ends and quorum is met.
     */
    function execute(uint256 id) external {
        Proposal storage p = proposals[id];
        require(p.status == ProposalStatus.Active, "Community: not active");
        require(block.timestamp > p.votingEnds,    "Community: voting ongoing");

        uint256 quorumVotes = (memberCount * quorumBps) / 10_000;
        bool    quorumMet   = p.yesVotes >= quorumVotes;
        bool    majorityYes = p.yesVotes > p.noVotes;

        if (!quorumMet || !majorityYes) {
            p.status = ProposalStatus.Rejected;
            emit ProposalRejected(id);
            return;
        }

        p.status = ProposalStatus.Executed;

        if (p.kind == ProposalType.BUCKS_TRANSFER) {
            require(p.amount <= address(this).balance, "Community: treasury insufficient");
            (bool sent,) = payable(p.target).call{value: p.amount}("");
            require(sent, "Community: transfer failed");

        } else if (p.kind == ProposalType.MEMBER_REMOVE) {
            if (members[p.target].active) {
                _removeMember(p.target);
                emit MemberRemoved(p.target, address(this));
            }

        } else if (p.kind == ProposalType.PARAM_UPDATE) {
            _applyParamUpdate(p.paramKey, p.paramValue);
        }

        emit ProposalExecuted(id);
    }

    /**
     * @notice Admin can cancel a proposal before voting ends.
     */
    function cancelProposal(uint256 id) external onlyAdmin {
        Proposal storage p = proposals[id];
        require(p.status == ProposalStatus.Active, "Community: not active");
        p.status = ProposalStatus.Cancelled;
        emit ProposalCancelled(id);
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    /// @notice Transfer community admin role.
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0),       "Community: zero admin");
        require(members[newAdmin].active,     "Community: not a member");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Admin can toggle Soul Engine gating after deployment.
    function setSoulGated(bool gated) external onlyAdmin {
        soulGatedMembership = gated;
    }

    /// @notice Admin can update the Soul Engine address.
    function setSoulEngine(address newEngine) external onlyAdmin {
        _setSoulEngine(newEngine);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function totalProposals() external view returns (uint256) { return _nextProposalId; }

    function isMember(address addr) external view returns (bool) {
        return members[addr].active;
    }

    function memberAtIndex(uint256 idx) external view returns (address) {
        return _memberList[idx];
    }

    function currentQuorumVotes() external view returns (uint256) {
        return (memberCount * quorumBps) / 10_000;
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _addMember(address addr) internal {
        members[addr] = Member({ active: true, joinedAt: block.timestamp, votingWeight: 1 });
        _memberList.push(addr);
        memberCount++;
    }

    function _removeMember(address addr) internal {
        members[addr].active       = false;
        members[addr].votingWeight = 0;
        memberCount--;
    }

    function _createProposal(
        ProposalType kind,
        address      target,
        uint256      amount,
        bytes32      paramKey,
        uint256      paramValue,
        string calldata desc
    ) internal returns (uint256 id) {
        id = _nextProposalId++;

        proposals[id] = Proposal({
            id:          id,
            proposer:    msg.sender,
            kind:        kind,
            target:      target,
            amount:      amount,
            paramKey:    paramKey,
            paramValue:  paramValue,
            description: desc,
            votingEnds:  block.timestamp + votingPeriod,
            yesVotes:    0,
            noVotes:     0,
            status:      ProposalStatus.Active
        });

        emit ProposalCreated(id, msg.sender, kind);
    }

    function _applyParamUpdate(bytes32 key, uint256 value) internal {
        if (key == keccak256("votingPeriod")) {
            require(value >= 1 hours, "Community: voting period too short");
            votingPeriod = value;
        } else if (key == keccak256("quorumBps")) {
            require(value <= 10_000, "Community: quorum > 100%");
            quorumBps = value;
        } else if (key == keccak256("membershipFee")) {
            membershipFee = value;
        } else {
            revert("Community: unknown param");
        }
        emit ParamUpdated(key, value);
    }

    // -----------------------------------------------------------------------
    // Receive — accept plain donations
    // -----------------------------------------------------------------------

    receive() external payable {
        totalReceived += msg.value;
        emit Donated(msg.sender, msg.value);
    }
}
