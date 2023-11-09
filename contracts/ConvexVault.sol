// SPDX-License-Identifier: MIT
pragma solidity ^0.8.1;

// Uncomment this line to use console.log
import "hardhat/console.sol";

// Import necessary interfaces and libraries
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IBooster.sol";
import "./interfaces/IClaimZap.sol";
import "./interfaces/IBaseRewardPool.sol";

contract ConvexVault is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct RewardIndex {
        uint256 cvxIndex;
        uint256 crvIndex;
    }

    struct Reward {
        uint256 cvxEarned;
        uint256 crvEarned;
    }

    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        Reward reward; // Reward debt. See explanation below.
        RewardIndex rewardIndex;
    }

    uint256 public immutable pid; // Specified pool id for Curve LP
    IBooster public constant CvxBooster =
        IBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IERC20 public constant CvxToken =
        IERC20(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
    IERC20 public constant CrvToken =
        IERC20(0xD533a949740bb3306d119CC777fa900bA034cd52);
    uint private constant MULTIPLIER = 1e18;

    uint256 public totalSupply = 0;

    mapping(address => UserInfo) public userInfo;
    RewardIndex public rewardIndex;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 crvAmount, uint256 cvxAmount);

    // Specify LP pool
    constructor(uint256 _pid) {
        pid = _pid;
    }

    function getConvexPoolInfo()
        public
        view
        returns (
            address _lptoken,
            address _token,
            address _gauge,
            address _crvRewards,
            address _stash,
            bool _shutdown
        )
    {
        (_lptoken, _token, _gauge, _crvRewards, _stash, _shutdown) = CvxBooster
            .poolInfo(pid);
    }

    function _calculateRewards(
        address _account
    ) private view returns (uint crvReward, uint cvxReward) {
        UserInfo memory info = userInfo[_account];
        cvxReward =
            (info.amount * (rewardIndex.cvxIndex - info.rewardIndex.cvxIndex)) /
            MULTIPLIER;
        crvReward =
            (info.amount * (rewardIndex.crvIndex - info.rewardIndex.crvIndex)) /
            MULTIPLIER;
    }

    function _updateRewards(address _account) private {
        UserInfo storage info = userInfo[_account];
        (uint crvReward, uint cvxReward) = _calculateRewards(_account);
        info.reward.crvEarned += crvReward;
        info.reward.cvxEarned += cvxReward;
        info.rewardIndex = rewardIndex;
    }

    // Deposit LP tokens into the vault
    function deposit(uint256 _amount) external {
        require(_amount > 0, "Amount must be greater than 0");

        // Get rewards from Convex and update rewards
        if (totalSupply > 0) {
            getRewards();
            _updateRewards(msg.sender);
        }

        (address lpToken, , , , , ) = getConvexPoolInfo();
        UserInfo storage user = userInfo[msg.sender];

        IERC20(lpToken).transferFrom(
            address(msg.sender),
            address(this),
            _amount
        );

        user.amount = user.amount.add(_amount);
        totalSupply = totalSupply.add(_amount);

        vaultStake();

        // Emit event
        emit Deposited(msg.sender, _amount);
    }

    // Withdraw LP tokens from the vault
    function withdraw(uint256 _amount) external {
        require(_amount > 0, "Amount must be greater than 0");

        (address lpToken, , , address crvRewards, , ) = getConvexPoolInfo();
        UserInfo storage user = userInfo[msg.sender];
        require(user.amount >= _amount, "withdraw: insufficient balance");

        claim(msg.sender);
        IBaseRewardPool(crvRewards).withdraw(_amount, true);
        CvxBooster.withdraw(pid, _amount);

        user.amount = user.amount.sub(_amount);
        totalSupply = totalSupply.sub(_amount);
        IERC20(lpToken).transfer(address(msg.sender), _amount);

        // Emit event
        emit Withdrawn(msg.sender, _amount);
    }

    function claim(address _account) public {
        getRewards();

        _updateRewards(_account);

        UserInfo storage user = userInfo[_account];
        uint256 cvxReward = user.reward.cvxEarned;
        uint256 crvReward = user.reward.crvEarned;

        if (cvxReward > 0) {
            user.reward.cvxEarned = 0;
            CvxToken.transfer(_account, cvxReward);
        }
        if (crvReward > 0) {
            user.reward.crvEarned = 0;
            CrvToken.transfer(_account, crvReward);
        }

        // Emit event
        emit Claimed(_account, crvReward, cvxReward);
    }

    function getRewards() public {
        uint256 crvBalance = CrvToken.balanceOf(address(this));
        uint256 cvxBalance = CvxToken.balanceOf(address(this));

        (, , , address crvReward, , ) = getConvexPoolInfo();
        IBaseRewardPool(crvReward).getReward();

        uint256 updatedCrvBalance = CrvToken.balanceOf(address(this));
        uint256 updatedCvxBalance = CvxToken.balanceOf(address(this));

        if (updatedCrvBalance > crvBalance || updatedCvxBalance < cvxBalance) {
            rewardIndex.crvIndex +=
                ((updatedCrvBalance - crvBalance) * MULTIPLIER) /
                totalSupply;
            rewardIndex.cvxIndex +=
                ((updatedCvxBalance - cvxBalance) * MULTIPLIER) /
                totalSupply;
        }
    }

    function vaultStake() internal {
        (address lpToken, , , , , ) = getConvexPoolInfo();
        uint balance = IERC20(lpToken).balanceOf(address(this));
        IERC20(lpToken).approve(address(CvxBooster), balance);
        CvxBooster.deposit(pid, balance, true);
    }
}
