// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    IERC721Metadata
} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";

import { IERC5192 } from "../src/IERC5192.sol";
import { WolgyeMascot } from "../src/WolgyeMascot.sol";

contract WolgyeMascotTest is Test {
    bytes32 internal constant SERIES = keccak256("merchant-a:campaign-a:goal-1");
    bytes32 internal constant REWARD_KEY = keccak256("test-reward-key-1");

    address internal admin = makeAddr("admin");
    address internal minter = makeAddr("minter");
    address internal pauser = makeAddr("pauser");
    address internal recipient = makeAddr("recipient");
    address internal attacker = makeAddr("attacker");

    WolgyeMascot internal mascot;

    function setUp() public {
        mascot = new WolgyeMascot(admin, minter, pauser);
        vm.startPrank(admin);
        mascot.createSeries(SERIES, "ipfs://bafy-demo/series-1/");
        mascot.activateSeries(SERIES);
        vm.stopPrank();
    }

    function testC01OnlyMinterCanMintAndMinterCannotEscalate() public {
        bytes32 minterRole = mascot.MINTER_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, minterRole
            )
        );
        mascot.mintWithRewardKey(recipient, SERIES, REWARD_KEY);

        bytes32 adminRole = mascot.DEFAULT_ADMIN_ROLE();
        vm.prank(minter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, minter, adminRole
            )
        );
        mascot.grantRole(adminRole, minter);
    }

    function testC01PauserCanStopButOnlyAdminCanResume() public {
        vm.prank(pauser);
        mascot.pause();

        vm.prank(minter);
        vm.expectRevert();
        mascot.mintWithRewardKey(recipient, SERIES, REWARD_KEY);

        bytes32 adminRole = mascot.DEFAULT_ADMIN_ROLE();
        vm.prank(pauser);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, adminRole
            )
        );
        mascot.unpause();

        vm.prank(admin);
        mascot.unpause();
        vm.prank(minter);
        mascot.mintWithRewardKey(recipient, SERIES, REWARD_KEY);
    }

    function testC02RewardKeyIsPermanent() public {
        vm.prank(minter);
        uint256 tokenId = mascot.mintWithRewardKey(recipient, SERIES, REWARD_KEY);
        assertEq(tokenId, 1);
        assertEq(mascot.tokenByRewardKey(REWARD_KEY), tokenId);

        vm.prank(minter);
        vm.expectRevert(
            abi.encodeWithSelector(WolgyeMascot.RewardKeyAlreadyUsed.selector, REWARD_KEY)
        );
        mascot.mintWithRewardKey(attacker, SERIES, REWARD_KEY);
    }

    function testFuzzC02SeriesHasNoSupplyCap(uint8 countSeed) public {
        uint64 count = uint64(bound(countSeed, 1, 64));
        bytes32 seriesId = keccak256(abi.encodePacked("fuzz-series", count));
        vm.startPrank(admin);
        mascot.createSeries(seriesId, "ipfs://bafy-demo/fuzz/");
        mascot.activateSeries(seriesId);
        vm.stopPrank();

        vm.startPrank(minter);
        for (uint64 index = 0; index < count; index++) {
            mascot.mintWithRewardKey(
                recipient, seriesId, keccak256(abi.encodePacked("fuzz-reward", count, index))
            );
        }
        vm.stopPrank();

        (, uint64 everMinted, bool active) = mascot.series(seriesId);
        assertTrue(active);
        assertEq(everMinted, count);
    }

    function testC02RejectsZeroRecipientAndZeroRewardKey() public {
        vm.prank(minter);
        vm.expectRevert(WolgyeMascot.ZeroRecipient.selector);
        mascot.mintWithRewardKey(address(0), SERIES, REWARD_KEY);

        vm.prank(minter);
        vm.expectRevert(WolgyeMascot.ZeroRewardKey.selector);
        mascot.mintWithRewardKey(recipient, SERIES, bytes32(0));
    }

    function testC03AllApprovalAndTransferPathsStayLocked() public {
        vm.prank(minter);
        uint256 tokenId = mascot.mintWithRewardKey(recipient, SERIES, REWARD_KEY);

        vm.startPrank(recipient);
        vm.expectRevert(WolgyeMascot.Soulbound.selector);
        mascot.approve(attacker, tokenId);
        vm.expectRevert(WolgyeMascot.Soulbound.selector);
        mascot.setApprovalForAll(attacker, true);
        vm.expectRevert(WolgyeMascot.Soulbound.selector);
        mascot.transferFrom(recipient, attacker, tokenId);
        vm.expectRevert(WolgyeMascot.Soulbound.selector);
        mascot.safeTransferFrom(recipient, attacker, tokenId);
        vm.expectRevert(WolgyeMascot.Soulbound.selector);
        mascot.safeTransferFrom(recipient, attacker, tokenId, hex"1234");
        vm.stopPrank();

        assertEq(mascot.ownerOf(tokenId), recipient);
        assertTrue(mascot.locked(tokenId));
    }

    function testC04SeriesMustActivateAndCannotBeRecreated() public {
        bytes32 draftSeries = keccak256("draft-series");
        vm.prank(admin);
        mascot.createSeries(draftSeries, "ipfs://bafy-demo/draft/");

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(WolgyeMascot.SeriesNotActive.selector, draftSeries));
        mascot.mintWithRewardKey(recipient, draftSeries, REWARD_KEY);

        vm.startPrank(admin);
        mascot.activateSeries(draftSeries);
        vm.expectRevert(
            abi.encodeWithSelector(WolgyeMascot.SeriesAlreadyExists.selector, draftSeries)
        );
        mascot.createSeries(draftSeries, "ipfs://changed/");
        vm.expectRevert(
            abi.encodeWithSelector(WolgyeMascot.SeriesAlreadyActive.selector, draftSeries)
        );
        mascot.activateSeries(draftSeries);
        vm.stopPrank();
    }

    function testLockedInterfaceMetadataAndMinimalMintEvent() public {
        vm.expectEmit(true, false, false, true);
        emit IERC5192.Locked(1);
        vm.expectEmit(true, true, true, true);
        emit WolgyeMascot.MascotMinted(REWARD_KEY, 1, recipient, SERIES);
        vm.prank(minter);
        uint256 tokenId = mascot.mintWithRewardKey(recipient, SERIES, REWARD_KEY);

        assertTrue(mascot.supportsInterface(type(IERC165).interfaceId));
        assertTrue(mascot.supportsInterface(type(IERC721).interfaceId));
        assertTrue(mascot.supportsInterface(type(IERC721Metadata).interfaceId));
        assertTrue(mascot.supportsInterface(type(IERC5192).interfaceId));
        assertEq(mascot.tokenURI(tokenId), "ipfs://bafy-demo/series-1/1.json");
    }
}
