import { ethers } from 'ethers';
import { User } from '../models/User.js';
import { Staking } from '../models/Staking.js';
import { StakingMeta } from '../models/StakingMeta.js';

const POINTS_PER_NFT_PER_DAY = 100;
const HARD_BUDGET_MS = 45_000; // stop well before Vercel's 60 s wall

// Contract configuration
const STAKING_ABI = [
  "function stakedTokensOf(address user) external view returns (uint256[])",
  "function stakedCount(address user) external view returns (uint256)"
];
const STAKING_CONTRACT_ADDRESS = process.env.VITE_STAKING_CONTRACT_ADDRESS || "";
const RPC_URL = process.env.VITE_RPC_URL || "https://rpc-gel-sepolia.inkonchain.com";
const SYNC_ONCHAIN_BEFORE_DISTRIBUTION = process.env.STAKING_SYNC_BEFORE_DISTRIBUTION === 'true';
const MAX_WALLETS_PER_RUN = Number.parseInt(process.env.MAX_WALLETS_PER_RUN || '50', 10);

function getStakingContract() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, STAKING_ABI, provider);
  return { contract, provider };
}

/**
 * Sync a user's staking state from the blockchain.
 * Accepts a pre-created contract instance so callers don't recreate a provider per wallet.
 */
async function syncUserStaking(walletAddress, contract) {
  const normalizedAddress = walletAddress.toLowerCase().trim();

  try {
    const tokenIds = await contract.stakedTokensOf(normalizedAddress);
    const stakedTokenIds = tokenIds.map(id => id.toString());

    const dbStakedNFTs = await Staking.find({ walletAddress: normalizedAddress, isActive: true });
    const dbStakedTokenIds = new Set(dbStakedNFTs.map(s => s.tokenId));
    const onChainStakedTokenIds = new Set(stakedTokenIds);

    const newlyStaked = stakedTokenIds.filter(id => !dbStakedTokenIds.has(id));
    const unstaked = Array.from(dbStakedTokenIds).filter(id => !onChainStakedTokenIds.has(id));

    for (const tokenId of newlyStaked) {
      await Staking.create({
        walletAddress: normalizedAddress,
        tokenId,
        stakedAt: new Date(),
        lastClaimAt: new Date(),
        isActive: true
      });
    }

    if (unstaked.length > 0) {
      const now = new Date();

      // Fetch the records we're about to close so we can calculate earned points
      const stakesToClose = await Staking.find({
        walletAddress: normalizedAddress,
        tokenId: { $in: unstaked },
        isActive: true
      }).select('_id lastClaimAt');

      let award = 0;
      const stakingOps = [];

      for (const s of stakesToClose) {
        const days = (now.getTime() - s.lastClaimAt.getTime()) / 86400000;
        const pts = Math.floor(days * POINTS_PER_NFT_PER_DAY);
        if (pts > 0) award += pts;

        stakingOps.push({
          updateOne: {
            filter: { _id: s._id },
            update: { $set: { isActive: false, unstakedAt: now, lastClaimAt: now } }
          }
        });
      }

      if (stakingOps.length > 0) {
        await Staking.bulkWrite(stakingOps, { ordered: false });
      }

      if (award > 0) {
        await User.updateOne(
          { walletAddress: normalizedAddress },
          { $inc: { points: award } },
          { upsert: true }
        );
        console.log(`[Sync] Awarded ${award} unstake points to ${normalizedAddress}`);
      }
    }

    return { synced: true, newlyStaked: newlyStaked.length, unstaked: unstaked.length };
  } catch (error) {
    console.error(`[Sync] Error syncing ${normalizedAddress}:`, error);
    return { synced: false, error: error.message };
  }
}

/**
 * Daily cron job to award points once per day.
 * Optional on-chain sync before distributing (see STAKING_SYNC_BEFORE_DISTRIBUTION).
 */
