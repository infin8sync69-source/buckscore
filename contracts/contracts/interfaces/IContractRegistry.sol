// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IContractRegistry
 * @notice Interface for the on-chain Bucks protocol contract registry.
 *         Allows any contract or off-chain tool to resolve protocol
 *         component addresses by name without hard-coding them.
 */
interface IContractRegistry {
    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event ContractRegistered(
        bytes32 indexed key,
        address indexed addr,
        string  meta
    );

    event ContractUpdated(
        bytes32 indexed key,
        address indexed oldAddr,
        address indexed newAddr
    );

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    // -----------------------------------------------------------------------
    // Write (owner-only)
    // -----------------------------------------------------------------------

    /**
     * @notice Register or update a contract address.
     * @param key   keccak256 of the contract name, e.g. keccak256("BucksEscrow").
     * @param addr  Deployed contract address.
     * @param meta  Arbitrary metadata string (version, ABI hash, etc.).
     */
    function register(bytes32 key, address addr, string calldata meta) external;

    /**
     * @notice Convenience wrapper: register by plain-text name.
     * @dev    Internally hashes the name with keccak256.
     */
    function registerByName(string calldata name, address addr, string calldata meta) external;

    /// @notice Transfer registry ownership.
    function transferOwnership(address newOwner) external;

    // -----------------------------------------------------------------------
    // Read
    // -----------------------------------------------------------------------

    /// @notice Look up a contract address by pre-hashed key.
    function lookup(bytes32 key) external view returns (address);

    /// @notice Look up a contract address by plain-text name.
    function lookupByName(string calldata name) external view returns (address);

    /// @notice Returns the registry owner address.
    function owner() external view returns (address);
}
