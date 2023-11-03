// SPDX-License-Identifier: MIT
pragma solidity ^0.8.1;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

// Import necessary interfaces and libraries
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Name", "M-T") {}
}
