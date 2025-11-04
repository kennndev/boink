import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useToast } from "@/hooks/use-toast";
import coinFlipABI from "../coinFlip.json";

interface CoinFlipProps {
  connectedWallet: string | null;
  walletProviders: Record<string, any>;
}

interface UserStats {
  plays: number;
  wins: number;
}

export const CoinFlip = ({ connectedWallet, walletProviders }: CoinFlipProps) => {
  const [selectedSide, setSelectedSide] = useState<"heads" | "tails" | null>(null);
  const [isFlipping, setIsFlipping] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const [animationResult, setAnimationResult] = useState<"heads" | "tails" | null>(null);
  const [selectedBetUsd, setSelectedBetUsd] = useState<1 | 2 | 3 | 4 | 5>(1);
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
  const { toast } = useToast();

  // Contract addresses
  const CONTRACT_ADDRESS = import.meta.env.VITE_COINFLIP_CONTRACT_ADDRESS || "0x952BAC90dfAb86006AC13B251057E208ceb3A9A3";
  const USDC_ADDRESS = import.meta.env.VITE_USDC_CONTRACT_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const EXPECTED_CHAIN_ID = import.meta.env.VITE_CHAIN_ID || "84532"; // Base Sepolia by default
  
  // Check if contract address is properly configured
  const isContractConfigured = CONTRACT_ADDRESS && CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";
  const isUsdcConfigured = USDC_ADDRESS && USDC_ADDRESS !== "0x0000000000000000000000000000000000000000";

  useEffect(() => {
    if (connectedWallet && walletProviders[connectedWallet] && isContractConfigured) {
      const ethereumProvider = walletProviders[connectedWallet];
      const browserProvider = new ethers.BrowserProvider(ethereumProvider);
      setProvider(browserProvider);

      // Verify contract exists and setup
      (async () => {
        try {
          // Log network information
          const network = await browserProvider.getNetwork();
          const currentChainId = network.chainId.toString();
          console.log("🌐 Connected to network:", {
            chainId: currentChainId,
            name: network.name,
          });
          
          // Check if on correct network
          if (currentChainId !== EXPECTED_CHAIN_ID) {
            console.error("❌ Wrong network! Expected:", EXPECTED_CHAIN_ID, "Got:", currentChainId);
            const networkNames: Record<string, string> = {
              "84532": "Base Sepolia",
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
            console.error("❌ CoinFlip contract not found at:", CONTRACT_ADDRESS);
            console.error("❌ You might be on the wrong network. Current chain ID:", currentChainId);
            setNetworkError(`Contract not found at ${CONTRACT_ADDRESS}`);
            setContractExists(false);
            toast({
              variant: "destructive",
              title: "Contract Not Found",
              description: `Contract not found. Please check configuration.`,
            });
            return;
          }
          console.log("✅ CoinFlip contract exists at:", CONTRACT_ADDRESS);
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
            console.log("✅ USDC address from contract:", tokenAddr);
            usdcAddress = tokenAddr;
          } catch (e) {
            console.warn("⚠️ Could not get token address from contract, using env var");
          }
          
          // Verify USDC contract exists
          const usdcCode = await browserProvider.getCode(usdcAddress);
          if (usdcCode === "0x" || usdcCode === "0x0") {
            console.error("❌ USDC contract not found at:", usdcAddress);
            toast({
              variant: "destructive",
              title: "USDC Contract Error",
              description: `USDC not found at ${usdcAddress}. Check your network.`,
            });
            return;
          }
          console.log("✅ USDC contract exists at:", usdcAddress);
          
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
          
          // Detect contract capabilities
          try {
            let amountFlipDetected = false;
            try {
              coinFlipContract.interface.getFunction("flip(uint8,uint256,uint256)");
              amountFlipDetected = true;
            } catch {}
            setHasAmountFlip(amountFlipDetected);
            console.log("✅ hasAmountFlip:", amountFlipDetected);

            let quoteDetected = false;
            try {
              coinFlipContract.interface.getFunction("quotePayout(uint256)");
              quoteDetected = true;
            } catch {}
            setHasQuotePayout(quoteDetected);
            console.log("✅ hasQuotePayout:", quoteDetected);
          } catch (e) {
            console.warn("⚠️ Capability detect error", e);
          }

          // Fetch max bet if available
          try {
            const mb = await coinFlipContract.maxBet();
            setMaxBetUnits(mb);
            console.log("✅ maxBet:", mb.toString());
          } catch {
            setMaxBetUnits(null);
            console.warn("⚠️ Could not fetch maxBet");
          }
          
        } catch (e) {
          console.error("❌ Setup error:", e);
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

  const ensureAllowance = async (needed: bigint, walletProvider: ethers.BrowserProvider, erc20: ethers.Contract) => {
    const signer = await walletProvider.getSigner();
    const owner = await signer.getAddress();
    const current = await (erc20 as any).allowance(owner, CONTRACT_ADDRESS);
    
    console.log("💰 Checking allowance:");
    console.log("  - Current allowance:", current.toString());
    console.log("  - Needed:", needed.toString());
    console.log("  - Owner:", owner);
    console.log("  - Spender (CoinFlip):", CONTRACT_ADDRESS);
    
    if (current >= needed) {
      console.log("✅ Sufficient allowance already exists");
      return true;
    }
    
    console.log("⚠️ Insufficient allowance, requesting approval...");
    toast({
      title: "Approval Required",
      description: "Please approve USDC spending in MetaMask",
    });
    
    try {
      // Approve a large amount (e.g., max uint256 or 1000 USDC) to avoid multiple approvals
      const approvalAmount = ethers.parseUnits("1000", usdcDecimals); // 1000 USDC
      console.log("📝 Requesting approval for:", approvalAmount.toString());
      
      const tx = await (erc20.connect(signer) as any).approve(CONTRACT_ADDRESS, approvalAmount);
      console.log("⏳ Approval transaction sent:", tx.hash);

      const receipt = await tx.wait();
      console.log("✅ Approval confirmed:", receipt.hash);
      
      // Verify the approval went through
      const newAllowance = await (erc20 as any).allowance(owner, CONTRACT_ADDRESS);
      console.log("✅ New allowance:", newAllowance.toString());
      
      toast({
        title: "Approval Successful",
        description: "You can now flip the coin!",
      });
 
    } catch (e: any) {
      console.error("❌ Approval error:", e);
      // Some ERC20s (incl. USDC) require setting allowance to 0 before updating
      try {
        console.log("🔄 Trying reset to 0 first...");
        const tx0 = await (erc20.connect(signer) as any).approve(CONTRACT_ADDRESS, 0);
        await tx0.wait();
        console.log("✅ Reset to 0 complete");
        
        const approvalAmount = ethers.parseUnits("1000", usdcDecimals);
        const tx1 = await (erc20.connect(signer) as any).approve(CONTRACT_ADDRESS, approvalAmount);
        await tx1.wait();
        console.log("✅ Approval complete after reset");
        
        toast({
          title: "Approval Successful",
          description: "You can now flip the coin!",
        });
      } catch (inner) {
        console.error("❌ Approval failed even after reset:", inner);
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
    console.log("=== FLIP BUTTON CLICKED ===");
    console.log("isContractConfigured:", isContractConfigured);
    console.log("contract:", contract);
    console.log("provider:", provider);
    console.log("selectedSide:", selectedSide);
    console.log("hasAmountFlip:", hasAmountFlip);
    console.log("contractExists:", contractExists);
    
    if (!isContractConfigured) {
      console.log("❌ Early return: contract not configured");
      return;
    }
    
    if (!contract || !provider || !selectedSide) {
      console.log("❌ Early return: missing contract/provider/side");
      return;
    }

    if (hasAmountFlip && (!isUsdcConfigured || !usdcContract)) {
      console.log("❌ Early return: USDC not configured but required");
      return;
    }

    console.log("✅ All checks passed, proceeding with flip");
    
    // Capture the guess BEFORE any state changes
    const currentGuess = selectedSide;

    
    setIsFlipping(true);
    setShowAnimation(true);
    
    try {
      // Get signer
      const signer = await provider.getSigner();
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
        // Ensure user balance
        const owner = await signer.getAddress();
        const bal = await (usdcContract as any).balanceOf(owner);
        console.log("💵 User USDC balance:", ethers.formatUnits(bal, usdcDecimals));
        
        if (bal < amountUnits) {
          console.error("❌ Insufficient USDC balance");
          toast({
            variant: "destructive",
            title: "Insufficient Balance",
            description: `You need ${ethers.formatUnits(amountUnits, usdcDecimals)} USDC`,
          });
          setIsFlipping(false);
          setShowAnimation(false);
          return;
        }
        
        // Check contract liquidity
        const contractBal = await (usdcContract as any).balanceOf(CONTRACT_ADDRESS);
        const requiredPayout = (amountUnits * 195n) / 100n;
        console.log("🏦 Contract USDC balance:", ethers.formatUnits(contractBal, usdcDecimals));
        console.log("💰 Required payout:", ethers.formatUnits(requiredPayout, usdcDecimals));
        
        if (contractBal < requiredPayout) {
          console.error("❌ Insufficient contract liquidity");
          toast({
            variant: "destructive",
            title: "Insufficient Liquidity",
            description: "Contract doesn't have enough USDC to pay winners",
          });
          setIsFlipping(false);
          setShowAnimation(false);
          return;
        }
        
        // Ensure allowance
        console.log("🔐 Ensuring USDC allowance...");
        try {
          await ensureAllowance(amountUnits, provider, usdcContract!);
          console.log("✅ Allowance ensured, proceeding with flip");
        } catch (approvalError: any) {
          console.error("❌ Approval failed or was rejected:", approvalError);
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
    
      
      // Call appropriate signature
      console.log("📤 Calling flip function...");
      console.log("  - hasAmountFlip:", hasAmountFlip);
      console.log("  - guess:", guess);
      console.log("  - userSeed:", userSeed);
      if (hasAmountFlip) {
        console.log("  - amountUnits:", amountUnits);
      }
      
      const tx = hasAmountFlip
        ? await (contractWithSigner as any).flip(guess, amountUnits, userSeed)
        : await (contractWithSigner as any).flip(guess, userSeed);
      
      console.log("✅ Transaction sent:", tx.hash);
 
      // Wait for transaction to be mined
      console.log("⏳ Waiting for transaction to be mined...");
      const receipt = await tx.wait();
      console.log("✅ Transaction mined:", receipt);
      
      // Find the FlipResult event
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = contract.interface.parseLog(log);
          return parsed?.name === "FlipResult";
        } catch {
          return false;
        }
      });
      
      if (event) {
        const parsed = contract.interface.parseLog(event);
        const { guess: contractGuess, outcome, won, amountIn, payoutTotal } = parsed.args as any;
        
        // Convert BigInt to number for comparison
        const guessNum = Number(contractGuess);
        const outcomeNum = Number(outcome);
        
        const guessSide = guessNum === 0 ? "heads" : "tails";
        const outcomeSide = outcomeNum === 0 ? "heads" : "tails";
        
        // Set animation result and wait for animation to complete
        setAnimationResult(outcomeSide);
        
        // Wait for animation to finish (3.5 seconds to match slower animation)
        await new Promise(resolve => setTimeout(resolve, 3500));
        
        // Use the captured guess to ensure accuracy
        setLastResult({
          guess: currentGuess, // Use our captured guess, not contract's (in case of conversion issues)
          outcome: outcomeSide,
          won: won
        });
        
        setShowAnimation(false);
        
        // Update stats
        await loadUserStats(contract);
        
        const winDesc = hasAmountFlip
          ? (won ? `Payout: ${payoutTotal ? ethers.formatUnits(payoutTotal, usdcDecimals) : expectedPayout} USDC` : `You guessed ${currentGuess}, outcome was ${outcomeSide}`)
          : `You guessed ${currentGuess}, outcome was ${outcomeSide}`;
      }
      
    } catch (error: any) {
      console.error("❌ FLIP ERROR:", error);
      console.error("Error code:", error.code);
      console.error("Error message:", error.message);
      
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

      {/* User Stats */}
      <div className="win98-border-inset p-4 bg-secondary">
        <h3 className="text-lg font-bold font-military text-gradient-blue mb-3">
          Your Stats
        </h3>
        {/* Bet amount picker */}
        <div className="mb-4">
          <div className="text-sm font-retro text-gray-700 mb-2">Choose Bet (USDC)</div>
          <div className="flex gap-2 justify-center">
            {[1,2,3,4,5].map((n) => (
              <button
                key={n}
                className={`win98-border px-2 py-1 text-xs font-pixel ${selectedBetUsd === n ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}
                onClick={() => setSelectedBetUsd(n as 1|2|3|4|5)}
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
