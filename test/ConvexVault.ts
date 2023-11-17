import { mine, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { HardhatEthersSigner as Signer } from "@nomicfoundation/hardhat-ethers/signers";
import { expect, } from "chai";
import { ethers, network } from "hardhat";
import { ConvexVault, IBooster, IBooster__factory, IERC20, IERC20__factory, IWETH, IWETH__factory } from "../typechain-types";

// sCRV LP pool
const pid = 9;
const lpToken = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490";
const crvPoolAddress = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"
const whaleAddress = "0xc499FEA2c04101Aa2d99455a016b4eb6189F1fA9";

const ETH = "0x0000000000000000000000000000000000000000";
const CRV = "0xD533a949740bb3306d119CC777fa900bA034cd52";
const CVX = "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B";
const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const boosterContractAddress = "0xF403C135812408BFbE8713b5A23a04b3D48AAE31";

const getCurrentBlock = async () => {
  const block = await ethers.provider.getBlock('latest');
  return block?.timestamp;
}

const getCrvCvxFromLog = (event) => {
  const crvReward = event.args[1];
  const cvxReward = event.args[2];
  return [crvReward, cvxReward];
}

describe("ConvexVault", function () {

  let owner: Signer, user1: Signer, user2: Signer, user3: Signer, user4: Signer, whale: Signer;
  let convexVault: ConvexVault;
  let lpContract: IERC20, crvContract: IERC20, cvxContract: IERC20, daiContract: IERC20, usdcContract: IERC20, usdtContract: IERC20, wethContract: IWETH;
  let boosterContract: IBooster;

  before(async () => {

    // Contracts are deployed using the first signer/account by default
    [owner, user1, user2, user3, user4] = await ethers.getSigners();

    const ConvexVault = await ethers.getContractFactory("ConvexVault");
    convexVault = await ConvexVault.deploy(pid, crvPoolAddress);

    lpContract = IERC20__factory.connect(lpToken);
    crvContract = IERC20__factory.connect(CRV);
    cvxContract = IERC20__factory.connect(CVX);
    daiContract = IERC20__factory.connect(DAI);
    usdcContract = IERC20__factory.connect(USDC);
    usdtContract = IERC20__factory.connect(USDT);
    wethContract = IWETH__factory.connect(WETH);
    boosterContract = IBooster__factory.connect(boosterContractAddress);

    // Get LP token whale from mainnet
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whaleAddress],
    });
    whale = await ethers.getSigner(whaleAddress);

    // Transfer lp tokens to users
    await lpContract.connect(whale)
      .transfer(user1.address, ethers.parseEther("100"));
    await lpContract.connect(whale)
      .transfer(user2.address, ethers.parseEther("50"));
    await lpContract.connect(whale)
      .transfer(user3.address, ethers.parseEther("20"));
    await lpContract.connect(whale)
      .transfer(user4.address, ethers.parseEther("10"));
  });

  describe("Deployment", function () {
    it("Should set the correct pool", async function () {
      expect(await convexVault.pid()).to.equal(pid);

      const { _lptoken, _token, _stash } = await convexVault.getConvexPoolInfo();
      expect(_lptoken).to.equal(lpToken);
    });

    it("Should set the right owner", async function () {
      expect(await convexVault.owner()).to.equal(owner.address);
    });

    it("Should have lp tokens for test user", async function () {
      expect(await lpContract.connect(user3).balanceOf(user4)).to.equal(ethers.parseEther("10"));
    });
  });

  describe("Deposit vault", function () {

    it("Should deposit correct amount to Convex pool", async function () {
      const vaultAddress = await convexVault.getAddress();

      // Approve amount before deposit
      const amount = 100;
      await lpContract.connect(user1)
        .approve(vaultAddress, amount);

      // Deposit token to vault
      const ret = await ((await convexVault.connect(user1)
        .deposit(amount))
        .wait());

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      expect(events?.length).eq(1, "Event not emitted");
      if (events) {
        expect(events[0].args[0]).eq(user1.address, "Emitted event not matched with signer");
        expect(events[0].args[1]).eq(amount, "Emitted event not matched with amount");
      }

      // Get user's deposit amount
      const userBalance = await (await convexVault.userInfo(user1.address)).amount;
      expect(userBalance).to.equal(amount);
    });

    it("Failed deposit because of zero amount", async function () {
      // Deposit token to vault
      await expect(convexVault.connect(user1)
        .deposit(0))
        .to.be.revertedWith('Amount must be greater than 0');
    });

  })

  describe("Withdraw vault", function () {

    it("Should withdraw correct amount to Convex pool", async function () {
      const vaultAddress = await convexVault.getAddress();

      // Approve amount before deposit
      await lpContract.connect(user1)
        .approve(vaultAddress, 100);

      const lpBalanceBefore = await lpContract.connect(user1).balanceOf(user1);

      // Deposit token to vault
      await convexVault.connect(user1)
        .deposit(100);

      // Withdraw token from vault
      const ret = await ((await convexVault.connect(user1)
        .withdraw(50))).wait();

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      expect(events?.length).eq(2, "Should receive 2 events"); // Claim & Withdrawn
      if (events) {
        expect(events[1].args[0]).eq(user1.address, "Emitted event not matched with signer");
        expect(events[1].args[1]).eq(50, "Emitted event not matched with amount");
      }

      // Should be 50 reduced
      const lpBalanceAfter = await lpContract.connect(user1).balanceOf(user1);
      expect(lpBalanceBefore - lpBalanceAfter).to.equal(50);
    });

    it("Failed withdraw because of insufficient balance", async function () {
      // Current balance is 100 + 100 - 50 = 150
      // Withdraw 200 token will be failed because of greater than balance
      await expect(convexVault.connect(user1)
        .withdraw(200))
        .to.be.revertedWith('withdraw: insufficient balance');
    });

  })

  describe("Claim reward from vault", function () {
    it("Should claim CRV/CVX from vault - single user", async function () {
      const vaultAddress = await convexVault.getAddress();

      const depositAmount = ethers.parseEther('1');

      // Approve amount before deposit
      await lpContract.connect(user1)
        .approve(vaultAddress, depositAmount);

      // Get CRV, CVX balance before deposit
      const crvBalance1 = await crvContract.connect(owner)
        .balanceOf(owner);
      const cvxBalance1 = await cvxContract.connect(owner)
        .balanceOf(owner);

      // Deposit token to vault
      await convexVault.connect(user1)
        .deposit(depositAmount);

      // Increae 1 hour for test reward
      const block = await time.increase(3600);
      // console.log('Increased block:', block);

      // Get rewards from Booster
      await boosterContract.connect(owner).earmarkRewards(pid);

      // Claim rewards from vault
      const ret = await (await convexVault.connect(user1)
        .claim(user1))
        .wait();

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      expect(events?.length).eq(1, "Event not emitted");
      if (events) {
        expect(events[0].args[0]).eq(user1.address, "Emitted event not matched with signer");
        expect(events[0].args[1]).greaterThan(0, "Emitted event not matched with crvReward");
        expect(events[0].args[2]).greaterThan(0, "Emitted event not matched with cvxReward");
      }

      // Check CVX, CRV balance after claimed
      const crvBalance2 = await crvContract.connect(user1)
        .balanceOf(user1);
      const cvxBalance2 = await cvxContract.connect(user1)
        .balanceOf(user1);

      expect(crvBalance2).to.greaterThan(crvBalance1);
      expect(cvxBalance2).to.greaterThan(cvxBalance1);
    });

    it("Should claim CRV/CVX from vault - multiple users", async function () {
      const vaultAddress = await convexVault.getAddress();

      for (const user of [user1, user2, user3]) {
        const depositAmount = ethers.parseEther('1');

        // Approve amount before deposit
        await lpContract.connect(user)
          .approve(vaultAddress, depositAmount);

        // Deposit token to vault
        await convexVault.connect(user)
          .deposit(depositAmount);
      }

      // Increae 1 hour for test reward
      const block = await time.increase(3600);
      // console.log('Increased block:', block);

      // Claim 3rd user's rewards from vault
      const ret = await (await convexVault.connect(user3)
        .claim(user3))
        .wait();

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      const crvReward = events[0].args[1];
      const cvxReward = events[0].args[2];
      expect(crvReward).greaterThan(0, "Emitted event not matched with crvReward");
      expect(cvxReward).greaterThan(0, "Emitted event not matched with cvxReward");
    });

    it("Should receive zero CRV/CVX after withdraw all", async function () {
      const vaultAddress = await convexVault.getAddress();

      const [amount] = await convexVault.connect(user1).userInfo(user1);

      // Withdraw total tokens from vault
      await convexVault.connect(user1)
        .withdraw(amount);

      // Increae 1 hour for test reward
      const block = await time.increase(3600);
      // console.log('Increased block:', block);

      // Claim rewards from vault
      const ret = await (await convexVault.connect(user1)
        .claim(user1))
        .wait();

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      const crvReward = events[0].args[1];
      const cvxReward = events[0].args[2];

      expect(crvReward).eq(0, "Should receive 0 CRV");
      expect(cvxReward).eq(0, "Should receive 0 CVX");
    });

    it("Should receive correct pending rewards when getRewards", async function () {
      const vaultAddress = await convexVault.getAddress();

      let depositAmount = ethers.parseEther("2");
      await lpContract.connect(user4)
        .approve(vaultAddress, depositAmount);
      await convexVault.connect(user4)
        .deposit(depositAmount);

      // Get CRV, CVX balance of vault
      const vaultCrvBefore = await crvContract.connect(owner).balanceOf(vaultAddress);
      const vaultCvxBefore = await cvxContract.connect(owner).balanceOf(vaultAddress);

      // Increae 1 hour for test reward
      await time.increase(3600);
      // console.log('Increased block:', block);

      // Calculate pending amount
      // Keep block timestamp
      const earnedVaultCrv = await convexVault.earnedVaultCrv();
      const earnedVaultCvx = await convexVault.earnedVaultCvx();

      // Get rewards and compare balance
      await convexVault.connect(owner).getRewards();

      const vaultCrvAfter = await crvContract.connect(owner).balanceOf(vaultAddress);
      const vaultCvxAfter = await cvxContract.connect(owner).balanceOf(vaultAddress);

      // Can be 1% difference becuase of block timestamp increased
      expect(Number(vaultCrvAfter - vaultCrvBefore))
        .greaterThan(Number(earnedVaultCrv) * 0.99)
        .lessThan(Number(earnedVaultCrv) * 1.01);

      expect(Number(vaultCvxAfter - vaultCvxBefore))
        .greaterThan(Number(earnedVaultCvx) * 0.99)
        .lessThan(Number(earnedVaultCvx) * 1.01);

    });

    it("Should distribute correct rewards for users", async function () {
      const vaultAddress = await convexVault.getAddress();

      // claim user1, user2, user3 at same time for clear test
      await convexVault.connect(user1).claim(user1);
      await convexVault.connect(user2).claim(user2);
      await convexVault.connect(user3).claim(user3);

      await time.increase(3600);

      // User1 should claim 0 because of 0 lp deposited
      let ret = await (await convexVault.connect(user1)
        .claim(user1))
        .wait();

      const [user1Crv, user1Cvx] = getCrvCvxFromLog(ret?.logs.filter(x => x.address == vaultAddress)[0]);
      expect(user1Crv).eq(0);
      expect(user1Cvx).eq(0);

      // User2 and user3 should claim same amount because of same lp amount deposited
      ret = await (await convexVault.connect(user2)
        .claim(user2))
        .wait();
      const [user2Crv, user2Cvx] = getCrvCvxFromLog(ret?.logs.filter(x => x.address == vaultAddress)[0]);

      ret = await (await convexVault.connect(user3)
        .claim(user3))
        .wait();
      const [user3Crv, user3Cvx] = getCrvCvxFromLog(ret?.logs.filter(x => x.address == vaultAddress)[0]);

      expect(user2Crv).eq(user3Crv, "Claimed CRV not matched");
      expect(user2Cvx).eq(user3Cvx, "Claimed CVX not matched");
    });
  })

  describe("Deposit non-LP token", function () {

    it("Add/remove whitelisted assets", async function () {
      // Add ETH, USDC, USDT, DAI
      await convexVault.connect(owner)
        .addWhitelistAsset(ETH);
      await convexVault.connect(owner)
        .addWhitelistAsset(USDC);
      await convexVault.connect(owner)
        .addWhitelistAsset(USDT);
      await convexVault.connect(owner)
        .addWhitelistAsset(DAI);

      // Remove USDC from whitelist
      await convexVault.connect(owner)
        .removeWhitelistAsset(USDC);
    });

    it("Try to deposit non-whitelist token", async function () {
      await expect(convexVault.connect(user1)
        .depositToken(USDC, 1000))
        .to.be.revertedWith('Not whitelisted token');
    });

    it("Deposit underlying token", async function () {
      const vaultAddress = await convexVault.getAddress();

      const depositAmount = ethers.parseUnits('100', 6); // 100$

      // Get some USDT from whale
      await usdtContract.connect(whale)
        .transfer(user1.address, depositAmount);

      // Approve amount before deposit
      await usdtContract.connect(user1)
        .approve(vaultAddress, depositAmount);

      // Deposit USDT
      const ret = await (await convexVault.connect(user1)
        .depositToken(USDT, depositAmount))
        .wait();

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      expect(events?.length).eq(1, "Event not emitted");
      expect(events[0].args[0]).eq(user1.address, "Emitted event not matched with signer");
      expect(events[0].args[1]).eq(USDT, "Emitted event not matched with token address");

      const amount = events[0].args[2];
      expect(amount).greaterThan(0, "Deposit token not worked");
    });

    it("Deposit non-underlying token", async function () {
      const vaultAddress = await convexVault.getAddress();

      const depositAmount = ethers.parseUnits('1', 18); // 1 DAI

      // Get some DAI from whale
      await daiContract.connect(whale)
        .transfer(user1.address, depositAmount);

      // Approve amount before deposit
      await daiContract.connect(user1)
        .approve(vaultAddress, depositAmount);

      // Deposit DAI
      const ret = await (await convexVault.connect(user1)
        .depositToken(DAI, depositAmount))
        .wait();

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      expect(events?.length).eq(1, "Event not emitted");
      const amount = events[0].args[2];
      expect(amount).greaterThan(0, "Deposit token not worked");
    });

    it("Deposit ETH", async function () {
      const vaultAddress = await convexVault.getAddress();

      const depositAmount = ethers.parseEther("1"); // 1 WETH

      // Deposit ETH
      const ret = await (await convexVault.connect(user1)
        .depositToken(ETH, depositAmount, {
          value: depositAmount
        }))
        .wait();

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      expect(events?.length).eq(1, "Event not emitted");
      const amount = events[0].args[2];
      expect(amount).greaterThan(0, "Deposit token not worked");
    });
  })

  describe("Withdraw non-LP token", function () {

    it("Withdraw as underlying token", async function () {
      const vaultAddress = await convexVault.getAddress();

      const withdrawAmount = ethers.parseUnits('1', 18);

      // Withdraw as DAI
      const ret = await (await convexVault.connect(user1)
        .withdrawToken(DAI, withdrawAmount))
        .wait();

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      expect(events?.length).eq(1, "Event not emitted");
      const amount = events[0].args[2];
      expect(amount).greaterThan(0, "Withdraw not worked");

      console.log("Total withdrawn:", amount);
    });

    it("Try withdraw after withdraw all", async function () {
      const [balance] = await convexVault.userInfo(user1);
      await convexVault.connect(user1)
        .withdrawToken(DAI, balance);

      await expect(convexVault.connect(user1)
        .withdrawToken(DAI, 10000))
        .to.be.revertedWith("withdraw: insufficient balance")
    });

    it("Try re-deposit & withdraw after withdraw all", async function () {
      const vaultAddress = await convexVault.getAddress();
      const depositAmount = ethers.parseUnits('1', 18);

      // Try deposit
      await daiContract.connect(user1)
        .approve(vaultAddress, depositAmount);
      const ret1 = await (await convexVault.connect(user1)
        .depositToken(DAI, depositAmount))
        .wait();
      let events = ret1?.logs.filter(x => x.address == vaultAddress)
      expect(events[0].args[2]).greaterThan(0, "Deposit token not worked");

      await time.increase(3600);

      // Try withdraw
      const [balance] = await convexVault.userInfo(user1);
      const ret2 = await (await convexVault.connect(user1)
        .withdrawToken(DAI, balance))
        .wait();
      events = ret2?.logs.filter(x => x.address == vaultAddress)
      expect(events[0].args[2]).greaterThan(0, "Withdraw token not worked");
    });
  })
});
