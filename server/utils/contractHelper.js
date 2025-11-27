import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ABI from src directory
const ABI_PATH = join(__dirname, '..', '..', 'src', 'coinFlip.json');
let coinFlipABI = null;

try {
  const abiContent = readFileSync(ABI_PATH, 'utf-8');
  coinFlipABI = JSON.parse(abiContent);
} catch (error) {
  console.error('Error loading CoinFlip ABI:', error);
  throw new Error('Failed to load CoinFlip ABI');
}

/**
 * Get a contract instance connected to the RPC provider
 */
export function getContractInstance() {
  const RPC_URL = process.env.RPC_URL;
  const CONTRACT_ADDRESS = process.env.COINFLIP_ADDRESS;
  const CHAIN_ID = Number(process.env.CHAIN_ID || process.env.VITE_CHAIN_ID || 763373);

  if (!RPC_URL || !CONTRACT_ADDRESS) {
    throw new Error('RPC_URL and COINFLIP_ADDRESS must be set in environment variables');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, coinFlipABI, provider);

  return { contract, provider };
}

/**
 * Get ERC20 contract instance
 */
export function getERC20Contract(tokenAddress, provider) {
  const erc20Abi = [
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function allowance(address owner, address spender) external view returns (uint256)"
  ];
  
  return new ethers.Contract(tokenAddress, erc20Abi, provider);
}

export { coinFlipABI };

