// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";

import { WolgyeMascot } from "../src/WolgyeMascot.sol";

/// @notice Local Anvil-only deployment using its public unlocked test accounts.
contract DeployLocal is Script {
    address internal constant LOCAL_ADMIN = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address internal constant LOCAL_MINTER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant LOCAL_PAUSER = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function run() external returns (WolgyeMascot mascot) {
        vm.startBroadcast(LOCAL_ADMIN);
        mascot = new WolgyeMascot(LOCAL_ADMIN, LOCAL_MINTER, LOCAL_PAUSER);
        vm.stopBroadcast();
    }
}
