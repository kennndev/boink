# Coinflip Coming Soon Toggle

File: `src/pages/Index.tsx`

## What was changed
- The `mint` window content now renders a "Mainnet coming soon..." placeholder.
- The original `CoinFlip` JSX block was commented out (so you can restore it later).

## How to re‑enable Coinflip
In `src/pages/Index.tsx`, inside the `mint` window:

1) Remove the placeholder block:
```
<div className="text-center space-y-2 sm:space-y-4">
  ...
  Mainnet coming soon...
  ...
</div>
```
Lines: `899-912`

2) Uncomment the original block below it:
```
{/*
{connectedWallet ? (
  <CoinFlip 
    connectedWallet={connectedWallet} 
    connectedWalletName={connectedWalletName}
    walletProviders={walletProviders} 
  />
) : (
  <div className="text-center space-y-2 sm:space-y-4">
    ...
  </div>
)}
*/}
```
Lines: `913-936`

Once the comment markers are removed, the CoinFlip UI will show again.
