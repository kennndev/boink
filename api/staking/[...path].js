// Vercel serverless function for all /api/staking/* routes
import mongoose from 'mongoose';
import { ethers } from 'ethers';
import { User } from '../../server/models/User.js';
import { Staking } from '../../server/models/Staking.js';
import { getPendingPoints, distributeStakingPoints } from '../../server/jobs/dailyPointsDistribution.js';

const CRON_CHAIN_SECRET = process.env.CRON_CHAIN_SECRET || '';
const CHAINED_CRON_ENABLED = process.env.CHAINED_CRON_ENABLED === 'true';
const CHAINED_CRON_MAX_HOPS = Number.parseInt(process.env.CHAINED_CRON_MAX_HOPS || '20', 10);

function getBaseUrl(req) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function triggerNextBatch(req, hop) {
  const baseUrl = getBaseUrl(req);
  const url = `${baseUrl}/api/staking/distribute-points?chain=1&hop=${hop + 1}`;
  const headers = {};
  if (CRON_CHAIN_SECRET) {
    headers['x-cron-secret'] = CRON_CHAIN_SECRET;
  }
  // Fire-and-forget: do NOT await — waiting for the chained response
  // holds this invocation open until the 60s Vercel timeout is hit.
  fetch(url, { method: 'GET', headers })
    .then(() => console.log(`[Daily Points] Triggered next batch: ${url}`))
    .catch(error => console.error('[Daily Points] Failed to trigger next batch:', error));
}

// MongoDB connection with serverless optimization
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  const MONGODB_URI = process.env.MONGODB_URI || '';

  try {
    const db = await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 1,
    });

    cachedDb = db;
    console.log('✅ Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    return null;
  }
}

// CORS headers
const setCORS = (res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// NFT Staking Contract ABI
const STAKING_ABI = [
  "function stakedTokensOf(address user) external view returns (uint256[])",
  "function stakedCount(address user) external view returns (uint256)"
];

const STAKING_CONTRACT_ADDRESS = process.env.VITE_STAKING_CONTRACT_ADDRESS || "";
const RPC_URL = process.env.VITE_RPC_URL || "";
const POINTS_PER_NFT_PER_DAY = 100;

function getStakingContract() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, STAKING_ABI, provider);
  return { contract, provider };
}

