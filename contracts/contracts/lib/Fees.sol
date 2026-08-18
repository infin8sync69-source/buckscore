// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Fees
 * @notice Shared basis-point fee arithmetic, extracted from the identical
 *         `(amount * feeBps) / 10_000` pattern previously duplicated across
 *         BucksEscrow, BusinessAgreement (x2). Pure function, no state —
 *         behavior is byte-for-byte identical to the inlined arithmetic it
 *         replaces.
 */
library Fees {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Splits `amount` into a protocol fee (at `feeBps` basis points)
    ///         and the remaining payout, using the same denominator (10,000)
    ///         every caller in this codebase already assumed.
    function split(uint256 amount, uint256 feeBps)
        internal
        pure
        returns (uint256 fee, uint256 payout)
    {
        fee = (amount * feeBps) / BPS_DENOMINATOR;
        payout = amount - fee;
    }
}
