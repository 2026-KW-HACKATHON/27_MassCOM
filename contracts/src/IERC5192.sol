// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Minimal Soulbound NFT interface defined by ERC-5192.
interface IERC5192 is IERC165 {
    /// @notice Emitted when an NFT becomes locked.
    event Locked(uint256 tokenId);

    /// @notice Emitted when an NFT becomes unlocked.
    event Unlocked(uint256 tokenId);

    /// @notice Returns true when a token is locked and reverts for a nonexistent token.
    function locked(uint256 tokenId) external view returns (bool);
}
