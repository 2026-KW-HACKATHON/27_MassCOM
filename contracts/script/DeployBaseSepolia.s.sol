// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";

import { WolgyeMascot } from "../src/WolgyeMascot.sol";

/// @notice Base Sepolia testnet deployment. The broadcaster comes from an encrypted keystore
/// (`--account`), so no private key is ever read from the environment or the repository.
contract DeployBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;

    error WrongChain(uint256 actual);
    error RolesMustBeDistinct();

    function run() external returns (WolgyeMascot mascot) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain(block.chainid);
        address admin = vm.envAddress("BASE_SEPOLIA_ADMIN");
        address minter = vm.envAddress("BASE_SEPOLIA_MINTER");
        address pauser = vm.envAddress("BASE_SEPOLIA_PAUSER");
        if (admin == minter || admin == pauser || minter == pauser) revert RolesMustBeDistinct();

        vm.startBroadcast();
        mascot = new WolgyeMascot(admin, minter, pauser);
        vm.stopBroadcast();
    }
}
