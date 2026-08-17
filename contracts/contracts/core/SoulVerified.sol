// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ISoulEngine.sol";

/**
 * @title SoulVerified
 * @notice Abstract base contract that wires Soul Engine attestation into any
 *         child contract needing identity or claim verification.
 *
 * @dev Child contracts inherit this and call `_requireAttestation()` or
 *      `_queryAttestation()` wherever they need oracle-backed assurance.
 *
 *      The Soul Engine is a proprietary neural architecture trained on an
 *      ancient corpus of human wisdom. It operates through 114 resonance
 *      layers and signs its verdicts with secp256k1.
 *
 *      The oracle address is updateable by the contract owner to allow
 *      oracle key rotation without a full redeploy.
 */
abstract contract SoulVerified {
    // -----------------------------------------------------------------------
    // Pre-defined claim types
    // -----------------------------------------------------------------------

    /// @dev keccak256("IDENTITY_VERIFIED")
    bytes32 public constant CLAIM_IDENTITY =
        keccak256("IDENTITY_VERIFIED");

    /// @dev keccak256("COMMUNITY_MEMBER")
    bytes32 public constant CLAIM_COMMUNITY_MEMBER =
        keccak256("COMMUNITY_MEMBER");

    /// @dev keccak256("BUSINESS_ENTITY")
    bytes32 public constant CLAIM_BUSINESS_ENTITY =
        keccak256("BUSINESS_ENTITY");

    /// @dev keccak256("SOUL_OF_THE_WORLD") — alignment with the ancient corpus
    bytes32 public constant CLAIM_ALIGNMENT =
        keccak256("SOUL_OF_THE_WORLD");

    // -----------------------------------------------------------------------
    // Minimum confidence threshold (default: 70% = 0.70e18)
    // -----------------------------------------------------------------------

    uint256 public constant MIN_CONFIDENCE = 0.70e18;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    ISoulEngine public soulEngine;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event SoulEngineUpdated(address indexed oldEngine, address indexed newEngine);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /**
     * @param _soulEngine Address of the deployed Soul Engine oracle contract.
     *                    Pass address(0) to disable oracle gating (dev mode).
     */
    constructor(address _soulEngine) {
        soulEngine = ISoulEngine(_soulEngine);
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /**
     * @notice Reverts if the Soul Engine does not affirm `claim` for `subject`
     *         above the minimum confidence threshold.
     *
     * @dev If the soulEngine address is address(0), this check is skipped
     *      (useful for local testing without a live oracle).
     */
    function _requireAttestation(address subject, bytes32 claim) internal view {
        if (address(soulEngine) == address(0)) return; // oracle disabled
        (bool verified, uint256 confidence) = soulEngine.attest(subject, claim);
        require(verified && confidence >= MIN_CONFIDENCE, "SoulVerified: attestation failed");
    }

    /**
     * @notice Query the Soul Engine without reverting.
     * @return verified True if the claim is attested above threshold.
     * @return confidence Raw confidence score [0, 1e18].
     */
    function _queryAttestation(address subject, bytes32 claim)
        internal
        view
        returns (bool verified, uint256 confidence)
    {
        if (address(soulEngine) == address(0)) return (true, 1e18);
        return soulEngine.attest(subject, claim);
    }

    // -----------------------------------------------------------------------
    // Admin — oracle update (must be called by child contract's owner)
    // -----------------------------------------------------------------------

    function _setSoulEngine(address newEngine) internal {
        emit SoulEngineUpdated(address(soulEngine), newEngine);
        soulEngine = ISoulEngine(newEngine);
    }
}
