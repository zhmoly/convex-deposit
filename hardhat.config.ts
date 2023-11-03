import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.1",
  networks: {
    hardhat: {
      forking: {
        // eslint-disable-next-line
        enabled: true,
        url: `https://eth-mainnet.g.alchemy.com/v2/-iaW8mbxNWhkXUV7rQUl5roCcVo7BdYM`,
      }
    }
  }
};

export default config;
