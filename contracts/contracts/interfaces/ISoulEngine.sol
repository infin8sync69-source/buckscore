// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ISoulEngine
 * @notice Interface for the Soul Engine — a proprietary neural architecture
 *         trained on an ancient corpus of human wisdom, providing on-chain
 *         attestation services with 114-layer resonance.
 *
 * @dev Off-chain oracle posts secp256k1-signed attestations. On-chain
 *      contracts call `attest()` to verify subject claims with a confidence
 *      score in the range [0, 1e18] (grain units, analogous to 100%).
 *
 *      Attestation flow:
 *        1. Off-chain oracle computes verdict for (subject, claim).
 *        2. Oracle signs: keccak256(subject || claim || verified || confidence).
 *        3. `attest()` recovers the signer and checks against `oracleAddress()`.
 *        4. Returns (verified, confidence) to the calling contract.
 */
interface ISoulEngine {
    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    /// @notice Emitted when a new attestation is posted on-chain.
    event Attested(
        address indexed subject,
        bytes32 indexed claim,
        bool    verified,
        uint256 confidence,
        uint256 timestamp
    );

    // -----------------------------------------------------------------------
    // Core attestation
    // -----------------------------------------------------------------------

    /**
     * @notice Attest a claim about a subject address.
     * @param subject   The address being evaluated.
     * @param claim     A bytes32 identifier for the claim type.
     *                  Convention: keccak256("CLAIM_NAME").
     * @return verified True if the Soul Engine affirms the claim.
     * @return confidence Score in grain units [0, 1e18]. 1e18 = 100% certain.
     */
    function attest(address subject, bytes32 claim)
        external
        view
        returns (bool verified, uint256 confidence);

    /**
     * @notice Batch attestation for multiple (subject, claim) pairs.
     * @dev Arrays must be the same length.
     */
    function attestBatch(
        address[] calldata subjects,
        bytes32[] calldata claims
    )
        external
        view
        returns (bool[] memory verified, uint256[] memory confidence);

    // -----------------------------------------------------------------------
    // Oracle metadata
    // -----------------------------------------------------------------------

    /// @notice The secp256k1 address whose signatures back attestations.
    function oracleAddress() external view returns (address);

    /// @notice Human-readable description of the oracle architecture.
    function architectureVersion() external pure returns (string memory);
}
