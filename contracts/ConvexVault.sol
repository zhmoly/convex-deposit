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
import "./interfaces/ICurveFi.sol";
import "./interfaces/ISwapRouter.sol";
import "./interfaces/IWETH.sol";

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
    address public immutable crvPool; // Curve Pool for selected pid
    IBooster public constant CvxBooster =
        IBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IERC20 public constant CVX =
        IERC20(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
    IERC20 public constant CRV =
        IERC20(0xD533a949740bb3306d119CC777fa900bA034cd52);
    IWETH public constant WETH =
        IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    ISwapRouter constant router =
        ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);
    uint private constant MULTIPLIER = 1e18;

    uint256 public totalSupply = 0;

    mapping(address => UserInfo) public userInfo;
    mapping(address => bool) public whitelistedAssets;
    RewardIndex public rewardIndex;

    event Deposited(address indexed user, uint256 amount);
    event DepositedToken(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event Withdrawn(address indexed user, uint256 amount);
    event WithdrawnToken(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event Claimed(address indexed user, uint256 crvAmount, uint256 cvxAmount);
    event WhitelistAssetAdded(address asset);
    event WhitelistAssetRemoved(address asset);

    // Specify LP pool
    constructor(uint256 _pid, address _crvPool) {
        pid = _pid;
        crvPool = _crvPool;
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

    function addWhitelistAsset(address _token) external onlyOwner {
        require(!whitelistedAssets[_token], "Assert already added");
        whitelistedAssets[_token] = true;
        emit WhitelistAssetAdded(_token);
    }

    function removeWhitelistAsset(address _token) external onlyOwner {
        require(whitelistedAssets[_token], "Assert already removed");
        whitelistedAssets[_token] = false;
        emit WhitelistAssetRemoved(_token);
    }

    // Deposit LP tokens into the vault
    function deposit(uint256 _amount) public {
        _deposit(_amount, msg.sender);

        // Emit event
        emit Deposited(msg.sender, _amount);
    }

    // Deposit allowed token into the vault
    function depositToken(address _token, uint256 _amount) public payable {
        // Check inputs
        require(whitelistedAssets[_token], "Not whitelisted token");
        require(_amount != 0, "Invalid token amount");

        // Get LP balance before
        (address lpToken, , , , , ) = getConvexPoolInfo();
        uint lpBalanceBefore = IERC20(lpToken).balanceOf(address(this));

        if (_token == address(0)) {
            // Deposit ETH
            require(
                _amount == msg.value,
                "Input amount not matched with sent ETH"
            );

            // Swap WETH into underlying token using uniswap router
            address underlyingToken = ICurveFi(crvPool).coins(0);
            uint amountOut = _swapToken(address(0), underlyingToken, _amount);
            _addLiquidity(underlyingToken, 0, amountOut);
        } else {
            // Transfer token from user to vault
            IERC20(_token).safeTransferFrom(
                address(msg.sender),
                address(this),
                _amount
            );

            // Check token is underlying token
            uint underlyingIdx = 99;
            for (uint256 i = 0; i < 3; i++) {
                address coin = ICurveFi(crvPool).coins(i);

                if (_token == coin) {
                    underlyingIdx = i;
                    break;
                }
            }

            // Direct deposit into LP Pool
            if (underlyingIdx != 99) {
                _addLiquidity(_token, underlyingIdx, _amount);
            } else {
                // Swap token into underlying token using uniswap router
                address underlyingToken = ICurveFi(crvPool).coins(0);
                uint amountOut = _swapToken(_token, underlyingToken, _amount);
                _addLiquidity(underlyingToken, 0, amountOut);
            }
        }

        // Check LP balance updated
        uint lpBalanceAfter = IERC20(lpToken).balanceOf(address(this));
        uint amount = lpBalanceAfter - lpBalanceBefore;
        _deposit(amount, address(this));

        // Emit event
        emit DepositedToken(msg.sender, _token, amount);
    }

    // Deposit LP token
    function _deposit(uint256 _amount, address _sender) internal {
        require(_amount > 0, "Amount must be greater than 0");

        // Update user status
        UserInfo storage user = userInfo[msg.sender];

        // Get rewards from Convex and update rewards
        if (totalSupply > 0) {
            getRewards();
            _updateRewards(msg.sender);
        }

        (address lpToken, , , , , ) = getConvexPoolInfo();
        if (_sender != address(this)) {
            IERC20(lpToken).safeTransferFrom(
                address(msg.sender),
                address(this),
                _amount
            );
        }

        user.amount = user.amount.add(_amount);
        totalSupply = totalSupply.add(_amount);

        // Deposit LP tokens to Booster contract
        IERC20(lpToken).safeApprove(address(CvxBooster), _amount);
        CvxBooster.deposit(pid, _amount, true);
    }

    // Withdraw LP tokens from the vault
    function withdraw(uint256 _amount) external {
        _withdraw(_amount, msg.sender);

        // Emit event
        emit Withdrawn(msg.sender, _amount);
    }

    // Withdraw allowed token from the vault
    function withdrawToken(address _token, uint256 _amount) public payable {
        // Check inputs
        require(whitelistedAssets[_token], "Not whitelisted token");
        require(_amount != 0, "Invalid token amount");

        // Withdraw liquidity
        _withdraw(_amount, address(this));

        // Remove liquidity
        uint256[3] memory amounts;
        ICurveFi(crvPool).remove_liquidity(_amount, amounts);

        // Swap rewards into token
        uint256 amount = 0;
        for (uint256 i = 0; i < 3; i++) {
            // get returned token balance
            address underlyingToken = ICurveFi(crvPool).coins(i);
            uint256 tokenBalance = IERC20(underlyingToken).balanceOf(
                address(this)
            );
            if (tokenBalance == 0) {
                continue;
            }

            // if requested token, then add amount
            if (underlyingToken == _token) {
                console.log("%s balance: %d", _token, tokenBalance);
                amount += tokenBalance;
            } else {
                // swap into requested token
                uint amountOut = _swapMultiToken(
                    underlyingToken,
                    _token,
                    tokenBalance,
                    3000
                );
                console.log("%s swap: %d", underlyingToken, amountOut);
                amount += amountOut;
            }
        }

        // Swap CRV, CVX
        UserInfo storage user = userInfo[msg.sender];
        if (user.reward.crvEarned > 0) {
            uint amountOut = _swapMultiToken(
                address(CRV),
                _token,
                user.reward.crvEarned,
                3000
            );
            amount += amountOut;
            console.log("CRV swap:", amountOut);
            user.reward.crvEarned = 0;
        }
        if (user.reward.cvxEarned > 0) {
            uint amountOut = _swapMultiToken(
                address(CVX),
                _token,
                user.reward.cvxEarned,
                10000
            );
            amount += amountOut;
            console.log("CVX swap:", amountOut);
            user.reward.cvxEarned = 0;
        }

        // Transfer requested token from vault to user
        if (amount > 0) {
            IERC20(_token).safeTransfer(msg.sender, amount);
        }

        // Emit event
        emit WithdrawnToken(msg.sender, _token, amount);
    }

    // Withdraw LP token
    function _withdraw(uint256 _amount, address _sender) internal {
        require(_amount > 0, "Amount must be greater than 0");

        (address lpToken, , , address crvRewards, , ) = getConvexPoolInfo();
        UserInfo storage user = userInfo[msg.sender];
        require(user.amount >= _amount, "withdraw: insufficient balance");

        if (_sender == address(this)) {
            getRewards();
            _updateRewards(msg.sender);
        } else {
            claim(msg.sender);
        }

        IBaseRewardPool(crvRewards).withdraw(_amount, true);
        CvxBooster.withdraw(pid, _amount);

        user.amount = user.amount.sub(_amount);
        totalSupply = totalSupply.sub(_amount);

        if (_sender != address(this)) {
            IERC20(lpToken).safeTransfer(msg.sender, _amount);
        }
    }

    // Claim CRV/CVX tokens from the vault
    function claim(address _account) public {
        (uint cvxReward, uint crvReward) = _claim(_account);

        // Emit event
        emit Claimed(_account, crvReward, cvxReward);
    }

    function _claim(
        address _account
    ) internal returns (uint256 cvxReward, uint256 crvReward) {
        getRewards();
        _updateRewards(_account);

        UserInfo storage user = userInfo[_account];
        cvxReward = user.reward.cvxEarned;
        crvReward = user.reward.crvEarned;

        if (cvxReward > 0) {
            user.reward.cvxEarned = 0;
            CVX.safeTransfer(_account, cvxReward);
        }
        if (crvReward > 0) {
            user.reward.crvEarned = 0;
            CRV.safeTransfer(_account, crvReward);
        }
    }

    // Get rewards from the booster
    function getRewards() public {
        require(totalSupply > 0, "Total supply should be greater than 0");

        uint256 crvBalance = CRV.balanceOf(address(this));
        uint256 cvxBalance = CVX.balanceOf(address(this));

        (, , , address crvReward, , ) = getConvexPoolInfo();
        IBaseRewardPool(crvReward).getReward();

        uint256 updatedCrvBalance = CRV.balanceOf(address(this));
        uint256 updatedCvxBalance = CVX.balanceOf(address(this));

        if (updatedCrvBalance > crvBalance) {
            rewardIndex.crvIndex +=
                ((updatedCrvBalance - crvBalance) * MULTIPLIER) /
                totalSupply;
        }
        if (updatedCvxBalance > cvxBalance) {
            rewardIndex.cvxIndex +=
                ((updatedCvxBalance - cvxBalance) * MULTIPLIER) /
                totalSupply;
        }
    }

    function _addLiquidity(
        address _token,
        uint256 _idx,
        uint256 _amount
    ) internal {
        // Approve token transfer to curve
        IERC20(_token).safeApprove(crvPool, _amount);

        // Add single liquidity
        uint256[3] memory amounts;
        amounts[_idx] = _amount;
        ICurveFi(crvPool).add_liquidity(amounts, 0);
    }

    function _swapToken(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        if (tokenIn != address(0)) {
            IERC20(tokenIn).safeApprove(address(router), 0);
            IERC20(tokenIn).safeApprove(address(router), amountIn);
        }

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: tokenIn == address(0) ? address(WETH) : tokenIn,
                tokenOut: tokenOut,
                fee: 3000,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

        if (tokenIn == address(0)) {
            amountOut = router.exactInputSingle{value: amountIn}(params);
        } else {
            amountOut = router.exactInputSingle(params);
        }
    }

    function _swapMultiToken(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 feeTier
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).safeApprove(address(router), amountIn);

        bytes memory path = abi.encodePacked(
            tokenIn,
            uint24(feeTier),
            WETH,
            uint24(feeTier),
            tokenOut
        );

        ISwapRouter.ExactInputParams memory params = ISwapRouter
            .ExactInputParams({
                path: path,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: 0
            });

        amountOut = router.exactInput(params);
    }

    // Viewer functions
    function earnedVaultCrv() public view returns (uint256) {
        if (totalSupply == 0) {
            return 0;
        }

        (, , , address crvReward, , ) = getConvexPoolInfo();

        uint256 poolTotalSupply = IBaseRewardPool(crvReward).totalSupply();
        uint256 lastUpdateTime = IBaseRewardPool(crvReward).lastUpdateTime();
        uint256 lastTimeRewardApplicable = IBaseRewardPool(crvReward)
            .lastTimeRewardApplicable();
        uint256 rewardPerTokenStored = IBaseRewardPool(crvReward)
            .userRewardPerTokenPaid(address(this));
        uint256 rewardRate = IBaseRewardPool(crvReward).rewardRate();
        uint256 rewards = IBaseRewardPool(crvReward).rewards(address(this));

        uint256 rewardPerToken = IBaseRewardPool(crvReward).rewardPerToken();
        uint256 storedRewardPerToken = rewardPerTokenStored;

        if (poolTotalSupply == 0) {
            return 0;
        }

        // Calculate the reward per token, taking into account the time since the last update
        uint256 pendingReward = lastTimeRewardApplicable
            .sub(lastUpdateTime)
            .mul(rewardRate)
            .mul(1e18)
            .div(poolTotalSupply);

        // Add the pending reward to the stored reward per token
        rewardPerToken = storedRewardPerToken.add(pendingReward);

        // Calculate the earned amount for the user
        uint256 earnedCrv = totalSupply
            .mul(rewardPerToken.sub(rewardPerTokenStored))
            .div(1e18)
            .add(rewards);

        return earnedCrv;
    }

    function earnedVaultCvx() public view returns (uint256) {
        uint256 earnedCrv = earnedVaultCrv();
        if (earnedCrv == 0) {
            return 0;
        }

        uint256 earnedCvx = earnedCrv;

        uint256 cvxSupply = CVX.totalSupply();
        uint256 maxSupply = 100 * 1000000 * 1e18;
        uint256 totalCliffs = 1000;
        uint256 reductionPerCliff = maxSupply.div(totalCliffs);
        uint256 cliff = cvxSupply.div(reductionPerCliff);

        if (cliff < totalCliffs) {
            //for reduction% take inverse of current cliff
            uint256 reduction = totalCliffs.sub(cliff);
            //reduce
            earnedCvx = earnedCvx.mul(reduction).div(totalCliffs);

            //supply cap check
            uint256 amtTillMax = maxSupply.sub(cvxSupply);
            if (earnedCvx > amtTillMax) {
                earnedCvx = amtTillMax;
            }

            return earnedCvx;
        }

        return 0;
    }
}