// Main handler
export default async (req, res) => {
  setCORS(res);

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Connect to database
  await connectToDatabase();

  // Parse path - remove /api/staking prefix
  const fullPath = req.url.split('?')[0];
  const path = fullPath.replace('/api/staking', '') || '/';
  const pathParts = path.split('/').filter(Boolean);

  // Route: GET/POST /distribute-points (Vercel Cron uses GET by default)
  if ((req.method === 'POST' || req.method === 'GET') && (pathParts[0] === 'distribute-points' || path === '/distribute-points')) {
    try {
      // Verify cron auth: Vercel sends "Authorization: Bearer <CRON_SECRET>", chained calls send "x-cron-secret"
      const vercelCronSecret = process.env.CRON_SECRET;
      const authHeader = req.headers['authorization'];
      const isVercelCron = vercelCronSecret && authHeader === `Bearer ${vercelCronSecret}`;
      const isChainedCron = CRON_CHAIN_SECRET && req.headers['x-cron-secret'] === CRON_CHAIN_SECRET;

      if (!isVercelCron && !isChainedCron) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const hop = Number.parseInt(req.query?.hop || '0', 10);
      const result = await distributeStakingPoints();

      // Respond immediately so Vercel doesn't count chain latency against this invocation's timeout.
      res.status(200).json({
        success: result.success,
        message: result.success
          ? `Distributed ${result.totalPointsDistributed} points to ${result.processed} wallets`
          : 'Distribution failed',
        data: result
      });

      if (
        CHAINED_CRON_ENABLED &&
        result?.hasMore &&
        Number.isFinite(hop) &&
        hop < CHAINED_CRON_MAX_HOPS
      ) {
        triggerNextBatch(req, hop);
      }

      return;
    } catch (error) {
      console.error('Error distributing points:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to distribute points',
        error: error.message
      });
    }
  }

  // Route: POST /record-stake
  if (req.method === 'POST' && (pathParts[0] === 'record-stake' || path === '/record-stake')) {
    try {
      const { walletAddress, tokenIds } = req.body || {};
      if (!walletAddress || !Array.isArray(tokenIds) || tokenIds.length === 0) {
        return res.status(400).json({ success: false, message: 'walletAddress and tokenIds[] required' });
      }

      const normalizedAddress = walletAddress.toLowerCase().trim();

      for (const tokenId of tokenIds) {
        const tokenIdStr = String(tokenId);
        const existing = await Staking.findOne({
          walletAddress: normalizedAddress,
          tokenId: tokenIdStr,
          isActive: true
        });

        if (existing) {
          continue;
        }

        await Staking.create({
          walletAddress: normalizedAddress,
          tokenId: tokenIdStr,
          stakedAt: new Date(),
          lastClaimAt: new Date(),
          isActive: true
        });
      }

      const { pendingPoints, stakedCount, nextDistribution } = await getPendingPoints(normalizedAddress);

      return res.status(200).json({
        success: true,
        message: 'Stake recorded',
        data: { stakedCount, pendingPoints, nextDistribution }
      });
    } catch (error) {
      console.error('Error recording stake:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to record stake',
        error: error.message
      });
    }
  }

  // Route: POST /record-unstake
  if (req.method === 'POST' && (pathParts[0] === 'record-unstake' || path === '/record-unstake')) {
    try {
      const { walletAddress, tokenIds } = req.body || {};
      if (!walletAddress || !Array.isArray(tokenIds) || tokenIds.length === 0) {
        return res.status(400).json({ success: false, message: 'walletAddress and tokenIds[] required' });
      }

      const normalizedAddress = walletAddress.toLowerCase().trim();
      const tokenIdStrs = tokenIds.map(id => String(id));
      const now = new Date();

      const stakeRecords = await Staking.find({
        walletAddress: normalizedAddress,
        tokenId: { $in: tokenIdStrs },
        isActive: true
      }).select('_id lastClaimAt');

      let unstakedPoints = 0;
      const stakingOps = [];

      for (const record of stakeRecords) {
        const days = (now.getTime() - record.lastClaimAt.getTime()) / 86400000;
        const pts = Math.floor(days * POINTS_PER_NFT_PER_DAY);
        if (pts > 0) unstakedPoints += pts;

        stakingOps.push({
          updateOne: {
            filter: { _id: record._id },
            update: { $set: { isActive: false, unstakedAt: now, lastClaimAt: now } }
          }
        });
      }

      if (stakingOps.length > 0) {
        await Staking.bulkWrite(stakingOps, { ordered: false });
      }

      if (unstakedPoints > 0) {
        await User.updateOne(
          { walletAddress: normalizedAddress },
          { $inc: { points: unstakedPoints } },
          { upsert: true }
        );
      }

      const { pendingPoints, stakedCount, nextDistribution } = await getPendingPoints(normalizedAddress);

      return res.status(200).json({
        success: true,
        message: 'Unstake recorded',
        data: {
          stakedCount,
          pendingPoints,
          nextDistribution,
          unstakedPointsAwarded: unstakedPoints
        }
      });
    } catch (error) {
      console.error('Error recording unstake:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to record unstake',
        error: error.message
      });
    }
  }

  // Route: GET /info/:walletAddress
  if (req.method === 'GET' && pathParts[0] === 'info' && pathParts[1]) {
    try {
      const walletAddress = pathParts[1];
      const normalizedAddress = walletAddress.toLowerCase().trim();

      const { pendingPoints, stakedCount, nextDistribution } = await getPendingPoints(normalizedAddress);

      const user = await User.findOne({ walletAddress: normalizedAddress });
      const totalPoints = user ? user.points : 0;

      return res.status(200).json({
        success: true,
        data: {
          walletAddress: normalizedAddress,
          stakedCount,
          pendingPoints,
          totalPoints,
          totalWithPending: totalPoints + pendingPoints,
          pointsPerDay: stakedCount * POINTS_PER_NFT_PER_DAY,
          nextDistribution
        }
      });
    } catch (error) {
      console.error('Error getting staking info:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get staking info',
        error: error.message
      });
    }
  }

  // Route: POST /sync/:walletAddress
  if (req.method === 'POST' && pathParts[0] === 'sync' && pathParts[1]) {
    try {
      const walletAddress = pathParts[1];
      const normalizedAddress = walletAddress.toLowerCase().trim();

      const { contract } = getStakingContract();
      let stakedTokenIds = [];

      try {
        const tokenIds = await contract.stakedTokensOf(normalizedAddress);
        stakedTokenIds = tokenIds.map(id => id.toString());
      } catch (error) {
        console.error('Error fetching staked tokens:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to fetch staking data from blockchain',
          error: error.message
        });
      }

      const dbStakedNFTs = await Staking.find({
        walletAddress: normalizedAddress,
        isActive: true
      });

      const dbStakedTokenIds = new Set(dbStakedNFTs.map(s => s.tokenId));
      const onChainStakedTokenIds = new Set(stakedTokenIds);

      const newlyStaked = stakedTokenIds.filter(id => !dbStakedTokenIds.has(id));
      const unstaked = Array.from(dbStakedTokenIds).filter(id => !onChainStakedTokenIds.has(id));

      // Add newly staked NFTs
      for (const tokenId of newlyStaked) {
        await Staking.create({
          walletAddress: normalizedAddress,
          tokenId,
          stakedAt: new Date(),
          lastClaimAt: new Date(),
          isActive: true
        });
      }

      // Mark unstaked NFTs as inactive and award points
      let unstakedPoints = 0;
      for (const tokenId of unstaked) {
        const stakeRecord = await Staking.findOne({
          walletAddress: normalizedAddress,
          tokenId,
          isActive: true
        });

        if (stakeRecord) {
          const now = Date.now();
          const timeElapsedMs = now - stakeRecord.lastClaimAt.getTime();
          const timeElapsedDays = timeElapsedMs / (1000 * 60 * 60 * 24);
          const pendingPoints = Math.floor(timeElapsedDays * POINTS_PER_NFT_PER_DAY);

          if (pendingPoints > 0) {
            unstakedPoints += pendingPoints;
          }

          stakeRecord.isActive = false;
          stakeRecord.unstakedAt = new Date();
          await stakeRecord.save();
        }
      }

      if (unstakedPoints > 0) {
        let user = await User.findOne({ walletAddress: normalizedAddress });
        if (!user) {
          user = new User({ walletAddress: normalizedAddress, points: 0 });
        }
        user.points += unstakedPoints;
        await user.save();
      }

      const { pendingPoints, stakedCount, nextDistribution } = await getPendingPoints(normalizedAddress);

      return res.status(200).json({
        success: true,
        message: 'Staking state synced',
        data: {
          stakedCount,
          newlyStaked: newlyStaked.length,
          unstaked: unstaked.length,
          unstakedPointsAwarded: unstakedPoints,
          pendingPoints,
          nextDistribution
        }
      });
    } catch (error) {
      console.error('Error syncing staking:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to sync staking state',
        error: error.message
      });
    }
  }

  // Route not found
  return res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.url
  });
};
