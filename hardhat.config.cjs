require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.9",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  allowUnlimitedContractSize: true,
  // gasReporter: {
  //   enabled: true,
  //   outputFile: "gas-report.txt",
  //   noColors: true,
  // },
  networks: {
    // fuji: {
    //   url: `https://avalanche-fuji.infura.io/v3/secret`,
    //   accounts: [`secret`],
    //   chainId: 43113,
    // },
    hardhat: {
      gas: 30000000,
      blockGasLimit: 3000000000000,
      chainId: 1337,
      allowBlocksWithSameTimestamp: true,
      accounts: {
        count: 50,
        accountsBalance: "1000000000000000000000",
      },
    },
  },
};
