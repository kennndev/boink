"use client";
import React, { useEffect, useState, useRef } from "react";
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
  const [usdcDecimals, setUsdcDecimals] = useState<number>(6);
  const [expectedPayout, setExpectedPayout] = useState<string>("0");
  const [hasAmountFlip, setHasAmountFlip] = useState<boolean>(false);
  const [hasQuotePayout, setHasQuotePayout] = useState<boolean>(false);
  const [maxBetUnits, setMaxBetUnits] = useState<bigint | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [contractExists, setContractExists] = useState<boolean>(false);

  // Refs to pin the exact instances we use for reads/writes
  const providerRef = useRef<ethers.BrowserProvider | null>(null);
  const signerRef = useRef<ethers.Signer | null>(null);
  const coinFlipReadRef = useRef<ethers.Contract | null>(null);
  const coinFlipWriteRef = useRef<ethers.Contract | null>(null);
  const usdcReadRef = useRef<ethers.Contract | null>(null);
  const { toast } = useToast();

  // Addresses / chain
  const CONTRACT_ADDRESS = import.meta.env.VITE_COINFLIP_CONTRACT_ADDRESS || "0x952BAC90dfAb86006AC13B251057E208ceb3A9A3";
  const USDC_ADDRESS_ENV = import.meta.env.VITE_USDC_CONTRACT_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const EXPECTED_CHAIN_ID = (import.meta.env.VITE_CHAIN_ID || "84532").toString(); // Base Sepolia
  const isContractConfigured = CONTRACT_ADDRESS && CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";

  // ---------- Helpers ----------
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const waitBlocks = async (blocks: number) => {
    const provider = providerRef.current!;
    const start = await provider.getBlockNumber();
    while ((await provider.getBlockNumber()) < start + blocks) {
      await sleep(800);
    }
  };

  const getSignerAddress = async (): Promise<string | null> => {
    try {
      const signer = signerRef.current!;
      return (await signer.getAddress()) ?? null;
    } catch {
      return null;
    }
  };

  const loadUserStats = async () => {
    try {
      const read = coinFlipReadRef.current;
      const signerAddr = await getSignerAddress();
      if (!read || !signerAddr) return;
      const s = await read.stats(signerAddr);
      setUserStats({
        plays: Number(s.plays ?? 0),
        wins: Number(s.wins ?? 0),
      });
    } catch (error: any) {
      // silent: contract might not expose stats yet
    }
  };

  // ---------- Bootstrap provider, signer, contracts ----------
  useEffect(() => {
    (async () => {
      if (!connectedWallet || !walletProviders[connectedWallet] || !isContractConfigured) {
        return;
      }

      const ethereumProvider = walletProviders[connectedWallet];
      // Pin the exact injected provider; do not rely on window.ethereum
      const browserProvider = new ethers.BrowserProvider(ethereumProvider, "any");
      providerRef.current = browserProvider;

      try {
        // Network check
        const network = await browserProvider.getNetwork();
        const currentChainId = network.chainId.toString();

        if (currentChainId !== EXPECTED_CHAIN_ID) {
          const map: Record<string, string> = {
            "84532": "Base Sepolia",
            "8453": "Base Mainnet",
            "1": "Ethereum",
            "11155111": "Sepolia",
          };
          const expectedName = map[EXPECTED_CHAIN_ID] || `Chain ${EXPECTED_CHAIN_ID}`;
          const currentName = map[currentChainId] || `Chain ${currentChainId}`;
          setNetworkError(`Wrong network. Please switch to ${expectedName} (current: ${currentName}).`);
          setContractExists(false);
          return;
        }

        // Signer (pin it once)
        const signer = await browserProvider.getSigner();
        signerRef.current = signer;

        // Sanity: signer address must match the provider accounts[0]
        try {
          const [accFromProvider] = await ethereumProvider.request({ method: "eth_accounts" });
          const signerAddr = await signer.getAddress();
          if ((accFromProvider ?? "").toLowerCase() !== signerAddr.toLowerCase()) {
            throw new Error("Signer/account mismatch with selected wallet provider");
          }
        } catch (mismatch) {
          setNetworkError("Wallet account mismatch; reconnect your wallet.");
          setContractExists(false);
          return;
        }

        // Verify coinflip contract code
        const code = await browserProvider.getCode(CONTRACT_ADDRESS);
        if (!code || code === "0x" || code === "0x0") {
          setNetworkError(`Contract not found at ${CONTRACT_ADDRESS}`);
          setContractExists(false);
          return;
        }
        setNetworkError(null);
        setContractExists(true);

        // Build read + write instances (write bound to signer)
        const coinFlipRead = new ethers.Contract(CONTRACT_ADDRESS, coinFlipABI, browserProvider);
        const coinFlipWrite = new ethers.Contract(CONTRACT_ADDRESS, coinFlipABI, signer);
        coinFlipReadRef.current = coinFlipRead;
        coinFlipWriteRef.current = coinFlipWrite;

        // Discover USDC address from contract.token(); fallback to env
        let usdcAddress = USDC_ADDRESS_ENV;
        try {
          const t = await coinFlipRead.token();
          if (ethers.isAddress(t)) usdcAddress = t;
        } catch {
          // stick with env
        }

        // Verify USDC contract code
        const usdcCode = await browserProvider.getCode(usdcAddress);
        if (!usdcCode || usdcCode === "0x" || usdcCode === "0x0") {
          setNetworkError(`USDC not found at ${usdcAddress}`);
          return;
        }

        // Minimal ERC20 ABI for reads
        const erc20Abi = [
          "function approve(address spender, uint256 value) external returns (bool)",
          "function allowance(address owner, address spender) external view returns (uint256)",
          "function balanceOf(address account) external view returns (uint256)",
          "function decimals() external view returns (uint8)",
        ];
        usdcReadRef.current = new ethers.Contract(usdcAddress, erc20Abi, browserProvider);

        // Detect capabilities
        let amountFlipDetected = false;
        try {
          coinFlipRead.interface.getFunction("flip(uint8,uint256,uint256)");
          amountFlipDetected = true;
        } catch {}
        setHasAmountFlip(amountFlipDetected);

        let quoteDetected = false;
        try {
          coinFlipRead.interface.getFunction("quotePayout(uint256)");
          quoteDetected = true;
        } catch {}
        setHasQuotePayout(quoteDetected);

        // Max bet
        try {
          const mb = await coinFlipRead.maxBet();
          setMaxBetUnits(mb);
        } catch {
          setMaxBetUnits(null);
        }

        // Decimals
        try {
          let d: number | null = null;
          try {
            const dx = await coinFlipRead.decimals_();
            d = Number(dx);
          } catch {}
          if (d == null && usdcReadRef.current) {
            const du = await usdcReadRef.current.decimals();
            d = Number(du);
          }
          setUsdcDecimals(Number.isFinite(d) ? (d as number) : 6);
        } catch {
          setUsdcDecimals(6);
        }

        // Initial stats
        await loadUserStats();
      } catch (e) {
        setNetworkError("Failed to connect to contract");
        setContractExists(false);
      }
    })();
  }, [connectedWallet, walletProviders, isContractConfigured, EXPECTED_CHAIN_ID, CONTRACT_ADDRESS, USDC_ADDRESS_ENV]);

  // ---------- Recompute expected payout ----------
  useEffect(() => {
    (async () => {
      const read = coinFlipReadRef.current;
      if (!read || !contractExists) {
        setExpectedPayout("0");
        return;
      }
      try {
        if (!hasAmountFlip) {
          setExpectedPayout("0");
          return;
        }
        const betUnits = ethers.parseUnits(String(selectedBetUsd), usdcDecimals);
        if (hasQuotePayout) {
          try {
            const payout = await read.quotePayout(betUnits);
            setExpectedPayout(ethers.formatUnits(payout, usdcDecimals));
            return;
          } catch {}
        }
        // fallback 1.95x
        const assumed = (betUnits * 195n) / 100n;
        setExpectedPayout(ethers.formatUnits(assumed, usdcDecimals));
      } catch {
        setExpectedPayout("0");
      }
    })();
  }, [selectedBetUsd, hasAmountFlip, hasQuotePayout, usdcDecimals, contractExists]);

  // ---------- Allowance flow with 2-block settle ----------
  const ensureAllowance = async (needed: bigint) => {
    const provider = providerRef.current!;
    const signer = signerRef.current!;
    const usdcRead = usdcReadRef.current!;
    const owner = await signer.getAddress();

    const current = await usdcRead.allowance(owner, CONTRACT_ADDRESS);
    if (current >= needed) return;

    toast({ title: "Approval Required", description: "Approve USDC spending to play." });

    const usdcWrite = usdcRead.connect(signer);
    try {
      // Approve larger amount (1000 USDC) to avoid re-approvals
      const approvalAmount = ethers.parseUnits("1000", usdcDecimals);
      const tx = await usdcWrite.approve(CONTRACT_ADDRESS, approvalAmount);
      await tx.wait();

      // wait 2 blocks for cross-node visibility
      await waitBlocks(2);

      // verify
      const after = await usdcRead.allowance(owner, CONTRACT_ADDRESS);
      if (after < needed) {
        // Some USDC variants require reset to 0 first
        const tx0 = await usdcWrite.approve(CONTRACT_ADDRESS, 0);
        await tx0.wait();
        await waitBlocks(2);

        const tx1 = await usdcWrite.approve(CONTRACT_ADDRESS, approvalAmount);
        await tx1.wait();
        await waitBlocks(2);

        const finalA = await usdcRead.allowance(owner, CONTRACT_ADDRESS);
        if (finalA < needed) throw new Error("Allowance not visible yet. Try again.");
      }

      toast({ title: "Approval Successful", description: "You can flip now." });
    } catch (err: any) {
      throw err;
    }
  };

  // ---------- Flip ----------
  const handleFlip = async () => {
    if (!isContractConfigured) return;
    if (!coinFlipWriteRef.current || !coinFlipReadRef.current || !providerRef.current) return;
    if (!selectedSide) return;

    const read = coinFlipReadRef.current;
    const write = coinFlipWriteRef.current;
    const provider = providerRef.current;
    const usdcRead = usdcReadRef.current;

    setIsFlipping(true);
    setShowAnimation(true);

    try {
      const signerAddr = await (await provider.getSigner()).getAddress();
      const guess = selectedSide === "heads" ? 0 : 1;
      const userSeed = Math.floor(Math.random() * 1_000_000);

      // If amount-flip, validate balances, liquidity, and allowance
      let amountUnits: bigint = 0n;
      let args: any[] = [];
      let funcKey = "flip(uint8,uint256)"; // default signature if !hasAmountFlip

      if (hasAmountFlip) {
        if (!usdcRead) throw new Error("USDC not configured.");
        amountUnits = ethers.parseUnits(String(selectedBetUsd), usdcDecimals);

        if (maxBetUnits && amountUnits > maxBetUnits) {
          toast({ variant: "destructive", title: "Max Bet Exceeded", description: "Reduce your bet." });
          setIsFlipping(false);
          setShowAnimation(false);
          return;
        }

        const bal = await usdcRead.balanceOf(signerAddr);
        if (bal < amountUnits) {
          toast({
            variant: "destructive",
            title: "Insufficient Balance",
            description: `Need ${ethers.formatUnits(amountUnits, usdcDecimals)} USDC`,
          });
          setIsFlipping(false);
          setShowAnimation(false);
          return;
        }

        // contract liquidity check (1.95x fallback)
        const contractBal = await usdcRead.balanceOf(CONTRACT_ADDRESS);
        const requiredPayout = (amountUnits * 195n) / 100n;
        if (contractBal < requiredPayout) {
          toast({
            variant: "destructive",
            title: "Insufficient Liquidity",
            description: "Contract lacks enough USDC to pay winners.",
          });
          setIsFlipping(false);
          setShowAnimation(false);
          return;
        }

        // Ensure allowance w/ settle wait
        await ensureAllowance(amountUnits);

        args = [guess, amountUnits, userSeed];
        funcKey = "flip(uint8,uint256,uint256)";
      } else {
        args = [guess, userSeed];
        funcKey = "flip(uint8,uint256)";
      }

      // ---- Simulate & estimate before sending (prevents mystery reverts)
      // staticCall
      await (write as any)[funcKey].staticCall(...args);
      // estimate gas
      await (write as any)[funcKey].estimateGas(...args);

      // Defensive encode to guarantee non-empty calldata
      const data = read.interface.encodeFunctionData(funcKey, args);
      if (!data || data === "0x") {
        throw new Error("Flip calldata build failed.");
      }

      // Send using the normal contract method (has nonce, gas, etc.)
      const tx = await (write as any)[funcKey](...args);
      const receipt = await tx.wait();

      // Parse FlipResult event
      const eventLog = receipt.logs.find((log: any) => {
        try {
          const parsed = read.interface.parseLog(log);
          return parsed?.name === "FlipResult";
        } catch {
          return false;
        }
      });

      if (eventLog) {
        const parsed = read.interface.parseLog(eventLog);
        const { outcome, won } = parsed.args as any;
        const outcomeSide: "heads" | "tails" = Number(outcome) === 0 ? "heads" : "tails";

        setAnimationResult(outcomeSide);
        await sleep(3500);

        setLastResult({
          guess: selectedSide,
          outcome: outcomeSide,
          won: Boolean(won),
        });

        setShowAnimation(false);
        await loadUserStats();
      } else {
        // If no event (edge), still stop animation to avoid hanging UI
        setAnimationResult(null);
        setShowAnimation(false);
      }
    } catch (error: any) {
      // Fetch tx input if available to verify we didn't send empty data
      try {
        if (error?.transaction?.hash) {
          const txOnChain = await providerRef.current!.getTransaction(error.transaction.hash);
          console.log("flip tx input length:", txOnChain?.data?.length);
        }
      } catch {}

      const msg =
        error?.shortMessage ||
        error?.reason ||
        error?.message ||
        "Flip failed. Try again in a moment.";

      toast({
        variant: "destructive",
        title: "Flip Failed",
        description: msg,
      });
    } finally {
      setIsFlipping(false);
      setAnimationResult(null);
      setShowAnimation(false);
    }
  };

  const getWinRate = () => {
    if (userStats.plays === 0) return "0%";
    return `${Math.round((userStats.wins / userStats.plays) * 100)}%`;
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold font-pixel text-gradient-cyan mb-2">🪙 COIN FLIP 🪙</h2>
        <p className="text-sm font-retro text-muted-foreground">Choose heads or tails and flip the coin!</p>
      </div>

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

      <div className="win98-border-inset p-4 bg-secondary">
        <h3 className="text-lg font-bold font-military text-gradient-blue mb-3">Your Stats</h3>

        <div className="mb-4">
          <div className="text-sm font-retro text-gray-700 mb-2">Choose Bet (USDC)</div>
          <div className="flex gap-2 justify-center">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`win98-border px-2 py-1 text-xs font-pixel ${
                  selectedBetUsd === n ? "bg-emerald-500 text-white" : "bg-gray-200 text-gray-800 hover:bg-gray-300"
                }`}
                onClick={() => setSelectedBetUsd(n as 1 | 2 | 3 | 4 | 5)}
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
            <div className="text-center text-[10px] mt-1 font-retro text-gray-500">Max bet: $5</div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold font-pixel text-blue-500">{userStats.plays}</div>
            <div className="text-sm font-retro text-muted-foreground">Total Plays</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold font-pixel text-green-500">{userStats.wins}</div>
            <div className="text-sm font-retro text-muted-foreground">Wins</div>
          </div>
        </div>
        <div className="text-center mt-3">
          <div className="text-lg font-bold font-pixel text-purple-500">Win Rate: {getWinRate()}</div>
        </div>
      </div>

      <div className="win98-border-inset p-4">
        <h3 className="text-lg font-bold font-military text-gradient-orange mb-3">Choose Your Side</h3>
        <div className="flex gap-4 justify-center">
          <button
            className={`win98-border p-3 font-pixel transition-all flex flex-col items-center gap-2 ${
              selectedSide === "heads" ? "bg-blue-400 shadow-lg" : contractExists ? "bg-gray-200 hover:bg-gray-300" : "bg-gray-100 cursor-not-allowed"
            }`}
            onClick={() => setSelectedSide("heads")}
            disabled={isFlipping || !contractExists}
          >
            <img src="/head.png" alt="Heads" className="w-22 h-24 object-contain" />
            <span className="text-sm text-gray-800 font-bold">HEADS</span>
          </button>
          <button
            className={`win98-border p-3 font-pixel transition-all flex flex-col items-center gap-2 ${
              selectedSide === "tails" ? "bg-red-400 shadow-lg" : contractExists ? "bg-gray-200 hover:bg-gray-300" : "bg-gray-100 cursor-not-allowed"
            }`}
            onClick={() => setSelectedSide("tails")}
            disabled={isFlipping || !contractExists}
          >
            <img src="/tails.png" alt="Tails" className="w-22 h-24 object-contain" />
            <span className="text-sm text-gray-800 font-bold">TAILS</span>
          </button>
        </div>
      </div>

      {showAnimation && (
        <div className="win98-border-inset p-8 bg-gradient-to-b from-blue-100 to-blue-200 relative overflow-hidden min-h-[300px] flex items-center justify-center">
          <div className="absolute inset-0 flex items-center justify-center perspective-1000">
            <style>{`
              @keyframes coinFlipContinuous {
                0% { transform: translateY(0) rotateX(0deg) scale(1); }
                25% { transform: translateY(-120px) rotateX(180deg) scale(1.3); }
                50% { transform: translateY(-160px) rotateX(360deg) scale(1.5); }
                75% { transform: translateY(-120px) rotateX(540deg) scale(1.3); }
                100% { transform: translateY(0) rotateX(720deg) scale(1); }
              }
              @keyframes coinFlipFinal {
                0% { transform: translateY(-160px) rotateX(0deg) scale(1.5); }
                40% { transform: translateY(-200px) rotateX(360deg) scale(1.6); }
                70% { transform: translateY(-100px) rotateX(${animationResult === "heads" ? "720deg" : "900deg"}) scale(1.3); }
                85% { transform: translateY(-30px) rotateX(${animationResult === "heads" ? "720deg" : "900deg"}) scale(1.1); }
                95% { transform: translateY(-10px) rotateX(${animationResult === "heads" ? "720deg" : "900deg"}) scale(1.05); }
                100% { transform: translateY(0) rotateX(${animationResult === "heads" ? "720deg" : "900deg"}) scale(1); }
              }
              .flipping-coin-continuous { animation: coinFlipContinuous 2.5s ease-in-out infinite; transform-style: preserve-3d; }
              .flipping-coin-final { animation: coinFlipFinal 3.5s ease-out; transform-style: preserve-3d; }
              .coin-face { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; }
              .coin-heads { transform: rotateX(0deg); }
              .coin-tails { transform: rotateX(180deg); }
            `}</style>
            <div className={animationResult ? "flipping-coin-final relative w-32 h-32" : "flipping-coin-continuous relative w-32 h-32"} style={{ transformStyle: "preserve-3d" }}>
              {animationResult ? (
                <img src={animationResult === "heads" ? "/head.png" : "/tails.png"} alt="Coin Result" className="w-full h-full object-contain drop-shadow-2xl" />
              ) : (
                <>
                  <img src="/head.png" alt="Heads" className="coin-face coin-heads w-full h-full object-contain drop-shadow-2xl" />
                  <img src="/tails.png" alt="Tails" className="coin-face coin-tails w-full h-full object-contain drop-shadow-2xl" />
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

      {!showAnimation && (
        <div className="text-center">
          <button
            className={`win98-border-inset p-4 text-xl font-pixel font-bold transition-all ${
              selectedSide && !isFlipping && contractExists ? "bg-green-500 text-white hover:bg-green-600" : "bg-gray-400 text-gray-600 cursor-not-allowed"
            }`}
            onClick={handleFlip}
            disabled={!selectedSide || isFlipping || !contractExists}
          >
            {isFlipping && !showAnimation ? "⏳ WAITING..." : "🚀 FLIP COIN"}
          </button>
        </div>
      )}

      {lastResult && !showAnimation && (
        <div className="win98-border-inset p-4 bg-secondary">
          <h3 className="text-lg font-bold font-military text-gradient-purple mb-3">Last Result</h3>
          <div className="text-center space-y-3">
            <div className="flex justify-center gap-6">
              <div className="flex flex-col items-center gap-1">
                <img src={lastResult.guess === "heads" ? "/head.png" : "/tails.png"} alt={`You guessed ${lastResult.guess}`} className="w-16 h-16 object-contain" />
                <p className="text-xs font-pixel text-gray-600">Your Guess</p>
              </div>
              <div className="flex items-center justify-center text-2xl">{lastResult.won ? "=" : "≠"}</div>
              <div className="flex flex-col items-center gap-1">
                <img src={lastResult.outcome === "heads" ? "/head.png" : "/tails.png"} alt={`Outcome was ${lastResult.outcome}`} className="w-16 h-16 object-contain" />
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
            <div className={`text-xl font-bold font-pixel ${lastResult.won ? "text-green-500" : "text-red-500"}`}>
              {lastResult.won ? "🎉 YOU WON!" : "😔 YOU LOST"}
            </div>

            <div className="mt-4 pt-3 border-t border-gray-400 space-y-3">
              <div className="flex gap-3 justify-center">
                <button
                  className={`win98-border-inset p-3 text-lg font-pixel font-bold transition-all ${
                    !isFlipping && contractExists ? "bg-blue-500 text-white hover:bg-blue-600" : "bg-gray-400 text-gray-600 cursor-not-allowed"
                  }`}
                  onClick={handleFlip}
                  disabled={isFlipping || !contractExists}
                >
                  {isFlipping ? "🔄 FLIPPING..." : "🔄 FLIP AGAIN"}
                </button>

                <button
                  className={`win98-border p-2 text-sm font-pixel transition-all ${
                    !isFlipping && contractExists ? "bg-yellow-500 text-gray-800 hover:bg-yellow-600" : "bg-gray-300 text-gray-500 cursor-not-allowed"
                  }`}
                  onClick={() => setSelectedSide(selectedSide === "heads" ? "tails" : "heads")}
                  disabled={isFlipping || !contractExists}
                >
                  🔄 CHANGE CHOICE
                </button>
              </div>
              <p className="text-xs font-retro text-muted-foreground">Keep the same choice or switch sides</p>
            </div>
          </div>
        </div>
      )}

      <div className="win98-border p-3 bg-gray-100">
        <h4 className="text-sm font-bold font-military text-blue-600 mb-2">How to Play:</h4>
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
