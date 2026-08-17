# Bucks Super App — Smart Contract Implementation Plan
> Master reference document · Chain ID 8192 · Native coin: BUCKS

---

## Table of Contents
1. [BUCKS Token Standard](#1-bucks-token-standard)
2. [Decentralized Identity & Profile System](#2-decentralized-identity--profile-system)
3. [Marketplace Contracts](#3-marketplace-contracts)
4. [Security Architecture](#4-security-architecture)
5. [Contract Architecture Diagram](#5-contract-architecture-diagram)
6. [Implementation Roadmap](#6-implementation-roadmap)
7. [Browser UX Integration Hooks](#7-browser-ux-integration-hooks)

---

## 1. BUCKS Token Standard

### 1.1 Native Coin vs Wrapped Token

| | Native BUCKS | Wrapped WBUCKS (ERC-20) |
|---|---|---|
| Used for | Gas fees, block rewards, PoW mining payouts | DeFi composability, DEX trading, multi-token contracts |
| Contract | No contract — protocol-level | `WrappedBucks.sol` |
| Transfer | `msg.value` / `address.transfer()` | `transfer()` / `transferFrom()` |
| When to use | Paying for transactions, staking in node validator, miner rewards | Marketplace listings, escrow pools, liquidity pairs, DAO treasuries |

Rule: all marketplace and profile contracts accept native BUCKS (via `payable`). WBUCKS is available for advanced integrations. The two are always 1:1 convertible via the wrap/unwrap contract.

### 1.2 Token Economics

```
Total supply:     21,000,000 BUCKS  (Bitcoin-style geometric halving: 50 × 210,000 × 2)
Block reward:     50 BUCKS (genesis)
Halving interval: Every 210,000 blocks (~4 years at 1 block/min)
Minimum unit:     1 grain = 10^-18 BUCKS (same as wei)
Gold denomination: 1 BUCKS = the classical gold standard weight (mithqal)
```

Halving schedule:
| Era | Block range | Reward |
|---|---|---|
| 1 | 0 – 210,000 | 50 BUCKS |
| 2 | 210,001 – 420,000 | 25 BUCKS |
| 3 | 420,001 – 630,000 | 12.5 BUCKS |
| 4 | 630,001 – 840,000 | 6.25 BUCKS |

### 1.3 Token Utility

- **Gas**: every on-chain transaction burns a small BUCKS fee (EIP-1559 style base fee)
- **Staking**: node operators and community validators stake BUCKS to participate in governance
- **Marketplace fees**: 0.5–1% of each escrow transaction sent to the Protocol Treasury
- **Governance weight**: 1 staked BUCKS = 1 vote in on-chain proposals
- **Publisher staking**: App Store publishers stake BUCKS; slashed on malware detection
- **Profile bonding**: users bond BUCKS to unlock advanced profile tiers

### 1.4 WBUCKS Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWrappedBucks {
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    /// @notice Wrap native BUCKS → WBUCKS (1:1)
    function deposit() external payable;

    /// @notice Unwrap WBUCKS → native BUCKS (1:1)
    function withdraw(uint256 wad) external;

    function totalSupply() external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function transfer(address dst, uint256 wad) external returns (bool);
    function transferFrom(address src, address dst, uint256 wad) external returns (bool);
    function approve(address spender, uint256 wad) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}
```

---

## 2. Decentralized Identity & Profile System

### 2.1 Profile Hierarchy

```
GlobalProfile (1 per wallet address — root identity)
│
├── PersonalProfile
│     name (hashed), avatar CID, bio, location hash, reputation score
│
├── BusinessProfile
│     legal name hash, registration hash, category, verified claim, service listings
│
├── SkillsetProfile
│     skills[], certifications[], portfolio CIDs[], endorsements[]
│
├── AssetRegistry
│     ├── VehicleAsset[]    (make/model, VIN hash, ownership proof, transfer log)
│     ├── PropertyAsset[]   (location hash, title hash, valuation, tenancy status)
│     └── DigitalAsset[]    (CID, provenance chain, royalty %)
│
└── GroupMembership[]
      community address, role, join timestamp, contribution score
```

### 2.2 GlobalProfile Contract

```solidity
interface IGlobalProfile {
    struct Profile {
        address owner;
        uint256 createdAt;
        uint256 reputationScore;   // 0–10000 basis points
        bool soulEngineVerified;   // attested by the 114-layer resonance architecture
        bytes32 metaCID;           // IPFS CID of off-chain profile data (encrypted)
        uint8 tier;                // 0=Basic 1=Verified 2=Premium 3=Enterprise
    }

    event ProfileCreated(address indexed owner, uint256 timestamp);
    event ProfileUpdated(address indexed owner, bytes32 newMetaCID);
    event TierUpgraded(address indexed owner, uint8 newTier);
    event ReputationUpdated(address indexed owner, uint256 oldScore, uint256 newScore);

    /// @notice Create root profile — one per address
    function createProfile(bytes32 metaCID) external payable;

    /// @notice Update off-chain metadata CID
    function updateMeta(bytes32 newMetaCID) external;

    /// @notice Soul Engine oracle writes verified status
    function setVerified(address owner, bool verified) external; // onlySoulEngine

    /// @notice Called by marketplace/reputation contracts to adjust score
    function adjustReputation(address owner, int256 delta) external; // onlyAuthorized

    function getProfile(address owner) external view returns (Profile memory);
    function exists(address owner) external view returns (bool);
    function reputationOf(address owner) external view returns (uint256);
}
```

**Privacy model:**
- Name, avatar, bio → stored as IPFS CID (`metaCID`) — encrypted with owner's public key
- Reputation score → fully public (on-chain)
- Soul Engine verification status → public boolean
- Wallet address → pseudonymous; linkage to real identity is owner's choice

### 2.3 BusinessProfile Contract

```solidity
interface IBusinessProfile {
    struct Business {
        address owner;
        bytes32 legalNameHash;       // keccak256(legal name) — privacy preserving
        bytes32 registrationHash;    // keccak256(registration number)
        string category;             // "construction", "tech", "retail", etc.
        bool businessVerified;       // Soul Engine business attestation
        uint256 stakedBucks;         // bonded stake — slashed on fraud
        bytes32 metaCID;             // Full business data CID (IPFS, encrypted)
    }

    event BusinessCreated(address indexed owner, bytes32 legalNameHash);
    event BusinessVerified(address indexed owner);
    event StakeSlashed(address indexed owner, uint256 amount, string reason);

    function createBusiness(
        bytes32 legalNameHash,
        bytes32 registrationHash,
        string calldata category,
        bytes32 metaCID
    ) external payable; // msg.value = required stake

    function verifyBusiness(address owner) external; // onlySoulEngine
    function slashStake(address owner, uint256 amount, string calldata reason) external; // onlyGov
    function getBusiness(address owner) external view returns (Business memory);
}
```

### 2.4 SkillsetProfile Contract

```solidity
interface ISkillsetProfile {
    struct Skill {
        string name;
        uint8 level;           // 1–5
        bytes32 certCID;       // IPFS CID of certification doc
        bool endorsed;         // >= 3 peer endorsements
        uint256 endorsements;
    }

    event SkillAdded(address indexed owner, string skill);
    event SkillEndorsed(address indexed skill_owner, address indexed endorser, string skill);

    function addSkill(string calldata name, uint8 level, bytes32 certCID) external;
    function endorseSkill(address skillOwner, string calldata skill) external;
    function getSkills(address owner) external view returns (Skill[] memory);
    function getEndorsementCount(address owner, string calldata skill) external view returns (uint256);
}
```

### 2.5 Asset Registry Contracts

```solidity
interface IAssetRegistry {

    // --- Vehicles ---
    struct VehicleAsset {
        uint256 tokenId;
        address owner;
        bytes32 vinHash;          // keccak256(VIN) — not public
        bytes32 makemodelHash;    // keccak256(make+model+year)
        bytes32 titleCID;         // encrypted ownership document on IPFS
        uint256 registeredAt;
        bool forSale;
        uint256 askPrice;         // in grains (BUCKS × 10^18)
    }

    // --- Properties ---
    struct PropertyAsset {
        uint256 tokenId;
        address owner;
        bytes32 locationHash;     // keccak256(coordinates or address)
        bytes32 titleCID;
        uint256 valuation;        // in grains
        bool tenanted;
        address tenant;
        uint256 leaseExpiry;
    }

    // --- Digital Assets ---
    struct DigitalAsset {
        uint256 tokenId;
        address creator;
        address owner;
        bytes32 contentCID;       // IPFS CID of the asset
        uint256 royaltyBps;       // basis points paid to creator on each transfer
        bytes32 provenanceRoot;   // Merkle root of transfer history
    }

    event AssetMinted(uint256 indexed tokenId, address indexed owner, string assetType);
    event AssetTransferred(uint256 indexed tokenId, address indexed from, address indexed to);
    event AssetListedForSale(uint256 indexed tokenId, uint256 price);

    function mintVehicle(bytes32 vinHash, bytes32 makemodelHash, bytes32 titleCID) external returns (uint256);
    function mintProperty(bytes32 locationHash, bytes32 titleCID, uint256 valuation) external returns (uint256);
    function mintDigital(bytes32 contentCID, uint256 royaltyBps) external returns (uint256);
    function transferAsset(uint256 tokenId, address to) external payable; // handles royalties
    function listForSale(uint256 tokenId, uint256 price) external;
}
```

### 2.6 Reputation Score Engine

Reputation is a composite on-chain score (0–10,000 basis points):

| Signal | Weight | Source |
|---|---|---|
| Completed trades (no disputes) | 30% | Marketplace contracts |
| Peer endorsements | 20% | SkillsetProfile |
| Soul Engine verification tier | 20% | ISoulEngine attestation |
| Staked BUCKS duration | 15% | Staking contract |
| Community governance participation | 15% | CommunityTreasury |

Score is updated by authorized contracts only (no direct user writes). Starts at 5,000 (neutral). Negative events (disputes lost, slashed stake) reduce it; positive events increase it.

---

## 3. Marketplace Contracts

### 3.1 Core Marketplace Architecture

```
MarketplaceRouter (entry point — routes to correct contract pair)
├── ListingRegistry    — all active listings indexed by entity type
├── OfferEngine        — bid/offer/counter-offer state machine
├── EscrowVault        — holds funds during all active contracts
├── DisputeArbitration — dispute filing, evidence, ruling
└── ReputationOracle   — writes post-trade scores to GlobalProfile
```

### 3.2 Contract Types by Entity Pair

#### User ↔ User (P2P)
**Use cases**: freelance work, direct payment, peer lending, item sale

```solidity
interface IUserUserAgreement {
    enum State { Open, Accepted, InProgress, Completed, Disputed, Cancelled }

    struct Agreement {
        address party_a;      // initiator
        address party_b;      // counterparty
        uint256 value;        // locked BUCKS in grains
        bytes32 termsCID;     // IPFS CID of agreement terms (signed by both)
        uint256 deadline;
        State state;
        uint256 createdAt;
    }

    event AgreementCreated(uint256 id, address a, address b, uint256 value);
    event AgreementAccepted(uint256 id, address b);
    event AgreementCompleted(uint256 id);
    event DisputeRaised(uint256 id, address by);

    function propose(address counterparty, bytes32 termsCID, uint256 deadline)
        external payable returns (uint256 agreementId);
    function accept(uint256 id) external payable;  // party_b locks matching bond
    function complete(uint256 id) external;         // both parties confirm
    function raiseDispute(uint256 id, bytes32 evidenceCID) external;
    function cancel(uint256 id) external;           // only before acceptance
}
```

**Security controls**: both parties must lock funds; unilateral cancellation blocked after acceptance; Soul Engine verification recommended (not required) for P2P above 100 BUCKS.

#### User ↔ Business
**Use cases**: hire a service, purchase a product, gig work engagement

Flow: Business lists service → User places offer → Business accepts → Escrow locks User payment → Business delivers → User confirms OR disputes → funds released / arbitrated.

Additional controls:
- Business must have `businessVerified = true` for orders above 500 BUCKS
- Service listings include SLA: delivery deadline, refund policy hash
- Auto-release after 7 days of no dispute if delivery marked complete by business

#### User ↔ Community
**Use cases**: community membership, content contribution bounty, governance participation

Flow: Community creates membership offer on-chain → User applies → Community DAO votes approval → User bonds entry stake → Membership NFT minted (soulbound) → User gains voting rights and can earn contribution rewards.

Controls: entry stake returned on graceful exit; slashed on governance violations; Soul Engine attestation required for communities above 100 members.

#### Business ↔ Business
**Use cases**: supply chain contract, SLA, joint venture, white-label agreement

```solidity
interface IBusinessAgreementV2 {
    struct Milestone {
        string description;
        bytes32 deliverablerCID;
        uint256 payment;         // grains
        uint256 deadline;
        bool submitted;
        bool approved;
        bool disputed;
    }

    struct B2BAgreement {
        address client;          // paying business
        address provider;        // delivering business
        Milestone[] milestones;
        uint256 totalValue;
        uint256 protocolFeeBps;  // 100 = 1%
        bytes32 contractCID;     // full legal terms on IPFS
        bool requiresBothSoulVerified;
    }
}
```

Both parties must have BusinessProfile + staked BUCKS. Disputes escalate to Arbitration DAO (elected body) not individual arbiter.

#### Business ↔ Group
**Use cases**: bulk purchase agreement, community supply deal, collective service contract

Flow: Group (CommunityTreasury) votes to authorize contract → Treasurer (multisig) co-signs → Business delivers to group → Treasury releases payment.

Control: requires CommunityTreasury governance vote (quorum 51%) before any payment release.

#### Group ↔ Group
**Use cases**: inter-community alliance, shared resource agreement, joint governance

Flow: Both treasuries vote independently → AllianceAgreement contract deployed with both treasury addresses as co-owners → shared governance over agreement execution → mutual exit clause.

### 3.3 DisputeArbitration Contract

```solidity
interface IDisputeArbitration {
    enum Ruling { Pending, FavorClaimant, FavorRespondent, Split }

    struct Dispute {
        uint256 contractId;
        address claimant;
        address respondent;
        bytes32 claimantEvidenceCID;
        bytes32 respondentEvidenceCID;
        address arbiter;          // selected from ArbiterRegistry
        uint256 filedAt;
        uint256 rulingDeadline;   // arbiter must rule within 7 days
        Ruling ruling;
        uint256 splitBps;         // if Split, claimant gets this % of locked funds
    }

    event DisputeFiled(uint256 indexed disputeId, uint256 contractId, address claimant);
    event EvidenceSubmitted(uint256 indexed disputeId, address by, bytes32 evidenceCID);
    event ArbiterAssigned(uint256 indexed disputeId, address arbiter);
    event RulingIssued(uint256 indexed disputeId, Ruling ruling);

    function fileDispute(uint256 contractId, bytes32 evidenceCID) external;
    function submitEvidence(uint256 disputeId, bytes32 evidenceCID) external;
    function assignArbiter(uint256 disputeId) external; // chainlink VRF or rotation
    function issueRuling(uint256 disputeId, Ruling ruling, uint256 splitBps) external; // onlyArbiter
    function escalateToDAO(uint256 disputeId) external; // if arbiter fails to rule in time
}
```

Arbiter selection: arbiter must have reputation ≥ 7,500, staked ≥ 1,000 BUCKS, and Soul Engine verified. Selected by weighted random from ArbiterRegistry.

---

## 4. Security Architecture

### 4.1 Reentrancy

All value-holding contracts implement the Checks-Effects-Interactions (CEI) pattern:

```solidity
// WRONG — vulnerable
function release(uint256 id) external {
    require(agreements[id].state == State.Completed);
    payable(agreements[id].party_b).transfer(agreements[id].value); // external call FIRST
    agreements[id].state = State.Closed; // state update AFTER — reentrancy window
}

// CORRECT — CEI + ReentrancyGuard
function release(uint256 id) external nonReentrant {
    Agreement storage a = agreements[id];
    require(a.state == State.Completed);           // CHECK
    a.state = State.Closed;                        // EFFECT (state change first)
    uint256 amount = a.value;
    a.value = 0;
    (bool ok,) = payable(a.party_b).call{value: amount}(""); // INTERACTION last
    require(ok, "Transfer failed");
}
```

`ReentrancyGuard` (OpenZeppelin) is inherited by: EscrowVault, BucksTransfer, BucksEscrow, CommunityTreasury, BusinessAgreement, AssetRegistry.

### 4.2 Access Control Role Hierarchy

```
DEFAULT_ADMIN_ROLE  (5/9 multisig — Gnosis Safe equivalent on Bucks chain)
├── GOVERNOR_ROLE       (DAO — time-locked 48h)
│   ├── PAUSER_ROLE     (emergency circuit breaker — 3/5 multisig, no timelock)
│   ├── UPGRADER_ROLE   (UUPS upgrade authority — 7-day timelock)
│   └── TREASURY_ROLE   (fee withdrawal — 48h timelock)
├── SOUL_ENGINE_ROLE    (oracle writes — Soul Engine node address)
├── ARBITER_ROLE        (dispute ruling — registered arbiters only)
└── MARKETPLACE_ROLE    (reputation writes from marketplace contracts)
```

All roles managed by `AccessControlEnumerable`. No single EOA holds `DEFAULT_ADMIN_ROLE` — it is always a multisig.

### 4.3 Oracle Security (Soul Engine)

The Soul Engine oracle (114-layer resonance architecture) provides identity attestations and alignment scores. Attack vectors and mitigations:

| Attack | Mitigation |
|---|---|
| Oracle node compromise | Multi-oracle consensus (3-of-5 Soul Engine nodes must agree) |
| Staleness | `attestedAt` timestamp; attestations expire after 30 days |
| Replay attack | Nonce per attestation; on-chain nonce registry |
| Manipulation of alignment score | Score is a range (0–1000), not binary; contracts use thresholds not exact values |
| Front-running oracle update | Commit-reveal: submit hash of attestation, then reveal after 1 block |

```solidity
interface ISoulEngine {
    struct Attestation {
        address subject;
        bytes32 claimType;
        bool verified;
        uint256 confidence;   // 0–1000
        uint256 attestedAt;
        uint256 expiresAt;
        uint256 nonce;
        bytes signature;      // multi-sig from oracle quorum
    }

    function attest(address subject, bytes32 claimType) external returns (Attestation memory);
    function getAttestation(address subject, bytes32 claimType) external view returns (Attestation memory);
    function isValid(address subject, bytes32 claimType) external view returns (bool);
    function architectureVersion() external pure returns (string memory); // "114-layer resonance architecture"
}
```

### 4.4 Front-Running Prevention

Used in: bid submission, governance votes, arbiter selection.

Commit-reveal pattern:
```solidity
// Phase 1: commit (before deadline)
function commitBid(uint256 listingId, bytes32 commitment) external {
    // commitment = keccak256(abi.encodePacked(bidAmount, salt, msg.sender))
    commitments[listingId][msg.sender] = Commit({ hash: commitment, block: block.number });
}

// Phase 2: reveal (after commit period closes)
function revealBid(uint256 listingId, uint256 bidAmount, bytes32 salt) external payable {
    Commit storage c = commitments[listingId][msg.sender];
    require(block.number > c.block + COMMIT_WINDOW, "Too early");
    require(keccak256(abi.encodePacked(bidAmount, salt, msg.sender)) == c.hash, "Invalid reveal");
    require(msg.value == bidAmount, "Value mismatch");
    // register bid
}
```

### 4.5 Sybil Resistance

High-value actions require Soul Engine verification:

| Action | Minimum requirement |
|---|---|
| Create profile (basic) | Wallet with ≥ 1 tx history |
| List a service | Soul Engine PersonalProfile attestation |
| Business listing | Soul Engine BusinessProfile attestation + staked BUCKS |
| Arbiter registration | Reputation ≥ 7,500, staked ≥ 1,000 BUCKS, Soul verified |
| Governance voting | Staked BUCKS, minimum 30-day lock |
| High-value escrow (>1,000 BUCKS) | Both parties Soul verified |

### 4.6 Upgradability — UUPS Proxy Pattern

All core contracts use UUPS (EIP-1822) with OpenZeppelin `UUPSUpgradeable`:

```solidity
contract GlobalProfile is
    Initializable,
    UUPSUpgradeable,
    AccessControlEnumerableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin, address soulEngine) public initializer {
        __UUPSUpgradeable_init();
        __AccessControlEnumerable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SOUL_ENGINE_ROLE, soulEngine);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
```

Storage layout is append-only (never reorder or delete slots). A `StorageV2` gap is reserved in every contract (`uint256[50] private __gap;`).

Upgrade process: UPGRADER_ROLE submits upgrade proposal → 7-day timelock → DAO can veto → upgrade executes.

### 4.7 Emergency Controls

Every value-holding contract inherits `PausableUpgradeable`. Pause authority: `PAUSER_ROLE` (3/5 multisig, no timelock — emergency use only).

Circuit breakers:
- Auto-pause if single-block outflow exceeds 10,000 BUCKS from EscrowVault
- Auto-pause if oracle attestation fails for > 1 hour
- Manual pause by PAUSER_ROLE with emitted event and reason string

### 4.8 Time-Lock Schedule

| Action | Delay |
|---|---|
| Protocol fee change | 48 hours |
| Dispute window change | 48 hours |
| New role grant | 48 hours |
| Contract upgrade | 7 days |
| Treasury withdrawal | 48 hours |
| Slash parameter change | 7 days |

### 4.9 Pre-Mainnet Audit Checklist

- [ ] All `external`/`public` functions that modify state require appropriate role or ownership check
- [ ] No `tx.origin` used for authorization (use `msg.sender` only)
- [ ] No unchecked low-level `call()` — all return values checked
- [ ] CEI pattern followed in 100% of functions that make external calls after state changes
- [ ] `ReentrancyGuard` on all functions handling ETH/BUCKS transfers
- [ ] `Pausable` on all value-holding contracts
- [ ] UUPS `_authorizeUpgrade` has correct role check
- [ ] No `selfdestruct` (deprecated in EIP-6049)
- [ ] All integers use Solidity 0.8+ (built-in overflow protection); no unsafe casting
- [ ] Front-running protection on all auction/bid flows
- [ ] Oracle staleness check on every `attest()` read
- [ ] Multisig confirmed on `DEFAULT_ADMIN_ROLE` before deployment
- [ ] Time-lock confirmed on all admin parameter changes
- [ ] Emergency pause tested on testnet
- [ ] 95%+ test coverage (line and branch) via `solidity-coverage`
- [ ] Gas optimization: no unbounded loops; array operations are O(1) where possible
- [ ] Events emitted for every state change (for off-chain indexing)
- [ ] NatSpec documentation on all external functions
- [ ] Static analysis: Slither + Mythril run with zero high-severity findings
- [ ] Fuzzing: Echidna invariant tests for escrow balance invariants
- [ ] External audit by reputable firm before mainnet

---

## 5. Contract Architecture Diagram

```
                          ┌─────────────────────────────────┐
                          │        ISoulEngine (Oracle)      │
                          │  114-layer resonance architecture │
                          └────────────┬────────────────────┘
                                       │ attestations
                    ┌──────────────────▼──────────────────────┐
                    │              GlobalProfile               │
                    │   (root identity — 1 per wallet)         │
                    └──┬──────┬────────┬───────────┬──────────┘
                       │      │        │           │
            ┌──────────▼┐  ┌──▼──────┐ │  ┌───────▼──────┐
            │ Business  │  │Skillset │ │  │AssetRegistry │
            │ Profile   │  │Profile  │ │  │Veh/Prop/Dig  │
            └──────────┬┘  └─────────┘ │  └──────────────┘
                       │               │
                       │    ┌──────────▼──────────┐
                       │    │   GroupMembership    │
                       │    │  (CommunityTreasury) │
                       │    └──────────────────────┘
                       │
          ┌────────────▼─────────────────────────────────────┐
          │                 MarketplaceRouter                  │
          └───┬──────────────┬───────────────┬───────────────┘
              │              │               │
    ┌─────────▼──┐  ┌────────▼───┐  ┌───────▼──────────────┐
    │  Listing   │  │OfferEngine │  │     EscrowVault        │
    │  Registry  │  │commit/rev  │  │  (holds all funds)    │
    └─────────┬──┘  └────────┬───┘  └───────┬──────────────┘
              │              │               │
              └──────────────▼───────────────▼
                      ┌──────────────────────────┐
                      │    DisputeArbitration     │
                      │  ArbiterRegistry · DAO   │
                      └──────────────────────────┘
                                  │
                      ┌───────────▼──────────────┐
                      │    ReputationOracle       │
                      │ writes back to Global-   │
                      │ Profile.reputationScore  │
                      └──────────────────────────┘

Contract Registry (ContractRegistry.sol)
  ┌──────────────────────────────────────────────────────┐
  │  name → address map for all deployed contracts above │
  │  owned by DAO multisig, upgradeable via timelock     │
  └──────────────────────────────────────────────────────┘

WBUCKS (WrappedBucks.sol)
  ┌────────────────────────────────────────┐
  │  wrap native BUCKS ↔ ERC-20 WBUCKS    │
  │  used by DeFi integrations             │
  └────────────────────────────────────────┘
```

---

## 6. Implementation Roadmap

### Phase A — Token + Core Identity (Months 1–2)
**Contracts:** `WrappedBucks`, `GlobalProfile`, `PersonalProfile`, `SoulVerified` base, `ContractRegistry` (v2)

**Tasks:**
- Deploy to Bucks testnet (internal)
- Write 100% unit tests for profile CRUD + reputation scoring
- Fuzz EscrowVault balance invariants with Echidna
- Confirm UUPS upgrade cycle works on testnet
- Multisig setup for DEFAULT_ADMIN_ROLE

**Security gate:** Slither + Mythril clean. Manual review of access control matrix.

---

### Phase B — Business Profiles + Marketplace + Escrow (Months 3–4)
**Contracts:** `BusinessProfile`, `SkillsetProfile`, `ListingRegistry`, `OfferEngine`, `EscrowVault`, `UserUserAgreement`, `UserBusinessAgreement`

**Tasks:**
- Deploy to public Bucks testnet
- Open beta for marketplace testing (invited users)
- Commit-reveal auction integration tests
- Stress test EscrowVault with 1,000 concurrent agreements
- Circuit breaker drill: trigger auto-pause, verify funds locked, resume

**Security gate:** External audit of EscrowVault + OfferEngine. Penetration test.

---

### Phase C — Asset Registry + Group Contracts + Disputes (Months 5–6)
**Contracts:** `AssetRegistry` (Vehicle/Property/Digital), `GroupMembership`, `BusinessBusinessAgreement`, `BusinessGroupAgreement`, `GroupGroupAgreement`, `DisputeArbitration`, `ArbiterRegistry`, `ReputationOracle`

**Tasks:**
- Arbiter registry seeded with 20 verified arbiters (reputation ≥ 7,500)
- Asset transfer with royalty distribution tested
- DAO governance: propose → timelock → execute cycle tested
- Dispute resolution end-to-end test (file → evidence → ruling → payout)

**Security gate:** Full audit of dispute and asset contracts. Bug bounty opened.

---

### Phase D — Super App Integration + Mainnet (Months 7–8)
**Tasks:**
- Browser wallet integration: all contract interactions exposed via EIP-1193
- Profile UI wired to on-chain data reads
- Marketplace UI: listing creation, offer flow, escrow status tracker
- App Store: AppRegistry.sol deployed; all Bucks apps pinned on IPFS cluster
- Final audit + public report
- Mainnet genesis: deploy all contracts, transfer admin to DAO multisig
- DAO election: first governance vote for parameter ratification

---

## 7. Browser UX Integration Hooks

The Bucks Browser wallet extension must expose these interactions:

| Action | EIP-1193 method | UX flow |
|---|---|---|
| Create profile | `eth_sendTransaction` → GlobalProfile.createProfile() | 3-step wizard: set name → bond stake → confirm tx |
| Verify identity | `bucks_requestAttestation` (custom method) | Opens Soul Engine verification flow in sidebar panel |
| List a service | `eth_sendTransaction` → ListingRegistry.createListing() | Form: title, description, price, deadline → preview → sign |
| Place offer | `eth_sendTransaction` → OfferEngine.submitOffer() | Lock amount shown prominently; commit-reveal timer displayed |
| Sign agreement | `eth_signTypedData_v4` | Both parties shown terms CID → IPFS preview → sign |
| Confirm delivery | `eth_sendTransaction` → EscrowVault.confirmDelivery() | Confirmation modal with payment breakdown |
| File dispute | `eth_sendTransaction` → DisputeArbitration.fileDispute() | Evidence upload (→ IPFS) → CID attached to transaction |
| Vote in DAO | `eth_sendTransaction` → CommunityTreasury.vote() | Show proposal text (from IPFS CID), vote For/Against/Abstain |
| Transfer asset | `eth_sendTransaction` → AssetRegistry.transferAsset() | Show royalty deduction, new owner address, confirmation |

All transaction previews must show: estimated gas (in BUCKS), locked/unlocked amount, Soul Engine verification status of counterparty, and reputation score of counterparty before user signs.

---

*Document version 1.0 — Bucks Super App Smart Contract Implementation Plan*  
*Chain ID: 8192 · Native coin: BUCKS · Architecture: 114-layer resonance architecture*
