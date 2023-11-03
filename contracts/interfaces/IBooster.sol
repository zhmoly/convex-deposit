// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBooster {

    function deposit(
        uint256 _pid,
        uint256 _amount,
        bool _stake
    ) external returns (bool);

    function depositAll(uint256 _pid, bool _stake) external returns (bool);

    function withdraw(uint256 _pid, uint256 _amount) external returns (bool);

    function withdrawAll(uint256 _pid) external returns (bool);

    function withdrawTo(
        uint256 _pid,
        uint256 _amount,
        address _to
    ) external returns (bool);

    function vote(
        uint256 _voteId,
        address _votingAddress,
        bool _support
    ) external returns (bool);

    function voteGaugeWeight(
        address[] calldata _gauge,
        uint256[] calldata _weight
    ) external returns (bool);

    function claimRewards(uint256 _pid, address _gauge) external returns (bool);

    function setGaugeRedirect(uint256 _pid) external returns (bool);

    function earmarkRewards(uint256 _pid) external returns (bool);

    function earmarkFees() external returns (bool);

    function rewardClaimed(
        uint256 _pid,
        address _address,
        uint256 _amount
    ) external returns (bool);

    function poolManager() external view returns (address);

    function staker() external view returns (address);

    function minter() external view returns (address);

    function rewardFactory() external view returns (address);

    function stashFactory() external view returns (address);

    function tokenFactory() external view returns (address);

    function rewardArbitrator() external view returns (address);

    function voteDelegate() external view returns (address);

    function treasury() external view returns (address);

    function stakerRewards() external view returns (address);

    function lockRewards() external view returns (address);

    function lockFees() external view returns (address);

    function feeDistro() external view returns (address);

    function feeToken() external view returns (address);

    function poolInfo(
        uint256
    )
        external
        view
        returns (
            address _lptoken,
            address _token,
            address _gauge,
            address _crvRewards,
            address _stash,
            bool _shutdown
        );

    function gaugeMap(address) external view returns (bool);
}
