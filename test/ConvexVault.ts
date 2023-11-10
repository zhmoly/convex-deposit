import { mine, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { HardhatEthersSigner as Signer } from "@nomicfoundation/hardhat-ethers/signers";
import { expect, } from "chai";
import { ethers, network } from "hardhat";
import { ConvexVault, IERC20, IERC20__factory } from "../typechain-types";

// sCRV LP pool
const pid = 4;
const lpToken = "0xC25a3A3b969415c80451098fa907EC722572917F";
const whaleAddress = "0x9E51BE7071F086d3A1fD5Dc0016177473619b237";

const crvToken = "0xD533a949740bb3306d119CC777fa900bA034cd52";
const cvxToken = "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B";

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

  let owner: Signer, user1: Signer, user2: Signer, user3: Signer, user4: Signer;
  let convexVault: ConvexVault;
  let lpContract: IERC20, crvContract: IERC20, cvxContract: IERC20;

  before(async () => {

    // Contracts are deployed using the first signer/account by default
    [owner, user1, user2, user3, user4] = await ethers.getSigners();

    const ConvexVault = await ethers.getContractFactory("ConvexVault");
    convexVault = await ConvexVault.deploy(pid);

    lpContract = IERC20__factory.connect(lpToken);
    crvContract = IERC20__factory.connect(crvToken);
    cvxContract = IERC20__factory.connect(cvxToken);

    // Get LP token whale from mainnet
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whaleAddress],
    });
    const whale = await ethers.getSigner(whaleAddress);

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
      expect(events?.length).eq(1, "Should receive 1 event");
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
      const block = await time.increase(1800);
      // console.log('Increased block:', block);

      // Claim rewards from vault
      const ret = await (await convexVault.connect(user1)
        .claim(user1))
        .wait();

      // Check event log
      const events = ret?.logs.filter(x => x.address == vaultAddress)
      expect(events?.length).eq(1, "Should receive 1 event");
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
      const block = await time.increase(1800);
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
      const block = await time.increase(1800);
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
      await time.increase(1800);
      // console.log('Increased block:', block);

      // Calculate pending amount
      // Keep block timestamp
      const currentBlock = await getCurrentBlock();
      mine(currentBlock);
      const earnedVaultCrv = await convexVault.earnedVaultCrv();
      mine(currentBlock);
      const earnedVaultCvx = await convexVault.earnedVaultCvx();
      mine(currentBlock);

      // Get rewards and compare balance
      await convexVault.connect(owner)
        .getRewards();

      const vaultCrvAfter = await crvContract.connect(owner).balanceOf(vaultAddress);
      const vaultCvxAfter = await cvxContract.connect(owner).balanceOf(vaultAddress);
      console.log(vaultCrvAfter, vaultCvxAfter);

      expect(vaultCrvAfter - vaultCrvBefore).eq(earnedVaultCrv);
      expect(vaultCvxAfter - vaultCvxBefore).eq(earnedVaultCvx);

    });

    it("Should distribute correct rewards for users", async function () {
      const vaultAddress = await convexVault.getAddress();

      await time.increase(1800);

      // User1 should claim 0
      let ret = await (await convexVault.connect(user1)
        .claim(user1))
        .wait();

      const [user1Crv, user1Cvx] = getCrvCvxFromLog(ret?.logs.filter(x => x.address == vaultAddress)[0]);
      console.log(user1Crv, user1Cvx);
      expect(user1Crv).eq(0);
      expect(user1Cvx).eq(0);

      // User2 and user3 should claim same amount
      ret = await (await convexVault.connect(user2)
        .claim(user2))
        .wait();
      const [user2Crv, user2Cvx] = getCrvCvxFromLog(ret?.logs.filter(x => x.address == vaultAddress)[0]);
      console.log(user2Crv, user2Cvx);

      ret = await (await convexVault.connect(user3)
        .claim(user3))
        .wait();
      const [user3Crv, user3Cvx] = getCrvCvxFromLog(ret?.logs.filter(x => x.address == vaultAddress)[0]);
      console.log(user3Crv, user3Cvx);

      expect(user3Crv).greaterThan(user2Crv);
      expect(user3Cvx).greaterThan(user2Cvx);
    });

  })
});
