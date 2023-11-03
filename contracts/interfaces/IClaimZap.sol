// SPDX-License-Identifier: MIT
pragma solidity ^0.8.1;

interface IClaimZap {
    function getName() external view returns (string memory);
    function setApprovals() external;
    function claimRewards(
        address[] calldata rewardContracts,
        address[] calldata extraRewardContracts,
        address[] calldata tokenRewardContracts,
        address[] calldata tokenRewardTokens,
        uint256 depositCrvMaxAmount,
        uint256 minAmountOut,
        uint256 depositCvxMaxAmount,
        uint256 spendCvxAmount,
        uint256 options
    ) external;
}