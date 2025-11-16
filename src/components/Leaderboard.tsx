import { useState, useEffect } from "react";
import { ethers } from "ethers";
import coinFlipArtifact from "../coinFlip.json";

// Type assertion for ABI - the JSON file is an array of ABI items
const coinFlipABI = coinFlipArtifact as any;

interface LeaderboardProps {
  connectedWallet: string | null;
  walletProviders: Record<string, any>;
}

interface PlayerStats {
  address: string;
  plays: number;
  wins: number;
  wagered: bigint;
  paidOut: bigint;
  winRate: number;
}

export const Leaderboard = ({ connectedWallet, walletProviders }: LeaderboardProps) => {
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"wins" | "wagered" | "plays" | "winRate">("wins");
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);

  const CONTRACT_ADDRESS = import.meta.env.VITE_COINFLIP_CONTRACT_ADDRESS || "";
  const EXPECTED_CHAIN_ID = import.meta.env.VITE_CHAIN_ID || "763373";

  useEffect(() => {
    if (connectedWallet && walletProviders[connectedWallet] && CONTRACT_ADDRESS) {
      const ethereumProvider = walletProviders[connectedWallet];
      const browserProvider = new ethers.BrowserProvider(ethereumProvider);
      setProvider(browserProvider);

      (async () => {
        try {
          const network = await browserProvider.getNetwork();
          const currentChainId = network.chainId.toString();

          if (currentChainId !== EXPECTED_CHAIN_ID) {
            setLoading(false);
            return;
          }

          // Create contract instance
          const coinFlipContract = new ethers.Contract(
            CONTRACT_ADDRESS,
            coinFlipABI,
            browserProvider
          );
          setContract(coinFlipContract);

          // Load leaderboard data
          await loadLeaderboard(coinFlipContract, browserProvider);
        } catch (e: any) {
          console.error("Leaderboard setup error:", e);
          setError(e?.message || "Failed to setup leaderboard");
          setLoading(false);
        }
      })();
    } else {
      setLoading(false);
    }
  }, [connectedWallet, walletProviders, CONTRACT_ADDRESS]);

  // Re-sort when sortBy changes
  useEffect(() => {
    if (players.length > 0 && !loading) {
      const sorted = [...players].sort((a, b) => {
        switch (sortBy) {
          case "wins":
            return b.wins - a.wins;
          case "wagered":
            return b.wagered > a.wagered ? 1 : b.wagered < a.wagered ? -1 : 0;
          case "plays":
            return b.plays - a.plays;
          case "winRate":
            return b.winRate - a.winRate;
          default:
            return 0;
        }
      });
      setPlayers(sorted);
    }
  }, [sortBy, loading]);

  const loadLeaderboard = async (contract: ethers.Contract, provider: ethers.BrowserProvider) => {
    try {
      setLoading(true);
      setError(null);
      console.log("📊 Loading leaderboard...");

      // Query FlipResult events to get all unique player addresses
      console.log("🔍 Creating event filter...");
      const filter = contract.filters.FlipResult();
      
      // Get current block number and query from last 10000 blocks to avoid querying all history
      console.log("🔍 Getting current block number...");
      const currentBlock = await provider.getBlockNumber();
      console.log(`📦 Current block: ${currentBlock}`);
      
      // Query from last 10000 blocks (or from block 0 if chain is shorter)
      const fromBlock = Math.max(0, currentBlock - 10000);
      console.log(`🔍 Querying events from block ${fromBlock} to ${currentBlock}...`);
      
      // Add timeout to prevent hanging
      const queryPromise = contract.queryFilter(filter, fromBlock, currentBlock);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Query timeout after 30 seconds")), 30000)
      );
      
      const events = await Promise.race([queryPromise, timeoutPromise]) as any[];
      console.log(`✅ Found ${events.length} events`);

      // Get unique player addresses from events
      const uniqueAddresses = new Set<string>();
      events.forEach((event: any) => {
        try {
          const parsed = contract.interface.parseLog(event);
          if (parsed && parsed.args && parsed.args.player) {
            uniqueAddresses.add(parsed.args.player);
          }
        } catch (e) {
          // Try direct access if parseLog fails
          if (event.args && event.args.player) {
            uniqueAddresses.add(event.args.player);
          }
        }
      });

      console.log(`👥 Found ${uniqueAddresses.size} unique players`);

      if (uniqueAddresses.size === 0) {
        console.log("⚠️ No players found in events");
        setPlayers([]);
        setLoading(false);
        return;
      }

      // Fetch stats for each player
      const playerStatsPromises = Array.from(uniqueAddresses).map(async (address) => {
        try {
          const stats = await contract.stats(address);
          const plays = Number(stats.plays ?? 0);
          const wins = Number(stats.wins ?? 0);
          const wagered = stats.wagered ?? 0n;
          const paidOut = stats.paidOut ?? 0n;
          const winRate = plays > 0 ? (wins / plays) * 100 : 0;

          return {
            address,
            plays,
            wins,
            wagered,
            paidOut,
            winRate,
          } as PlayerStats;
        } catch (e) {
          console.error(`Error fetching stats for ${address}:`, e);
          return null;
        }
      });

      const allStats = await Promise.all(playerStatsPromises);
      const validStats = allStats.filter((stat): stat is PlayerStats => stat !== null);
      console.log(`✅ Loaded stats for ${validStats.length} players`);

      // Sort players
      const sorted = [...validStats].sort((a, b) => {
        switch (sortBy) {
          case "wins":
            return b.wins - a.wins;
          case "wagered":
            return b.wagered > a.wagered ? 1 : b.wagered < a.wagered ? -1 : 0;
          case "plays":
            return b.plays - a.plays;
          case "winRate":
            return b.winRate - a.winRate;
          default:
            return 0;
        }
      });

      setPlayers(sorted);
    } catch (e: any) {
      console.error("❌ Error loading leaderboard:", e);
      setError(e?.message || "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatUSDC = (amount: bigint, decimals: number = 6) => {
    return ethers.formatUnits(amount, decimals);
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold font-pixel text-gradient-cyan mb-2">
          🏆 ONCHAIN LEADERBOARD 🏆
        </h2>
        <p className="text-sm font-retro text-muted-foreground">
          Top players ranked by their performance
        </p>
      </div>

      {/* Sort Options */}
      <div className="win98-border-inset p-3 bg-secondary">
        <div className="text-sm font-retro text-gray-700 mb-2">Sort By:</div>
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "wins" as const, label: "Wins" },
            { key: "wagered" as const, label: "Wagered" },
            { key: "plays" as const, label: "Plays" },
            { key: "winRate" as const, label: "Win Rate" },
          ].map((option) => (
            <button
              key={option.key}
              className={`win98-border px-3 py-1 text-xs font-pixel ${
                sortBy === option.key
                  ? "bg-blue-500 text-white"
                  : "bg-gray-200 text-gray-800 hover:bg-gray-300"
              }`}
              onClick={() => setSortBy(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="win98-border-inset p-3 bg-red-100 border-red-500">
          <p className="text-sm font-pixel text-red-700">❌ Error: {error}</p>
        </div>
      )}

      {/* Leaderboard Table */}
      {loading ? (
        <div className="win98-border-inset p-8 bg-secondary text-center">
          <p className="text-lg font-pixel text-gray-600">Loading leaderboard...</p>
        </div>
      ) : players.length === 0 ? (
        <div className="win98-border-inset p-8 bg-secondary text-center">
          <p className="text-lg font-pixel text-gray-600">No players found yet. Be the first!</p>
        </div>
      ) : (
        <div className="win98-border-inset p-4 bg-secondary">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-400">
                  <th className="text-left p-2 font-pixel text-sm">Rank</th>
                  <th className="text-left p-2 font-pixel text-sm">Address</th>
                  <th className="text-right p-2 font-pixel text-sm">Wins</th>
                  <th className="text-right p-2 font-pixel text-sm">Plays</th>
                  <th className="text-right p-2 font-pixel text-sm">Win Rate</th>
                  <th className="text-right p-2 font-pixel text-sm">Wagered</th>
                  <th className="text-right p-2 font-pixel text-sm">Paid Out</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player, index) => (
                  <tr
                    key={player.address}
                    className={`border-b border-gray-300 ${
                      connectedWallet?.toLowerCase() === player.address.toLowerCase()
                        ? "bg-blue-100"
                        : ""
                    }`}
                  >
                    <td className="p-2 font-pixel text-sm">
                      {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`}
                    </td>
                    <td className="p-2 font-retro text-xs font-mono">
                      {formatAddress(player.address)}
                    </td>
                    <td className="p-2 font-pixel text-sm text-right text-green-600 font-bold">
                      {player.wins}
                    </td>
                    <td className="p-2 font-pixel text-sm text-right">{player.plays}</td>
                    <td className="p-2 font-pixel text-sm text-right">
                      {player.winRate.toFixed(1)}%
                    </td>
                    <td className="p-2 font-pixel text-sm text-right">
                      {formatUSDC(player.wagered)}
                    </td>
                    <td className="p-2 font-pixel text-sm text-right text-green-600">
                      {formatUSDC(player.paidOut)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="win98-border p-3 bg-gray-100">
        <p className="text-xs font-retro text-gray-700">
          💡 Leaderboard data is fetched directly from the blockchain. Your address is highlighted in blue.
        </p>
      </div>
    </div>
  );
};

