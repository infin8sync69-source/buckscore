import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

const PRIVATE_KEY   = process.env.DEPLOYER_PRIVATE_KEY ?? '';
const BUCKS_RPC_URL = process.env.BUCKS_RPC_URL ?? 'http://127.0.0.1:8192';

const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

// ---------------------------------------------------------------------------
// Hardhat config
// ---------------------------------------------------------------------------

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled:  true,
        runs:     200,
      },
      evmVersion: 'berlin', // EVM Berlin hard-fork baseline — matches Bucks node
    },
  },

  networks: {
    // Local Bucks full node
    bucks: {
      url:      BUCKS_RPC_URL,
      chainId:  8192,
      accounts,
      gasPrice: 'auto',
    },

    // Bucks testnet (ChainID 81920)
    'bucks-testnet': {
      url:      process.env.BUCKS_TESTNET_RPC_URL ?? 'http://127.0.0.1:8192',
      chainId:  81920,
      accounts,
      gasPrice: 'auto',
    },

    // Hardhat built-in (for local testing without a real node)
    hardhat: {
      chainId:          8192,
      blockGasLimit:    15_000_000,
      initialBaseFeePerGas: 0,
    },

    localhost: {
      url:     'http://127.0.0.1:8545',
      chainId: 8192,
    },
  },

  paths: {
    sources:   './contracts',
    tests:     './test',
    cache:     './cache',
    artifacts: './artifacts',
  },

  // Deployment artifacts kept in deployments/
  // (use hardhat-deploy if needed in future phases)

  mocha: {
    timeout: 60_000,
  },
};

export default config;
