// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

import { IERC5192 } from "./IERC5192.sol";

/// @title Wolgye Mascot
/// @notice Non-upgradeable, permanently locked NFT collection for fixed visit rewards.
contract WolgyeMascot is ERC721, AccessControl, Pausable, IERC5192 {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct Series {
        string baseTokenURI;
        uint64 maxEverMinted;
        uint64 everMinted;
        bool active;
    }

    error ZeroRoleHolder();
    error ZeroSeriesId();
    error EmptyBaseTokenURI();
    error InvalidSeriesSupply();
    error SeriesAlreadyExists(bytes32 seriesId);
    error SeriesNotFound(bytes32 seriesId);
    error SeriesAlreadyActive(bytes32 seriesId);
    error SeriesNotActive(bytes32 seriesId);
    error SeriesSupplyExceeded(bytes32 seriesId, uint64 maxEverMinted);
    error ZeroRecipient();
    error ZeroRewardKey();
    error RewardKeyAlreadyUsed(bytes32 rewardKey);
    error Soulbound();

    event SeriesCreated(bytes32 indexed seriesId, string baseTokenURI, uint64 maxEverMinted);
    event SeriesActivated(bytes32 indexed seriesId);
    event MascotMinted(
        bytes32 indexed rewardKey,
        uint256 indexed tokenId,
        address indexed recipient,
        bytes32 seriesId
    );

    mapping(bytes32 seriesId => Series) public series;
    mapping(bytes32 rewardKey => uint256 tokenId) public tokenByRewardKey;
    mapping(uint256 tokenId => bytes32 seriesId) public seriesByToken;

    uint256 private _nextTokenId = 1;

    constructor(address admin, address minter, address pauser) ERC721("Wolgye Mascot", "WOLGYE") {
        if (admin == address(0) || minter == address(0) || pauser == address(0)) {
            revert ZeroRoleHolder();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(PAUSER_ROLE, pauser);
    }

    function createSeries(bytes32 seriesId, string calldata baseTokenURI, uint64 maxEverMinted)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (seriesId == bytes32(0)) revert ZeroSeriesId();
        if (bytes(baseTokenURI).length == 0) revert EmptyBaseTokenURI();
        if (maxEverMinted == 0) revert InvalidSeriesSupply();
        if (series[seriesId].maxEverMinted != 0) revert SeriesAlreadyExists(seriesId);

        series[seriesId] = Series({
            baseTokenURI: baseTokenURI, maxEverMinted: maxEverMinted, everMinted: 0, active: false
        });
        emit SeriesCreated(seriesId, baseTokenURI, maxEverMinted);
    }

    function activateSeries(bytes32 seriesId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Series storage selected = series[seriesId];
        if (selected.maxEverMinted == 0) revert SeriesNotFound(seriesId);
        if (selected.active) revert SeriesAlreadyActive(seriesId);
        selected.active = true;
        emit SeriesActivated(seriesId);
    }

    function mintWithRewardKey(address recipient, bytes32 seriesId, bytes32 rewardKey)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
        returns (uint256 tokenId)
    {
        if (recipient == address(0)) revert ZeroRecipient();
        if (rewardKey == bytes32(0)) revert ZeroRewardKey();
        if (tokenByRewardKey[rewardKey] != 0) revert RewardKeyAlreadyUsed(rewardKey);

        Series storage selected = series[seriesId];
        if (!selected.active) revert SeriesNotActive(seriesId);
        if (selected.everMinted >= selected.maxEverMinted) {
            revert SeriesSupplyExceeded(seriesId, selected.maxEverMinted);
        }

        tokenId = _nextTokenId++;
        selected.everMinted += 1;
        tokenByRewardKey[rewardKey] = tokenId;
        seriesByToken[tokenId] = seriesId;

        emit Locked(tokenId);
        emit MascotMinted(rewardKey, tokenId, recipient, seriesId);
        _safeMint(recipient, tokenId);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function locked(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        return true;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId);
        return
            string.concat(series[seriesByToken[tokenId]].baseTokenURI, tokenId.toString(), ".json");
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address previousOwner)
    {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
