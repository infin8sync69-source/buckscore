// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IContractRegistry.sol";

/**
 * @title ContractRegistry
 * @notice On-chain registry that maps human-readable contract names to their
 *         deployed addresses. Acts as the single source of truth for the
 *         entire Bucks protocol contract suite.
 *
 * @dev    Only the owner can write entries. Any address can read.
 *         Keys are keccak256 hashes of plain-text names so the registry is
 *         gas-efficient to query while remaining human-readable off-chain.
 *
 *         Standard registered names (register by convention):
 *           "ContractRegistry"    — this contract
 *           "BucksTransfer"       — user↔user transfer agreements
 *           "BucksEscrow"         — conditional escrow
 *           "CommunityTreasury"   — community governance & treasury
 *           "BusinessAgreement"   — business service agreements
 *           "SoulEngine"          — Soul Engine oracle proxy
 */
contract ContractRegistry is IContractRegistry {
    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    address private _owner;

    /// @dev key → deployed address
    mapping(bytes32 => address) private _contracts;

    /// @dev key → metadata string (version, notes)
    mapping(bytes32 => string) private _meta;

    /// @dev Ordered list of all registered keys for enumeration
    bytes32[] private _keys;
    mapping(bytes32 => bool) private _registered;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor() {
        _owner = msg.sender;
    }

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == _owner, "Registry: not owner");
        _;
    }

    modifier validAddress(address addr) {
        require(addr != address(0), "Registry: zero address");
        _;
    }

    // -----------------------------------------------------------------------
    // IContractRegistry — write
    // -----------------------------------------------------------------------

    /// @inheritdoc IContractRegistry
    function register(bytes32 key, address addr, string calldata meta)
        external
        override
        onlyOwner
        validAddress(addr)
    {
        address old = _contracts[key];
        if (old != address(0) && old != addr) {
            emit ContractUpdated(key, old, addr);
        }
        _contracts[key] = addr;
        _meta[key] = meta;

        if (!_registered[key]) {
            _registered[key] = true;
            _keys.push(key);
        }

        emit ContractRegistered(key, addr, meta);
    }

    /// @inheritdoc IContractRegistry
    function registerByName(string calldata name, address addr, string calldata meta)
        external
        override
        onlyOwner
        validAddress(addr)
    {
        bytes32 key = keccak256(bytes(name));
        address old = _contracts[key];
        if (old != address(0) && old != addr) {
            emit ContractUpdated(key, old, addr);
        }
        _contracts[key] = addr;
        _meta[key] = meta;

        if (!_registered[key]) {
            _registered[key] = true;
            _keys.push(key);
        }

        emit ContractRegistered(key, addr, meta);
    }

    /// @inheritdoc IContractRegistry
    function transferOwnership(address newOwner) external override onlyOwner {
        require(newOwner != address(0), "Registry: zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }

    // -----------------------------------------------------------------------
    // IContractRegistry — read
    // -----------------------------------------------------------------------

    /// @inheritdoc IContractRegistry
    function lookup(bytes32 key) external view override returns (address) {
        return _contracts[key];
    }

    /// @inheritdoc IContractRegistry
    function lookupByName(string calldata name) external view override returns (address) {
        return _contracts[keccak256(bytes(name))];
    }

    /// @inheritdoc IContractRegistry
    function owner() external view override returns (address) {
        return _owner;
    }

    // -----------------------------------------------------------------------
    // Enumeration (non-interface helpers)
    // -----------------------------------------------------------------------

    /// @notice Total number of registered entries.
    function totalEntries() external view returns (uint256) {
        return _keys.length;
    }

    /// @notice Return the key and address at a given index.
    function entryAt(uint256 index)
        external
        view
        returns (bytes32 key, address addr, string memory meta)
    {
        require(index < _keys.length, "Registry: index out of bounds");
        key  = _keys[index];
        addr = _contracts[key];
        meta = _meta[key];
    }
}
