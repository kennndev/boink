import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import windowsIcon from "@/assets/windows98.svg";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import referralRegistryABI from "../ReferralRegistry.json";
import type { EthereumProvider } from "@/types/wallet";

interface StartMenuProps {
  connectedWallet: string | null;
  connectedWalletName?: string | null;
  walletProviders: Record<string, EthereumProvider>;
  onClose: () => void;
  isOpen?: boolean;
}

export const StartMenu = ({ connectedWallet, connectedWalletName, walletProviders, onClose, isOpen = true }: StartMenuProps) => {
  const [totalReferrals, setTotalReferrals] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const REFERRAL_REGISTRY_ADDRESS = import.meta.env.VITE_REFERRAL_REGISTORY_ADDRESS || "0x6C02bb7536d71a69F3d38E448422C80445D26b0d";
  const EXPECTED_CHAIN_ID = import.meta.env.VITE_CHAIN_ID || "763373";

  // Load total referrals when wallet is connected or menu is opened
  useEffect(() => {
    if (!connectedWallet || !isOpen) {
      setTotalReferrals(null);
      return;
    }

    const loadReferrals = async () => {
      setIsLoading(true);
      try {
        // Get provider
        const walletName = connectedWalletName || "MetaMask";
        const ethereumProvider = walletProviders[walletName] || (window as any).ethereum;
        
        if (!ethereumProvider) {
          console.warn('No provider found for wallet:', walletName);
          setTotalReferrals(0);
          return;
        }

        const browserProvider = new ethers.BrowserProvider(ethereumProvider);
        const network = await browserProvider.getNetwork();
        const currentChainId = network.chainId.toString();

        if (currentChainId !== EXPECTED_CHAIN_ID) {
          console.warn('Wrong network. Expected:', EXPECTED_CHAIN_ID, 'Got:', currentChainId);
          setTotalReferrals(0);
          return;
        }

        // Create contract instance
        const referralContract = new ethers.Contract(
          REFERRAL_REGISTRY_ADDRESS,
          referralRegistryABI,
          browserProvider
        );

        // Get user's referral stats
        const userAddress = connectedWallet.toLowerCase();
        const [code, totalRefs, active] = await referralContract.getReferrerStats(userAddress);
        
        if (code && code !== ethers.ZeroHash) {
          setTotalReferrals(Number(totalRefs ?? 0));
        } else {
          // User doesn't have a referral code yet
          setTotalReferrals(0);
        }
      } catch (error) {
        console.error('Error loading total referrals:', error);
        setTotalReferrals(0);
      } finally {
        setIsLoading(false);
      }
    };

    loadReferrals();
  }, [connectedWallet, connectedWalletName, walletProviders, isOpen, REFERRAL_REGISTRY_ADDRESS, EXPECTED_CHAIN_ID]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed bottom-12 sm:bottom-14 left-0 bg-gray-300 win98-border shadow-2xl z-[100] min-w-[250px] sm:min-w-[300px]"
    >
      {/* Menu Header with Close Button */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <img 
            src={windowsIcon} 
            alt="Windows" 
            className="w-6 h-6 sm:w-8 sm:h-8"
          />
          <span className="font-bold font-military text-sm sm:text-base">Start Menu</span>
        </div>
        <Button
          size="icon"
          variant="secondary"
          className="h-5 w-5 sm:h-6 sm:w-6 p-0 win98-border hover:bg-red-500 hover:text-white flex-shrink-0"
          onClick={onClose}
        >
          <X className="h-3 w-3 sm:h-4 sm:w-4" />
        </Button>
      </div>

      {/* Menu Content - Total Referrals */}
      <div className="p-4 sm:p-6">
        <div className="win98-border-inset p-4 sm:p-6 bg-gradient-to-r from-yellow-100 to-yellow-50">
          <div className="flex flex-col items-center justify-center space-y-3">
            <span className="text-base sm:text-lg font-pixel text-gray-700">👥 Total Referrals</span>
            {isLoading ? (
              <span className="text-sm font-retro text-gray-500">Loading...</span>
            ) : (
              <span className="text-4xl sm:text-5xl font-bold font-military text-gradient-yellow">
                {connectedWallet ? (totalReferrals !== null ? totalReferrals : 0) : '---'}
              </span>
            )}
            {!connectedWallet && (
              <p className="text-xs sm:text-sm font-retro text-gray-500 text-center mt-2">
                Connect your wallet to see your referrals
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

