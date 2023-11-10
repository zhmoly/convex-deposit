// SPDX-License-Identifier: MIT
pragma solidity ^0.8.1;

interface IBaseRewardPool {
    function withdraw(uint256 amount, bool claim) external returns (bool);

    function withdrawAll(bool claim) external;

    function withdrawAndUnwrap(
        uint256 amount,
        bool claim
    ) external returns (bool);

    function withdrawAllAndUnwrap(bool claim) external;

    function getReward() external returns (bool);

    function earned(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function rewardPerToken() external view returns (uint256);

    function userRewardPerTokenPaid(address) external view returns (uint256);

    function rewards(address) external view returns (uint256);

    function rewardRate() external view returns (uint256);

    function lastUpdateTime() external view returns (uint256);

    function lastTimeRewardApplicable() external view returns (uint256);
}
