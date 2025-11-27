// Vercel serverless function to resolve a specific bet
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ABI - try multiple paths for different environments
let coinFlipABI;
try {
  const paths = [
    join(process.cwd(), 'src', 'coinFlip.json'),
    join(process.cwd(), 'coinFlip-main', 'src', 'coinFlip.json'),
    join(__dirname, '..', '..', 'src', 'coinFlip.json'),
  ];
  
  let abiContent = null;
  for (const path of paths) {
    try {
      abiContent = readFileSync(path, 'utf-8');
      break;
    } catch (e) {
      // Try next path
    }
  }
  
  if (abiContent) {
    coinFlipABI = JSON.parse(abiContent);
  } else {
    throw new Error('ABI file not found');
  }
} catch (error) {
  console.error('Error loading ABI:', error);
  // Fallback to minimal ABI
  coinFlipABI = [
    "event BetPlaced(uint256 indexed betId, address indexed player, uint8 guess, uint256 amount, uint256 clientSeed)",
    "function resolveBet(uint256 betId, bytes32 random, bytes signature) external",
    "function bets(uint256) view returns (address player, uint256 amount, uint8 status, uint64 placedAtBlock)",
    "function oracleSigner() view returns (address)"
  ];
}

// Vercel serverless function handler
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { betId } = req.body;

    if (!betId) {
      return res.status(400).json({ error: 'betId is required' });
    }

    // Environment variables
    const RPC_URL = process.env.RPC_URL;
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    const CONTRACT_ADDRESS = process.env.COINFLIP_ADDRESS;
    const SERVER_SEED = process.env.SERVER_SEED;
    const CHAIN_ID = Number(process.env.CHAIN_ID || process.env.VITE_CHAIN_ID || 763373);

    if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS || !SERVER_SEED) {
      return res.status(500).json({ 
        error: 'Missing required environment variables',
        required: ['RPC_URL', 'PRIVATE_KEY', 'COINFLIP_ADDRESS', 'SERVER_SEED']
      });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, coinFlipABI, wallet);

    // Verify oracle signer
    const onchainOracle = await contract.oracleSigner();
    if (onchainOracle.toLowerCase() !== wallet.address.toLowerCase()) {
      return res.status(500).json({ 
        error: 'Oracle signer mismatch',
        onchain: onchainOracle,
        wallet: wallet.address
      });
    }

    // Get bet info
    const betIdBigInt = BigInt(betId);
    const betInfo = await contract.bets(betIdBigInt);

    // Check if bet is pending
    if (Number(betInfo.status) !== 1) {
      return res.status(400).json({ 
        error: 'Bet is not pending',
        status: Number(betInfo.status),
        betId: betId
      });
    }

    // Get BetPlaced event to get clientSeed
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(Number(betInfo.placedAtBlock) - 100, 0);
    
    const filter = contract.filters.BetPlaced(betIdBigInt);
    const events = await contract.queryFilter(filter, fromBlock, currentBlock);
    
    if (events.length === 0) {
      return res.status(404).json({ error: 'BetPlaced event not found' });
    }

    const event = events[0];
    const parsed = contract.interface.parseLog(event);
    const [, , , , clientSeed] = parsed.args;

    // Generate random value
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const random = ethers.keccak256(
      abiCoder.encode(
        ["bytes32", "uint256", "uint256"],
        [SERVER_SEED, clientSeed, betIdBigInt]
      )
    );

    // Create message hash
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ["uint256", "bytes32"],
        [betIdBigInt, random]
      )
    );

    // Sign
    const signature = await wallet.signMessage(ethers.getBytes(msgHash));

    // Resolve bet
    const tx = await contract.resolveBet(betIdBigInt, random, signature, {
      gasLimit: 300000
    });

    const receipt = await tx.wait();

    if (receipt.status === 0) {
      return res.status(500).json({ error: 'Transaction reverted' });
    }

    return res.status(200).json({
      success: true,
      betId: betId,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      message: 'Bet resolved successfully'
    });

  } catch (error) {
    console.error('Error resolving bet:', error);
    return res.status(500).json({ 
      error: 'Failed to resolve bet',
      message: error.message
    });
  }
}

