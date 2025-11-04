# Coin Flip Integration Setup

## Overview
The coin flip game has been successfully integrated into your application! Users can now play a blockchain-based coin flip game by clicking the "COINFLIP" icon on the desktop.

## Setup Instructions

### 1. Deploy Your Contract
Deploy the `CoinFlipGasOnly` contract to your preferred blockchain network.

### 2. Configure Contract Address
Create a `.env` file in your project root with the following content:

```env
VITE_COINFLIP_CONTRACT_ADDRESS=0xYourDeployedContractAddress
```

Replace `0xYourDeployedContractAddress` with your actual deployed contract address.

### 3. Features Included

#### ✅ Coin Flip Game
- **Heads/Tails Selection**: Users can choose between heads or tails
- **Blockchain Integration**: Uses ethers.js to interact with your smart contract
- **Gas-Only**: Users only pay gas fees, no additional cost
- **Real-time Results**: Shows win/loss immediately after transaction confirmation

#### ✅ User Statistics
- **Total Plays**: Track how many times the user has played
- **Wins**: Track how many times the user has won
- **Win Rate**: Calculate and display win percentage
- **On-chain Storage**: All stats are stored on the blockchain

#### ✅ User Experience
- **Wallet Integration**: Works with MetaMask, Rabby, Phantom, Backpack, and Coinbase Wallet
- **Windows 98 Style**: Maintains the retro aesthetic of your application
- **Toast Notifications**: Provides feedback for all actions
- **Error Handling**: Graceful handling of transaction failures and rejections

### 4. How It Works

1. **User connects wallet** via the taskbar
2. **User clicks COINFLIP icon** on the desktop
3. **User selects heads or tails** using the interface
4. **User clicks "FLIP COIN"** to submit transaction
5. **Contract generates random outcome** using blockhash + user seed
6. **Result is displayed** with win/loss status
7. **Stats are updated** automatically

### 5. Smart Contract Integration

The integration uses the contract ABI from `src/coinFlip.json` and includes:
- `flip(guess, userSeed)` function call
- `myStats()` function to get user statistics
- Event listening for `FlipResult` events
- Proper error handling for transaction failures

### 6. Security Features

- **Pseudo-random generation** using blockhash + user seed + block data
- **No ether handling** - gas-only transactions
- **User-controlled entropy** via user seed parameter
- **Transparent results** - all data stored on-chain

## Usage

1. Start your development server: `npm run dev`
2. Connect a wallet using the taskbar
3. Click the "COINFLIP" icon on the desktop
4. Select heads or tails
5. Click "FLIP COIN" to play!

The game is now fully integrated and ready to use! 🪙