export async function distributeStakingPoints() {
  const jobStart = Date.now();
  console.log(`[Daily Points] Starting points distribution at ${new Date().toISOString()}`);

  try {
    // Step 1: Fetch only wallet addresses via distinct — no full document scan.
    // We only need active stakers for point distribution; include all users so
    // the cursor covers everyone who has ever connected.
    const [userWallets, stakingWallets] = await Promise.all([
      User.distinct('walletAddress'),
      Staking.distinct('walletAddress', { isActive: true }),
    ]);

    const walletSet = new Set();
    for (const w of userWallets) {
      const n = w?.toLowerCase().trim();
      if (n) walletSet.add(n);
    }
    for (const w of stakingWallets) {
      const n = w?.toLowerCase().trim();
      if (n) walletSet.add(n);
    }

    const uniqueWallets = Array.from(walletSet).sort();

    console.log(`[Daily Points] Found ${uniqueWallets.length} unique wallets (${userWallets.length} users, ${stakingWallets.length} active stakers)`);

    if (uniqueWallets.length === 0) {
      console.log('[Daily Points] No wallets found');
      return { success: true, processed: 0, totalPointsDistributed: 0 };
    }

    // Step 2: Batch selection with persistent cursor
    const batchingEnabled =
      Number.isFinite(MAX_WALLETS_PER_RUN) &&
      MAX_WALLETS_PER_RUN > 0 &&
      MAX_WALLETS_PER_RUN < uniqueWallets.length;

    let batchStartIndex = 0;

    if (batchingEnabled) {
      const cursor = await StakingMeta.findOne({ key: 'daily_points_cursor' });
      batchStartIndex = cursor?.value?.index ?? 0;
      if (batchStartIndex >= uniqueWallets.length) batchStartIndex = 0;
    }

    const walletsToProcess = batchingEnabled
      ? uniqueWallets.slice(batchStartIndex, batchStartIndex + MAX_WALLETS_PER_RUN)
      : uniqueWallets;

    const endIndex = batchStartIndex + walletsToProcess.length;
    // hasMore is true only if there are un-processed wallets further in the list this cycle
    const hasMore = batchingEnabled && endIndex < uniqueWallets.length;
    const nextCursorIndex = hasMore ? endIndex : 0;

    if (batchingEnabled) {
      await StakingMeta.findOneAndUpdate(
        { key: 'daily_points_cursor' },
        { value: { index: nextCursorIndex } },
        { upsert: true, new: true }
      );
      console.log(`[Daily Points] Processing batch ${batchStartIndex}..${endIndex - 1} (max ${MAX_WALLETS_PER_RUN})`);
    } else {
      console.log('[Daily Points] Processing all wallets (no batching)');
    }

    // Step 3: Optional on-chain sync — one provider/contract for the entire batch
    if (SYNC_ONCHAIN_BEFORE_DISTRIBUTION) {
      const { contract } = getStakingContract();
      for (const wallet of walletsToProcess) {
        if (Date.now() - jobStart > HARD_BUDGET_MS) {
          console.warn('[Daily Points] Approaching time budget, stopping sync early');
          break;
        }
        await syncUserStaking(wallet, contract);
      }
    } else {
      console.log('[Daily Points] Skipping on-chain sync (STAKING_SYNC_BEFORE_DISTRIBUTION=false)');
    }

    // Step 4: Fetch active staking records for this batch only
    const activeStakes = await Staking.find({
      isActive: true,
      walletAddress: { $in: walletsToProcess }
    });

    console.log(`[Daily Points] Found ${activeStakes.length} active staking records`);

    if (activeStakes.length === 0) {
      console.log('[Daily Points] No active stakes found');
      return {
        success: true,
        processed: 0,
        totalPointsDistributed: 0,
        batching: batchingEnabled,
        totalWallets: uniqueWallets.length,
        batchSize: walletsToProcess.length,
        nextCursorIndex,
        hasMore,
        timestamp: new Date().toISOString()
      };
    }

    // Step 5: Group stakes by wallet
    const walletStakes = new Map();
    for (const stake of activeStakes) {
      if (!walletStakes.has(stake.walletAddress)) walletStakes.set(stake.walletAddress, []);
      walletStakes.get(stake.walletAddress).push(stake);
    }

    // Step 6: Calculate points and build bulk ops (no per-document round trips)
    const now = new Date();
    const nowMs = now.getTime();
    const stakingBulkOps = [];
    const walletPointsMap = new Map();
    let totalPointsDistributed = 0;

    for (const [walletAddress, stakes] of walletStakes.entries()) {
      let walletPoints = 0;

      for (const stake of stakes) {
        const timeElapsedDays = (nowMs - stake.lastClaimAt.getTime()) / (1000 * 60 * 60 * 24);
        if (timeElapsedDays >= 1) {
          walletPoints += Math.floor(timeElapsedDays * POINTS_PER_NFT_PER_DAY);
          stakingBulkOps.push({
            updateOne: {
              filter: { _id: stake._id },
              update: { $set: { lastClaimAt: now } }
            }
          });
        }
      }

      if (walletPoints > 0) {
        walletPointsMap.set(walletAddress, { points: walletPoints, stakedCount: stakes.length });
        totalPointsDistributed += walletPoints;
      }
    }

    // Step 7: Two bulk writes — one for staking timestamps, one for user points
    if (stakingBulkOps.length > 0) {
      await Staking.bulkWrite(stakingBulkOps, { ordered: false });
    }

    if (walletPointsMap.size > 0) {
      await User.bulkWrite(
        Array.from(walletPointsMap.entries()).map(([walletAddress, { points }]) => ({
          updateOne: {
            filter: { walletAddress },
            update: { $inc: { points } },
            upsert: true
          }
        })),
        { ordered: false }
      );

      for (const [walletAddress, { points, stakedCount }] of walletPointsMap.entries()) {
        console.log(`[Daily Points] Awarded ${points} points to ${walletAddress} (${stakedCount} NFTs staked)`);
      }
    }

    const walletsProcessed = walletPointsMap.size;
    console.log(`[Daily Points] Completed: ${walletsProcessed} wallets processed, ${totalPointsDistributed} total points distributed`);

    return {
      success: true,
      processed: walletsProcessed,
      totalPointsDistributed,
      batching: batchingEnabled,
      totalWallets: uniqueWallets.length,
      batchSize: walletsToProcess.length,
      nextCursorIndex,
      hasMore,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[Daily Points] Error in daily distribution:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get pending points for a wallet (display only — does not claim).
 */
export async function getPendingPoints(walletAddress) {
  const normalizedAddress = walletAddress.toLowerCase().trim();

  const activeStakes = await Staking.find({ walletAddress: normalizedAddress, isActive: true });

  if (activeStakes.length === 0) {
    return { pendingPoints: 0, stakedCount: 0, nextDistribution: getNextDistributionTime() };
  }

  const now = Date.now();
  let totalPendingPoints = 0;

  for (const stake of activeStakes) {
    const timeElapsedDays = (now - stake.lastClaimAt.getTime()) / (1000 * 60 * 60 * 24);
    totalPendingPoints += timeElapsedDays * POINTS_PER_NFT_PER_DAY;
  }

  return {
    pendingPoints: Math.floor(totalPendingPoints),
    stakedCount: activeStakes.length,
    nextDistribution: getNextDistributionTime()
  };
}

function getNextDistributionTime() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  next.setDate(next.getDate() + 1);
  return {
    timestamp: next.toISOString(),
    hoursRemaining: Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60))
  };
}
