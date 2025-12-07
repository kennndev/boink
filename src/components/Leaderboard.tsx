import { useState, useEffect } from "react";
import { ethers } from "ethers";
import coinFlipArtifact from "../coinFlip.json";
import { getLeaderboard } from "../lib/api";

// Type assertion for ABI - the JSON file is an array of ABI items
const coinFlipABI = coinFlipArtifact as any;

interface LeaderboardProps {
  connectedWallet: string | null;
  connectedWalletName?: string | null;
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

export const Leaderboard = ({ connectedWallet, connectedWalletName, walletProviders }: LeaderboardProps) => {
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"wins" | "plays" | "winRate">("wins");
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);

  const CONTRACT_ADDRESS = import.meta.env.VITE_COINFLIP_CONTRACT_ADDRESS || "";
  const EXPECTED_CHAIN_ID = import.meta.env.VITE_CHAIN_ID || "763373";

  useEffect(() => {
    if (connectedWallet && CONTRACT_ADDRESS) {
      // Get provider by wallet name, or fallback to window.ethereum
      const walletName = connectedWalletName || "MetaMask"; // Default to MetaMask if not specified
      const ethereumProvider = walletProviders[walletName] || (window as any).ethereum;
      
      if (!ethereumProvider || typeof ethereumProvider.request !== "function") {
        console.error("No wallet provider available");
        setError("Wallet provider not available");
        setLoading(false);
        return;
      }
      
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

      // Query BetResolved events to get all unique player addresses
      console.log("🔍 Creating event filter...");
      const filter = contract.filters.BetResolved();
      
      // Get current block number and query from block 0 to get all history
      console.log("🔍 Getting current block number...");
      const currentBlock = await provider.getBlockNumber();
      console.log(`📦 Current block: ${currentBlock}`);
      
      // Query from block 0 to get all events (or use a reasonable starting block if chain is very long)
      // For testnets, querying from 0 is usually fine. For mainnets, you might want to limit this.
      const fromBlock = 0;
      console.log(`🔍 Querying BetResolved events from block ${fromBlock} to ${currentBlock}...`);
      
      // Add timeout to prevent hanging (increase timeout for larger queries)
      const queryPromise = contract.queryFilter(filter, fromBlock, currentBlock);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Query timeout after 60 seconds")), 60000)
      );
      
      let events: any[] = [];
      try {
        events = await Promise.race([queryPromise, timeoutPromise]) as any[];
        console.log(`✅ Found ${events.length} BetResolved events`);
      } catch (queryError: any) {
        console.warn("⚠️ Error querying BetResolved events, trying BetPlaced events instead:", queryError);
        
        // Fallback: Try BetPlaced events instead
        try {
          const betPlacedFilter = contract.filters.BetPlaced();
          const betPlacedPromise = contract.queryFilter(betPlacedFilter, fromBlock, currentBlock);
          const betPlacedTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Query timeout")), 60000)
          );
          events = await Promise.race([betPlacedPromise, betPlacedTimeout]) as any[];
          console.log(`✅ Found ${events.length} BetPlaced events (using as fallback)`);
        } catch (fallbackError) {
          console.error("❌ Both BetResolved and BetPlaced queries failed:", fallbackError);
          throw new Error("Failed to query events from contract");
        }
      }

      // Get unique player addresses from events
      const uniqueAddresses = new Set<string>();
      events.forEach((event: any) => {
        try {
          const parsed = contract.interface.parseLog(event);
          if (parsed && parsed.args) {
            // BetResolved event args: [betId, player, guess, outcome, won, amount, payout, profit]
            // BetPlaced event args: [betId, player, guess, amount, clientSeed]
            // Try accessing by name first, then by index
            const player = parsed.args.player || parsed.args[1];
            if (player) {
              uniqueAddresses.add(player.toString().toLowerCase());
            }
          }
        } catch (e) {
          // Try direct access if parseLog fails
          if (event.args) {
            const player = event.args.player || event.args[1];
            if (player) {
              uniqueAddresses.add(player.toString().toLowerCase());
            }
          }
        }
      });

      console.log(`👥 Found ${uniqueAddresses.size} unique players from events`);

      // Fallback: If no events found, try getting addresses from backend database
      if (uniqueAddresses.size === 0) {
        console.log("⚠️ No players found in events, trying backend database as fallback...");
        try {
          const backendLeaderboard = await getLeaderboard(100); // Get up to 100 users
          backendLeaderboard.forEach((user) => {
            if (user.walletAddress) {
              uniqueAddresses.add(user.walletAddress.toLowerCase());
            }
          });
          console.log(`✅ Found ${uniqueAddresses.size} players from backend database`);
        } catch (backendError) {
          console.error("❌ Backend fallback also failed:", backendError);
        }
      }

      if (uniqueAddresses.size === 0) {
        console.log("⚠️ No players found in events or database");
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
    <div className="space-y-2 sm:space-y-4">
      <div className="text-center">
        <h2 className="text-lg sm:text-2xl font-bold font-pixel text-gradient-cyan mb-1 sm:mb-2">
          🏆 ONCHAIN LEADERBOARD 🏆
        </h2>
        <p className="text-xs sm:text-sm font-retro text-muted-foreground">
          Top players ranked by their performance
        </p>
      </div>

      {/* Sort Options */}
      <div className="win98-border-inset p-2 sm:p-3 bg-secondary">
        <div className="text-xs sm:text-sm font-retro text-gray-700 mb-1 sm:mb-2">Sort By:</div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 sm:gap-2">
          {[
            { key: "wins" as const, label: "Wins" },
            { key: "plays" as const, label: "Plays" },
            { key: "winRate" as const, label: "Win Rate" },
          ].map((option) => (
            <button
              key={option.key}
              className={`win98-border px-2 sm:px-3 py-1.5 sm:py-1 text-xs font-pixel ${
                sortBy === option.key
                  ? "bg-blue-500 text-gray-900 font-bold"
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
        <div className="win98-border-inset p-2 sm:p-3 bg-red-100 border-red-500">
          <p className="text-xs sm:text-sm font-pixel text-red-700">❌ Error: {error}</p>
        </div>
      )}

      {/* Leaderboard - Desktop Table / Mobile Cards */}
      {loading ? (
        <div className="win98-border-inset p-6 sm:p-8 bg-secondary text-center">
          <p className="text-sm sm:text-lg font-pixel text-gray-600">Loading leaderboard...</p>
        </div>
      ) : players.length === 0 ? (
        <div className="win98-border-inset p-6 sm:p-8 bg-secondary text-center">
          <p className="text-sm sm:text-lg font-pixel text-gray-600">No players found yet. Be the first!</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden sm:block win98-border-inset p-2 sm:p-4 bg-secondary">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-16" />
                  <col className="w-40" />
                  <col className="w-16" />
                  <col className="w-16" />
                  <col className="w-24" />
                  <col className="w-28" />
                </colgroup>
                <thead>
                  <tr className="border-b-2 border-gray-400">
                    <th className="text-left text-gray-600 p-2 font-pixel text-xs sm:text-sm">Rank</th>
                    <th className="text-left text-gray-600 p-2 font-pixel text-xs sm:text-sm">Address</th>
                    <th className="text-right text-gray-600 p-2 font-pixel text-xs sm:text-sm">Wins</th>
                    <th className="text-right text-gray-600 p-2 font-pixel text-xs sm:text-sm">Plays</th>
                    <th className="text-right text-gray-600 p-2 font-pixel text-xs sm:text-sm">Win Rate</th>
                    <th className="text-right text-gray-600 p-2 font-pixel text-xs sm:text-sm">Paid Out</th>
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
                      <td className="p-2 font-pixel text-xs sm:text-sm">
                        {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`}
                      </td>
                      <td className="p-2 font-retro text-xs font-mono truncate text-gray-600">
                        {formatAddress(player.address)}
                      </td>
                      <td className="p-2 font-pixel text-xs sm:text-sm text-right text-green-600 font-bold">
                        {player.wins}
                      </td>
                      <td className="p-2 font-pixel text-xs sm:text-sm text-right text-gray-800">
                        {player.plays}
                      </td>
                      <td className="p-2 font-pixel text-xs sm:text-sm text-right text-gray-800">
                        {player.winRate.toFixed(1)}%
                      </td>
                     
                      <td className="p-2 font-pixel text-xs sm:text-sm text-right text-green-600 truncate">
                        {formatUSDC(player.paidOut)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="sm:hidden space-y-2">
            {players.map((player, index) => (
              <div
                key={player.address}
                className={`win98-border-inset p-3 bg-secondary ${
                  connectedWallet?.toLowerCase() === player.address.toLowerCase()
                    ? "bg-blue-100"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-pixel text-base">
                      {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`}
                    </span>
                    <span className="font-retro text-xs font-mono text-gray-600">
                      {formatAddress(player.address)}
                    </span>
                  </div>
                  {connectedWallet?.toLowerCase() === player.address.toLowerCase() && (
                    <span className="text-xs font-pixel text-blue-600">(You)</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-retro text-gray-600">Wins:</span>
                    <span className="font-pixel text-green-600 font-bold">{player.wins}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-retro text-gray-600">Plays:</span>
                    <span className="font-pixel text-green-600">{player.plays}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-retro text-gray-600">Win Rate:</span>
                    <span className="font-pixel text-green-600">{player.winRate.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-retro text-gray-600">Paid Out:</span>
                    <span className="font-pixel text-green-600">{formatUSDC(player.paidOut)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Info */}
      <div className="win98-border p-2 sm:p-3 bg-gray-100">
        <p className="text-[10px] sm:text-xs font-retro text-gray-700">
          💡 Leaderboard data is fetched directly from the blockchain. Your address is highlighted in blue.
        </p>
      </div>
    </div>
  );
};

