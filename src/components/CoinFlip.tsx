import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useToast } from "@/hooks/use-toast";
import coinFlipABI from "../coinFlip.json";
import { awardFlipPoints, getUser, getOracleStatus, getPendingBets, resolveBetImmediately } from "@/lib/api";

interface CoinFlipProps {
  connectedWallet: string | null;
  connectedWalletName?: string | null;
  walletProviders: Record<string, any>;
}

interface UserStats {
  plays: number;
  wins: number;
}

export const CoinFlip = ({ connectedWallet, connectedWalletName, walletProviders }: CoinFlipProps) => {
  const [selectedSide, setSelectedSide] = useState<"heads" | "tails" | null>(null);
  const [isFlipping, setIsFlipping] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const [animationResult, setAnimationResult] = useState<"heads" | "tails" | null>(null);
  const [selectedBetUsd, setSelectedBetUsd] = useState<1 | 5 | 10>(1);
  const [lastResult, setLastResult] = useState<{
    guess: "heads" | "tails";
    outcome: "heads" | "tails";
    won: boolean;
  } | null>(null);
  const [userStats, setUserStats] = useState<UserStats>({ plays: 0, wins: 0 });
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [usdcContract, setUsdcContract] = useState<ethers.Contract | null>(null);
  const [usdcDecimals, setUsdcDecimals] = useState<number>(6);
  const [expectedPayout, setExpectedPayout] = useState<string>("0");
  const [hasAmountFlip, setHasAmountFlip] = useState<boolean>(false);
  const [hasQuotePayout, setHasQuotePayout] = useState<boolean>(false);
  const [maxBetUnits, setMaxBetUnits] = useState<bigint | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [contractExists, setContractExists] = useState<boolean>(false);
  const [userPoints, setUserPoints] = useState<number>(0);
  const [oracleStatus, setOracleStatus] = useState<{ configured: boolean; pendingBets: number } | null>(null);
  const { toast } = useToast();

  // Contract addresses
  const CONTRACT_ADDRESS = import.meta.env.VITE_COINFLIP_CONTRACT_ADDRESS || "";
  const USDC_ADDRESS = import.meta.env.VITE_USDC_CONTRACT_ADDRESS || "";
  const EXPECTED_CHAIN_ID = import.meta.env.VITE_CHAIN_ID || "763373"; // Base Sepolia by default
  
  // Check if contract address is properly configured
  const isContractConfigured = CONTRACT_ADDRESS && CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";
  const isUsdcConfigured = USDC_ADDRESS && USDC_ADDRESS !== "0x0000000000000000000000000000000000000000";

  useEffect(() => {
    // Use wallet name to get provider, or try to find it by checking window.ethereum
    const walletName = connectedWalletName || "MetaMask"; // Default to MetaMask if not specified
    const ethereumProvider = walletProviders[walletName] || (window as any).ethereum;
    
    if (connectedWallet && ethereumProvider && isContractConfigured) {
      const browserProvider = new ethers.BrowserProvider(ethereumProvider);
      setProvider(browserProvider);

      // Verify contract exists and setup
      (async () => {
        try {
          // Log network information
          const network = await browserProvider.getNetwork();
          const currentChainId = network.chainId.toString();
       
          
          // Check if on correct network
          if (currentChainId !== EXPECTED_CHAIN_ID) {
            const networkNames: Record<string, string> = {
              "763373": "Ink Sepolia",
              "8453": "Base Mainnet",
              "1": "Ethereum Mainnet",
              "11155111": "Sepolia",
            };
            const expectedName = networkNames[EXPECTED_CHAIN_ID] || `Chain ${EXPECTED_CHAIN_ID}`;
            const currentName = networkNames[currentChainId] || `Chain ${currentChainId}`;
            
            setNetworkError(`Wrong network. Please switch to ${expectedName}`);
            setContractExists(false);
            
            toast({
              variant: "destructive",
              title: "Wrong Network",
              description: `Please switch from ${currentName} to ${expectedName} in your wallet.`,
              action: (
                <button
                  onClick={async () => {
                    try {
                      await ethereumProvider.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: `0x${parseInt(EXPECTED_CHAIN_ID).toString(16)}` }],
                      });
                    } catch (error: any) {
                      console.error("Failed to switch network:", error);
                    }
                  }}
                  className="px-3 py-1 bg-white text-black rounded hover:bg-gray-200"
                >
                  Switch
                </button>
              ),
            });
            return;
          }
          
          const code = await browserProvider.getCode(CONTRACT_ADDRESS);
          if (code === "0x" || code === "0x0") {
            setNetworkError(`Contract not found at ${CONTRACT_ADDRESS}`);
            setContractExists(false);
            toast({
              variant: "destructive",
              title: "Contract Not Found",
              description: `Contract not found. Please check configuration.`,
            });
            return;
          }
          setContractExists(true);
          setNetworkError(null);
          
          // Create contract instance
          const coinFlipContract = new ethers.Contract(
            CONTRACT_ADDRESS,
            coinFlipABI,
            browserProvider
          );
          setContract(coinFlipContract);
          
          // Get USDC address from the contract's token() function
          let usdcAddress = USDC_ADDRESS;
          try {
            const tokenAddr = await coinFlipContract.token();

            usdcAddress = tokenAddr;
          } catch (e) {
            console.warn("⚠️ Could not get token address from contract, using env var:", USDC_ADDRESS);
          }
          
          // Verify USDC contract exists
          const usdcCode = await browserProvider.getCode(usdcAddress);
          if (usdcCode === "0x" || usdcCode === "0x0") {
            toast({
              variant: "destructive",
              title: "USDC Contract Error",
              description: `USDC not found at ${usdcAddress}. Check your network.`,
            });
            return;
          }
          
          // Setup USDC contract
          const erc20Abi = [
            "function approve(address spender, uint256 value) external returns (bool)",
            "function allowance(address owner, address spender) external view returns (uint256)",
            "function balanceOf(address account) external view returns (uint256)",
            "function decimals() external view returns (uint8)"
          ];
          const usdc = new ethers.Contract(usdcAddress, erc20Abi, browserProvider);
          setUsdcContract(usdc);
          
          // Load user stats
          loadUserStats(coinFlipContract);
          
          // Load user points
          if (connectedWallet) {
            try {
              const userData = await getUser(connectedWallet);
              if (userData) {
                setUserPoints(userData.points);
              }
            } catch (error) {
              console.error('Error loading user points:', error);
            }
          }
          
          // Check oracle status
          try {
            const oracle = await getOracleStatus();
            const pending = await getPendingBets();
            if (oracle.data && pending.data) {
              setOracleStatus({
                configured: oracle.data.oracleConfigured,
                pendingBets: pending.data.pending
              });
              
              if (pending.data.pending > 0 && !oracle.data.oracleConfigured) {
                toast({
                  variant: "destructive",
                  title: "⚠️ Oracle Not Configured",
                  description: `There are ${pending.data.pending} pending bets. The oracle service needs to be running.`,
                });
              }
            }
          } catch (error) {
            console.error('Error checking oracle status:', error);
          }
          
          // Detect contract capabilities
          try {
            let amountFlipDetected = false;
            try {
              coinFlipContract.interface.getFunction("flip(uint8,uint256,uint256)");
              amountFlipDetected = true;
            } catch {}
            setHasAmountFlip(amountFlipDetected);

            let quoteDetected = false;
            try {
              coinFlipContract.interface.getFunction("quotePayout(uint256)");
              quoteDetected = true;
            } catch {}
            setHasQuotePayout(quoteDetected);
          } catch (e) {
            console.warn("⚠️ Capability detect error", e);
          }

          // Fetch max bet if available
          try {
            const mb = await coinFlipContract.maxBet();
            setMaxBetUnits(mb);
          } catch {
            setMaxBetUnits(null);
          }
          
        } catch (e) {
          setNetworkError("Failed to connect to contract");
          setContractExists(false);
          return;
        }
      })();
    } else if (connectedWallet && !isContractConfigured) {

    }
  }, [connectedWallet, walletProviders, CONTRACT_ADDRESS, isContractConfigured, toast, isUsdcConfigured, USDC_ADDRESS]);

  // Load decimals and payout preview when bet changes
  useEffect(() => {
    const fetchDecimalsAndPayout = async () => {
      if (!contract) return;
      try {
        // Prefer contract's decimals_ view; fallback to ERC20 decimals()
        let decimalsValue: number | null = null;
        try {
          const d = await contract.decimals_();
          decimalsValue = Number(d);
        } catch {
          // ignore
        }
        if (decimalsValue == null && usdcContract) {
          try {
            const d2 = await usdcContract.decimals();
            decimalsValue = Number(d2);
          } catch {
            // ignore
          }
        }
        const finalDecimals = Number.isFinite(decimalsValue) ? (decimalsValue as number) : 6;
        setUsdcDecimals(finalDecimals);

        if (hasAmountFlip && contractExists) {
          const betUnits = ethers.parseUnits(String(selectedBetUsd), finalDecimals);
          try {
            if (hasQuotePayout) {
              try {
                const payout = await contract.quotePayout(betUnits);
                setExpectedPayout(ethers.formatUnits(payout, finalDecimals));
              } catch (quoteErr) {
                // Fallback to 1.95x calculation
                const assumed = (betUnits * 195n) / 100n;
                setExpectedPayout(ethers.formatUnits(assumed, finalDecimals));
              }
            } else {
              // Use 1.95x payout
              const assumed = (betUnits * 195n) / 100n;
              setExpectedPayout(ethers.formatUnits(assumed, finalDecimals));
            }
          } catch (err) {
            const assumed = (betUnits * 195n) / 100n;
            setExpectedPayout(ethers.formatUnits(assumed, finalDecimals));
          }
        } else {
          setExpectedPayout("0");
        }
      } catch (e) {
        console.error("Failed loading decimals/payout", e);
      }
    };
    fetchDecimalsAndPayout();
  }, [contract, usdcContract, selectedBetUsd, hasAmountFlip, hasQuotePayout, contractExists]);

  const loadUserStats = async (contract: ethers.Contract) => {
    try {
      // New stats mapping: plays, wins, wagered, paidOut
      const signerAddr = provider ? await (await provider.getSigner()).getAddress() : undefined;
      if (!signerAddr) return;
      const s = await contract.stats(signerAddr);
      setUserStats({
        plays: Number(s.plays ?? 0),
        wins: Number(s.wins ?? 0)
      });
    } catch (error: any) {
      
      // Handle specific error cases
      if (error.code === "BAD_DATA" || error.message?.includes("could not decode result data")) {
    
      } else if (error.code === "CALL_EXCEPTION") {

      }
    }
  };

  const ensureAllowance = async (
    needed: bigint,
    walletProvider: ethers.BrowserProvider,
    erc20: ethers.Contract,
    ownerAddress: string
  ) => {
    const signer = await walletProvider.getSigner(ownerAddress);
    const owner = ownerAddress;
    const current = await (erc20 as any).allowance(owner, CONTRACT_ADDRESS);
        
    if (current >= needed) {
      return true;
    }
    
    toast({
      title: "Approval Required",
      description: "Please approve USDC spending in MetaMask",
    });
    
    try {
      // Approve a large amount (e.g., max uint256 or 1000 USDC) to avoid multiple approvals
      const approvalAmount = ethers.parseUnits("1000", usdcDecimals); // 1000 USDC
      
      const tx = await (erc20.connect(signer) as any).approve(CONTRACT_ADDRESS, approvalAmount);

      // OPTIMIZED: Wait for only 1 confirmation (fast enough, saves time)
      const receipt = await tx.wait(1);
      
      // Wait for blockchain state to update by polling allowance
      toast({
        title: "Processing Approval...",
        description: "Confirming USDC allowance on-chain",
      });
      
      let newAllowance = await (erc20 as any).allowance(owner, CONTRACT_ADDRESS);
      let attempts = 0;
      while (newAllowance < needed && attempts < 12) { // up to ~12s
        await new Promise(resolve => setTimeout(resolve, 1000));
        newAllowance = await (erc20 as any).allowance(owner, CONTRACT_ADDRESS);
        attempts += 1;
      }
      
      if (newAllowance < needed) {
 
        throw new Error("Approval succeeded but not yet visible. Please try again in a few seconds.");
      }
      
      toast({
        title: "Approval Successful",
        description: "You can now flip the coin!",
      });
 
    } catch (e: any) {
      console.error("❌ Approval error:", e);
      // Some ERC20s (incl. USDC) require setting allowance to 0 before updating
      try {
        const tx0 = await (erc20.connect(signer) as any).approve(CONTRACT_ADDRESS, 0);
        // OPTIMIZED: Wait for only 1 confirmation
        await tx0.wait(1);
        
        const approvalAmount = ethers.parseUnits("1000", usdcDecimals);
        const tx1 = await (erc20.connect(signer) as any).approve(CONTRACT_ADDRESS, approvalAmount);
        // OPTIMIZED: Wait for only 1 confirmation
        await tx1.wait(1);
        
        // Wait and verify
        await new Promise(resolve => setTimeout(resolve, 2000));
        const finalAllowance = await (erc20 as any).allowance(owner, CONTRACT_ADDRESS);
        
        if (finalAllowance < needed) {
          throw new Error("Approval failed even after reset");
        }
        
        toast({
          title: "Approval Successful",
          description: "You can now flip the coin!",
        });
      } catch (inner) {
        toast({
          variant: "destructive",
          title: "Approval Failed",
          description: "Could not approve USDC spending. Please try again.",
        });
        throw e;
      }
    }
    return true;
  };

  const handleFlip = async () => {
    // Debug logging
    console.log('Flip button clicked', {
      isContractConfigured,
      contract: !!contract,
      provider: !!provider,
      selectedSide,
      hasAmountFlip,
      isUsdcConfigured,
      usdcContract: !!usdcContract
    });

    if (!isContractConfigured) {
      toast({
        variant: "destructive",
        title: "Contract Not Configured",
        description: "CoinFlip contract address is not set. Please check your environment variables.",
      });
      return;
    }
    
    if (!contract || !provider || !selectedSide) {
      toast({
        variant: "destructive",
        title: "Missing Requirements",
        description: !selectedSide 
          ? "Please select heads or tails first" 
          : !contract || !provider 
          ? "Please connect your wallet first" 
          : "Something went wrong. Please try again.",
      });
      return;
    }

    if (hasAmountFlip && (!isUsdcConfigured || !usdcContract)) {
      toast({
        variant: "destructive",
        title: "USDC Not Configured",
        description: "USDC contract address is not set. Please check your environment variables.",
      });
      return;
    }

    
    // Capture the guess BEFORE any state changes
    const currentGuess = selectedSide;

    
    setIsFlipping(true);
    setShowAnimation(true);
    
    try {
      // Resolve a stable owner address and signer
      const accounts: string[] = await provider.send("eth_accounts", []);
      const ownerResolved = accounts?.[0] || (await (await provider.getSigner()).getAddress());
      const signer = await provider.getSigner(ownerResolved);
      const ownerAddress = await signer.getAddress();
      const contractWithSigner = contract.connect(signer);
      
      // Generate random seed
      const userSeed = Math.floor(Math.random() * 1000000);
      
      // Convert side to contract format (0 = heads, 1 = tails)
      const guess = currentGuess === "heads" ? 0 : 1;
      
      // Amount in USDC smallest units
      let amountUnits: bigint = 0n;
      if (hasAmountFlip) {
        amountUnits = ethers.parseUnits(String(selectedBetUsd), usdcDecimals);
        if (maxBetUnits && amountUnits > maxBetUnits) {
          setIsFlipping(false);
          setShowAnimation(false);
          return;
        }
        
        // OPTIMIZATION 1: Parallel balance/allowance checks (saves ~1s)
        const [bal, contractBal, currentAllowance] = await Promise.all([
          (usdcContract as any).balanceOf(ownerAddress),
          (usdcContract as any).balanceOf(CONTRACT_ADDRESS),
          (usdcContract as any).allowance(ownerAddress, CONTRACT_ADDRESS)
        ]);
        
        if (bal < amountUnits) {
          toast({
            variant: "destructive",
            title: "Insufficient Balance",
            description: `You need ${ethers.formatUnits(amountUnits, usdcDecimals)} USDC`,
          });
          setIsFlipping(false);
          setShowAnimation(false);
          return;
        }
        
        const requiredPayout = (amountUnits * 195n) / 100n;
        if (contractBal < requiredPayout) {
          toast({
            variant: "destructive",
            title: "Insufficient Liquidity",
            description: "Contract doesn't have enough USDC",
          });
          setIsFlipping(false);
          setShowAnimation(false);
          return;
        }
        
        // OPTIMIZATION 2: Only approve if needed
        if (currentAllowance < amountUnits) {
          try {
            await ensureAllowance(amountUnits, provider, usdcContract!, ownerAddress);
          } catch (approvalError: any) {
            setIsFlipping(false);
            setShowAnimation(false);
            if (approvalError.code === "ACTION_REJECTED") {
              toast({
                variant: "destructive",
                title: "Approval Rejected",
                description: "You must approve USDC spending to play",
              });
            }
            return;
          }
        }
      }
    
      // OPTIMIZATION 3: Skip gas estimation (use fixed value, saves ~500ms)
      const gasLimit = 250000n;
      
      // Place bet
      const placeBetTx = await (contractWithSigner as any).placeBet(guess, amountUnits, userSeed, { gasLimit });
      
      toast({
        title: "Bet Placing...",
        description: "Transaction sent",
      });
      
      // OPTIMIZATION 4: Get betId from logs immediately (no polling needed)
      const receipt = await placeBetTx.wait(1);
      const betPlacedEvent = receipt.logs.find((log: any) => {
        try {
          const parsed = contract.interface.parseLog(log);
          return parsed?.name === "BetPlaced";
        } catch {
          return false;
        }
      });
      
      if (!betPlacedEvent) {
        throw new Error("BetPlaced event not found");
      }
      
      const betPlacedParsed = contract.interface.parseLog(betPlacedEvent);
      const betId = betPlacedParsed.args.betId;
      
      toast({
        title: "Bet Placed!",
        description: "Resolving...",
      });
      
      // OPTIMIZATION: Call backend and use outcome immediately (no waiting for chain)
      const resolveResult = await resolveBetImmediately(betId, userSeed);
      
      // Handle already-resolved case (shouldn't happen for new bets, but handle gracefully)
      if (resolveResult.success && resolveResult.alreadyResolved && resolveResult.outcome !== undefined) {
        const outcomeSide = resolveResult.outcome === 0 ? "heads" : "tails" as "heads" | "tails";
        const won = (currentGuess === outcomeSide);
        
        setAnimationResult(outcomeSide);
        await new Promise(res => setTimeout(res, 1500));
        
        setLastResult({
          guess: currentGuess,
          outcome: outcomeSide,
          won,
        });
        
        setShowAnimation(false);
        loadUserStats(contract).catch(() => {});
        
        if (won) {
          toast({
            title: "🎉 You Won!",
            description: hasAmountFlip ? `Payout: ${expectedPayout} USDC` : `You correctly guessed ${outcomeSide}!`,
          });
        } else {
          toast({
            variant: "destructive",
            title: "You Lost",
            description: `The outcome was ${outcomeSide}`,
          });
        }
        return; // Exit early
      }
      
      if (!resolveResult.success) {
        // Fallback: try to poll on-chain as backup
        console.warn("Backend resolution failed, falling back to on-chain polling:", resolveResult.error);
        
        const MAX_WAIT_TIME = 30000;
        const POLL_INTERVAL = 2000;
        const startTime = Date.now();
        let resolved = false;
        
        while (!resolved && (Date.now() - startTime) < MAX_WAIT_TIME) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
          
          try {
            const betInfo = await contract.bets(betId);
            const status = Number(betInfo.status);
            
            if (status === 2) { // SETTLED
              resolved = true;
              const currentBlock = await provider.getBlockNumber();
              const placedBlock = Number(betInfo.placedAtBlock);
              const fromBlock = Math.max(placedBlock, receipt.blockNumber);
              const toBlock = Math.min(placedBlock + 5, currentBlock);
              
              const filter = contract.filters.BetResolved(betId);
              const events = await contract.queryFilter(filter, fromBlock, toBlock);
              
              if (events.length > 0) {
                const event = events[events.length - 1];
                const parsed = contract.interface.parseLog(event);
                const outcomeNum = Number(parsed.args[3]);
                const wonRaw = parsed.args[4];
                const payoutTotal = parsed.args[6];
                
                const won = typeof wonRaw === 'boolean' ? wonRaw : (wonRaw === 1n || wonRaw === 1);
                const outcomeSide = outcomeNum === 0 ? "heads" : "tails";
                
                setAnimationResult(outcomeSide);
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                setLastResult({
                  guess: currentGuess,
                  outcome: outcomeSide,
                  won: won
                });
                
                setShowAnimation(false);
                loadUserStats(contract).catch(() => {});
                
                if (ownerAddress) {
                  awardFlipPoints(ownerAddress).then(pointsResult => {
                    if (pointsResult.success && pointsResult.points !== undefined) {
                      setUserPoints(pointsResult.points);
                    }
                  }).catch(() => {});
                }
                
                if (won) {
                  const payoutAmount = hasAmountFlip && payoutTotal 
                    ? ethers.formatUnits(payoutTotal, usdcDecimals) 
                    : expectedPayout;
                  toast({
                    title: "🎉 You Won!",
                    description: hasAmountFlip ? `Payout: ${payoutAmount} USDC` : `You correctly guessed ${outcomeSide}!`,
                  });
                } else {
                  toast({
                    variant: "destructive",
                    title: "You Lost",
                    description: `The outcome was ${outcomeSide}`,
                  });
                }
              }
            }
          } catch (pollError) {
            console.error('Fallback polling error:', pollError);
          }
        }
        
        if (!resolved) {
          throw new Error("Bet resolution timeout");
        }
        return; // Exit early if we used fallback
      }
      
      // MAIN PATH: Use outcome from backend immediately (1-3 second UX)
      if (resolveResult.outcome === undefined) {
        throw new Error("Backend did not return outcome");
      }
      
      // Map backend's outcome to heads/tails (0 = heads, 1 = tails)
      const outcomeSide = resolveResult.outcome === 0 ? "heads" : "tails" as "heads" | "tails";
      const won = (currentGuess === outcomeSide);
      
      // Show result immediately with animation
      setAnimationResult(outcomeSide);
      await new Promise(res => setTimeout(res, 1500)); // 1.5s animation
      
      setLastResult({
        guess: currentGuess,
        outcome: outcomeSide,
        won,
      });
      
      setShowAnimation(false);
      
      // Background tasks (non-blocking)
      loadUserStats(contract).catch(() => {});
      
      if (ownerAddress) {
        awardFlipPoints(ownerAddress).then(pointsResult => {
          if (pointsResult.success && pointsResult.points !== undefined) {
            setUserPoints(pointsResult.points);
            toast({
              title: "🎉 Points Awarded!",
              description: `+${pointsResult.pointsAwarded} points! Total: ${pointsResult.points}`,
            });
          }
        }).catch(() => {});
      }
      
      // Show toasts
      if (won) {
        toast({
          title: "🎉 You Won!",
          description: hasAmountFlip
            ? `Payout: ${expectedPayout} USDC`
            : `You correctly guessed ${outcomeSide}!`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "You Lost",
          description: `The outcome was ${outcomeSide}`,
        });
      }
      
      // Background sanity check (fire and forget - doesn't block UX)
      (async () => {
        try {
          const MAX_BACKGROUND_WAIT = 60000;
          const start = Date.now();
          let resolved = false;
          
          while (!resolved && (Date.now() - start) < MAX_BACKGROUND_WAIT) {
            await new Promise(r => setTimeout(r, 2000));
            const betInfo = await contract.bets(betId);
            if (Number(betInfo.status) === 2) {
              resolved = true;
              console.log("✅ Background check: Bet confirmed on-chain");
            }
          }
          
          if (!resolved) {
            console.warn("⚠️ Background check: Bet not confirmed within timeout");
          }
        } catch (e) {
          console.warn("Background bet status check failed", e);
        }
      })();
      
    } catch (error: any) {
      
      let errorMessage = "Transaction failed";
      if (error.code === "ACTION_REJECTED") {
        errorMessage = "Transaction was rejected";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        variant: "destructive",
        title: "Flip Failed",
        description: errorMessage,
      });

    } finally {
      setIsFlipping(false);
      setShowAnimation(false);
      setAnimationResult(null);
    }
  };

  const getWinRate = () => {
    if (userStats.plays === 0) return "0%";
    return `${Math.round((userStats.wins / userStats.plays) * 100)}%`;
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold font-pixel text-gradient-cyan mb-2">
          🪙 COIN FLIP 🪙
        </h2>
        <p className="text-sm font-retro text-muted-foreground">
          Choose heads or tails and flip the coin!
        </p>
      </div>

      {/* Network Error Warning */}
      {networkError && (
        <div className="win98-border bg-red-100 p-3 border-red-500">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <p className="font-pixel text-red-700 text-sm font-bold">Network Issue</p>
              <p className="font-retro text-red-600 text-xs">{networkError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Oracle Status Warning */}
      {oracleStatus && !oracleStatus.configured && (
        <div className="win98-border bg-yellow-100 p-3 border-yellow-500">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <p className="font-pixel text-yellow-700 text-sm font-bold">Oracle Service Required</p>
              <p className="font-retro text-yellow-600 text-xs">
                {oracleStatus.pendingBets > 0 
                  ? `There ${oracleStatus.pendingBets === 1 ? 'is' : 'are'} ${oracleStatus.pendingBets} pending bet${oracleStatus.pendingBets === 1 ? '' : 's'}. The oracle service needs to be running to resolve bets.`
                  : 'The oracle service is not configured. Start it with: npm run dev:oracle'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* User Stats */}
      <div className="win98-border-inset p-4 bg-secondary">
        <h3 className="text-lg font-bold font-military text-gradient-blue mb-3">
          Your Stats
        </h3>
        {/* Points Display - Hidden */}
        {/* 
        {connectedWallet ? (
          <div className="mb-3 p-2 bg-gradient-to-r from-yellow-100 to-yellow-50 win98-border">
            <div className="flex items-center justify-between">
              <span className="text-sm font-pixel text-gray-700">💰 Points:</span>
              <span className="text-lg font-bold font-military text-gradient-yellow">{userPoints}</span>
            </div>
          </div>
        ) : null}
        */}
        {/* Bet amount picker */}
        <div className="mb-4">
          <div className="text-sm font-retro text-gray-700 mb-2">Choose Bet (USDC)</div>
          <div className="flex gap-2 justify-center">
            {[1,5,10].map((n) => (
              <button
                key={n}
                className={`win98-border px-2 py-1 text-xs font-pixel ${selectedBetUsd === n ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                onClick={() => setSelectedBetUsd(n as 1|5|10)}
                disabled={isFlipping}
              >
                ${n}
              </button>
            ))}
          </div>
          <div className="text-center text-xs mt-2 font-retro text-muted-foreground">
            Potential payout: <span className="font-bold text-green-600">{expectedPayout}</span> USDC
          </div>
          {maxBetUnits && (
            <div className="text-center text-[10px] mt-1 font-retro text-gray-500">
              Max bet: $5
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold font-pixel text-blue-500">
              {userStats.plays}
            </div>
            <div className="text-sm font-retro text-muted-foreground">Total Plays</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold font-pixel text-green-500">
              {userStats.wins}
            </div>
            <div className="text-sm font-retro text-muted-foreground">Wins</div>
          </div>
        </div>
        <div className="text-center mt-3">
          <div className="text-lg font-bold font-pixel text-purple-500">
            Win Rate: {getWinRate()}
          </div>
        </div>
      </div>

      {/* Side Selection */}
      <div className="win98-border-inset p-4">
        <h3 className="text-lg font-bold font-military text-gradient-orange mb-3">
          Choose Your Side
        </h3>
        <div className="flex gap-4 justify-center">
          <button
            className={`win98-border p-3 font-pixel transition-all flex flex-col items-center gap-2 ${
              selectedSide === "heads"
                ? "bg-blue-400 shadow-lg"
                : isContractConfigured ? "bg-gray-200 hover:bg-gray-300" : "bg-gray-100 cursor-not-allowed"
            }`}
            onClick={() => setSelectedSide("heads")}
            disabled={isFlipping || !isContractConfigured}
          >
            <img src="/head.png" alt="Heads" className="w-22 h-24 object-contain" />
            <span className="text-sm text-gray-800 font-bold">HEADS</span>
          </button>
          <button
            className={`win98-border p-3 font-pixel transition-all flex flex-col items-center gap-2 ${
              selectedSide === "tails"
                ? "bg-red-400 shadow-lg"
                : isContractConfigured ? "bg-gray-200 hover:bg-gray-300" : "bg-gray-100 cursor-not-allowed"
            }`}
            onClick={() => setSelectedSide("tails")}
            disabled={isFlipping || !isContractConfigured}
          >
            <img src="/tails.png" alt="Tails" className="w-22 h-24 object-contain" />
            <span className="text-sm text-gray-800 font-bold">TAILS</span>
          </button>
        </div>
      </div>

      {/* Coin Flip Animation */}
      {showAnimation && (
        <div className="win98-border-inset p-8 bg-gradient-to-b from-blue-100 to-blue-200 relative overflow-hidden min-h-[300px] flex items-center justify-center">
          <div className="absolute inset-0 flex items-center justify-center perspective-1000">
            <style>{`
              @keyframes coinFlipContinuous {
                0% {
                  transform: translateY(0) rotateX(0deg) scale(1);
                }
                25% {
                  transform: translateY(-120px) rotateX(180deg) scale(1.3);
                }
                50% {
                  transform: translateY(-160px) rotateX(360deg) scale(1.5);
                }
                75% {
                  transform: translateY(-120px) rotateX(540deg) scale(1.3);
                }
                100% {
                  transform: translateY(0) rotateX(720deg) scale(1);
                }
              }
              @keyframes coinFlipFinal {
                0% {
                  transform: translateY(-160px) rotateX(0deg) scale(1.5);
                }
                40% {
                  transform: translateY(-200px) rotateX(360deg) scale(1.6);
                }
                70% {
                  transform: translateY(-100px) rotateX(${animationResult === "heads" ? "720deg" : "900deg"}) scale(1.3);
                }
                85% {
                  transform: translateY(-30px) rotateX(${animationResult === "heads" ? "720deg" : "900deg"}) scale(1.1);
                }
                95% {
                  transform: translateY(-10px) rotateX(${animationResult === "heads" ? "720deg" : "900deg"}) scale(1.05);
                }
                100% {
                  transform: translateY(0) rotateX(${animationResult === "heads" ? "720deg" : "900deg"}) scale(1);
                }
              }
              .flipping-coin-continuous {
                animation: coinFlipContinuous 2.5s ease-in-out infinite;
                transform-style: preserve-3d;
              }
              .flipping-coin-final {
                animation: coinFlipFinal 3.5s ease-out;
                transform-style: preserve-3d;
              }
              .coin-face {
                position: absolute;
                width: 100%;
                height: 100%;
                backface-visibility: hidden;
              }
              .coin-heads {
                transform: rotateX(0deg);
              }
              .coin-tails {
                transform: rotateX(180deg);
              }
            `}</style>
            <div className={animationResult ? "flipping-coin-final relative w-32 h-32" : "flipping-coin-continuous relative w-32 h-32"} style={{ transformStyle: 'preserve-3d' }}>
              {animationResult ? (
                // When result is known, show the actual result
                <img 
                  src={animationResult === "heads" ? "/head.png" : "/tails.png"}
                  alt="Coin Result" 
                  className="w-full h-full object-contain drop-shadow-2xl"
                />
              ) : (
                // While flipping, show both sides alternating (realistic flip)
                <>
                  <img 
                    src="/head.png"
                    alt="Heads" 
                    className="coin-face coin-heads w-full h-full object-contain drop-shadow-2xl"
                  />
                  <img 
                    src="/tails.png"
                    alt="Tails" 
                    className="coin-face coin-tails w-full h-full object-contain drop-shadow-2xl"
                  />
                </>
              )}
            </div>
          </div>
          <div className="absolute bottom-4 left-0 right-0 text-center">
            <p className="text-lg font-pixel text-blue-700 animate-pulse">
              {animationResult ? "🎲 Landing... 🎲" : "🎲 Flipping in the air... 🎲"}
            </p>
          </div>
        </div>
      )}

      {/* Flip Button */}
      {!showAnimation && (
        <div className="text-center">
          <button
            className={`win98-border-inset p-4 text-xl font-pixel font-bold transition-all ${
              selectedSide && !isFlipping && isContractConfigured
                ? "bg-green-500 text-white hover:bg-green-600"
                : "bg-gray-400 text-gray-600 cursor-not-allowed"
            }`}
            onClick={handleFlip}
            disabled={!selectedSide || isFlipping || !isContractConfigured}
          >
            {isFlipping && !showAnimation ? "⏳ WAITING..." : "🚀 FLIP COIN"}
          </button>
        </div>
      )}

      {/* Last Result */}
      {lastResult && !showAnimation && (
        <div className="win98-border-inset p-4 bg-secondary">
          <h3 className="text-lg font-bold font-military text-gradient-purple mb-3">
            Last Result
          </h3>
          <div className="text-center space-y-3">
            <div className="flex justify-center gap-6">
              <div className="flex flex-col items-center gap-1">
                <img 
                  src={lastResult.guess === "heads" ? "/head.png" : "/tails.png"} 
                  alt={`You guessed ${lastResult.guess}`}
                  className="w-16 h-16 object-contain"
                />
                <p className="text-xs font-pixel text-gray-600">Your Guess</p>
              </div>
              <div className="flex items-center justify-center text-2xl">
                {lastResult.won ? "=" : "≠"}
              </div>
              <div className="flex flex-col items-center gap-1">
                <img 
                  src={lastResult.outcome === "heads" ? "/head.png" : "/tails.png"} 
                  alt={`Outcome was ${lastResult.outcome}`}
                  className="w-16 h-16 object-contain"
                />
                <p className="text-xs font-pixel text-gray-600">Result</p>
              </div>
            </div>
            <div className="text-lg font-pixel text-gray-800">
              You guessed: <span className="font-bold">{lastResult.guess.toUpperCase()}</span>
            </div>
            <div className="text-lg font-pixel text-gray-800">
              Outcome: <span className="font-bold">{lastResult.outcome.toUpperCase()}</span>
            </div>
            <div className="text-sm font-retro text-muted-foreground">
              Current choice: <span className="font-bold text-blue-600">{selectedSide?.toUpperCase()}</span>
            </div>
            <div className={`text-xl font-bold font-pixel ${
              lastResult.won ? "text-green-500" : "text-red-500"
            }`}>
              {lastResult.won ? "🎉 YOU WON!" : "😔 YOU LOST"}
            </div>
            
            {/* Action Buttons */}
            <div className="mt-4 pt-3 border-t border-gray-400 space-y-3">
              <div className="flex gap-3 justify-center">
                <button
                  className={`win98-border-inset p-3 text-lg font-pixel font-bold transition-all ${
                    !isFlipping && isContractConfigured
                      ? "bg-blue-500 text-white hover:bg-blue-600"
                      : "bg-gray-400 text-gray-600 cursor-not-allowed"
                  }`}
                  onClick={handleFlip}
                  disabled={isFlipping || !isContractConfigured}
                >
                  {isFlipping ? "🔄 FLIPPING..." : "🔄 FLIP AGAIN"}
                </button>
                
                <button
                  className={`win98-border p-2 text-sm font-pixel transition-all ${
                    !isFlipping && isContractConfigured
                      ? "bg-yellow-500 text-gray-800 hover:bg-yellow-600"
                      : "bg-gray-300 text-gray-500 cursor-not-allowed"
                  }`}
                  onClick={() => {
                    setSelectedSide(selectedSide === "heads" ? "tails" : "heads");
                  }}
                  disabled={isFlipping || !isContractConfigured}
                >
                  🔄 CHANGE CHOICE
                </button>
              </div>
              <p className="text-xs font-retro text-muted-foreground">
                Keep the same choice or switch sides
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="win98-border p-3 bg-gray-100">
        <h4 className="text-sm font-bold font-military text-blue-600 mb-2">
          How to Play:
        </h4>
        <ul className="text-xs font-retro text-gray-700 space-y-1">
          <li>• Connect your wallet to play</li>
          <li>• Choose heads or tails</li>
          <li>• Click "FLIP COIN" to play</li>
          <li>• Pay only gas fees - no additional cost!</li>
          <li>• Your stats are tracked on-chain</li>
        </ul>
      </div>
    </div>
  );
};
