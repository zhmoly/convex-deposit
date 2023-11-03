import {
  time,
  loadFixture,
  mine,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect, } from "chai";
import { artifacts, ethers, network } from "hardhat";
import { IBooster__factory, IERC20__factory } from "../typechain-types";

const lpToken = "0x845838DF265Dcd2c412A1Dc9e959c7d08537f8a2";
const crvToken = "0xD533a949740bb3306d119CC777fa900bA034cd52";
const cvxToken = "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B";

describe("ConvexVault", function () {

  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployConvexVault() {

    // DAI/USDC LP pool
    const pid = 0;

    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners();

    // Get LP token owner from mainnet
    const lpOwnerAddress = "0x48CDB2914227fbc7F0259a5EA6De28e0b7f7B473";
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [lpOwnerAddress],
    });
    const lpOwner = await ethers.getSigner(lpOwnerAddress);

    const ConvexVault = await ethers.getContractFactory("ConvexVault");
    const convexVault = await ConvexVault.deploy(pid);

    return { convexVault, pid, owner, lpOwner, otherAccount };
  }

  describe("Deployment", function () {
    it("Should set the correct pool", async function () {
      const { convexVault, pid, } = await loadFixture(deployConvexVault);
      expect(await convexVault.pid()).to.equal(pid);

      const { _lptoken, _token, _stash } = await convexVault.getConvexPoolInfo();
      expect(_lptoken).to.equal(lpToken);
    });

    it("Should set the right owner", async function () {
      const { convexVault, owner } = await loadFixture(deployConvexVault);
      expect(await convexVault.owner()).to.equal(owner.address);
    });
  });

  describe("Deposit/Withdraw vault", function () {

    it("Should withdraw correct amount to Convex pool", async function () {
      const { convexVault, pid, owner, lpOwner } = await loadFixture(deployConvexVault);
      const vaultAddress = await convexVault.getAddress();

      // Approve amount before deposit
      const lpTokeContract = IERC20__factory.connect(lpToken);
      await lpTokeContract.connect(lpOwner)
        .approve(vaultAddress, 100, {
          from: lpOwner
        });

      const lpBalanceBefore = await lpTokeContract.connect(owner).balanceOf(lpOwner);

      // Deposit token to vault
      await convexVault.connect(lpOwner)
        .deposit(100);

      // Get vault lp balance
      const userBalance = await (await convexVault.userInfo(lpOwner)).amount;
      expect(userBalance).to.equal(100);

      // Withdraw token from vault
      await convexVault.connect(lpOwner)
        .withdraw(50);

      // Should be 50 reduced
      const lpBalanceAfter = await lpTokeContract.connect(owner).balanceOf(lpOwner);
      expect(lpBalanceBefore - lpBalanceAfter).to.equal(50);
    }).timeout("120s");

  })

  describe("Claim reward from vault", function () {
    it("Should claim correct amount from vault", async function () {
      const { convexVault, pid, owner, lpOwner } = await loadFixture(deployConvexVault);
      const vaultAddress = await convexVault.getAddress();

      const depositAmount = 1_000_000_000;

      // Approve amount before deposit
      const lpTokenContract = IERC20__factory.connect(lpToken);
      await lpTokenContract.connect(lpOwner)
        .approve(vaultAddress, depositAmount, {
          from: lpOwner
        });

      // Get CRV balance
      const crvTokenContract = IERC20__factory.connect(crvToken);
      const cvxTokenContract = IERC20__factory.connect(cvxToken);
      const crvBalance1 = await crvTokenContract.connect(lpOwner)
        .balanceOf(lpOwner);
      const cvxBalance1 = await cvxTokenContract.connect(lpOwner)
        .balanceOf(lpOwner);

      // Deposit token to vault
      await convexVault.connect(lpOwner)
        .deposit(depositAmount);

      // Increae 1 hour for test reward
      await time.increase(86400);
      await mine();
      await mine();

      // Claim rewards from vault
      await convexVault.connect(lpOwner)
        .claim(lpOwner.address);

      // Check rewards distributed
      const crvBalance2 = await crvTokenContract.connect(lpOwner)
        .balanceOf(lpOwner);
      const cvxBalance2 = await cvxTokenContract.connect(lpOwner)
        .balanceOf(lpOwner);

      expect(crvBalance2).to.greaterThan(crvBalance1);
      expect(cvxBalance2).to.greaterThan(cvxBalance1);

      console.log('CRV earned', crvBalance2 - crvBalance1);
      console.log('CVX earned', cvxBalance2 - cvxBalance1);
    }).timeout("120s");
  })

});
