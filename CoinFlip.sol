// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Optional metadata interface for decimals()
interface IERC20Metadata is IERC20 {
    function decimals() external view returns (uint8);
}

/// @title CoinFlipUSDC – $5 cap, 1.95x payout
/// @notice Users bet a USD stablecoin (e.g., USDC). Win → receive 1.95× bet (includes principal). Lose → lose full bet.
/// @dev Pseudo-randomness only. For real value, replace entropy with VRF or commit–reveal.
contract CoinFlipUSDC is Ownable, ReentrancyGuard {
    enum Side { Heads, Tails }

    IERC20 public immutable token;        // e.g., USDC (6 decimals on mainnet/Base)
    address public treasury;              // owner-controlled payout/profit sink
    uint8   public immutable decimals_;   // token decimals cached
    uint256 public immutable MAX_BET;     // $5 in token units

    // Payout model: total paid to winner = amount * 195/100 (i.e., 1.95x)
    uint256 public constant PAYOUT_NUM = 195;
    uint256 public constant PAYOUT_DEN = 100;

    struct Stats {
        uint256 plays;
        uint256 wins;
        uint256 wagered;   // total tokens bet by player
        uint256 paidOut;   // total tokens paid to player on wins (includes principal)
    }
    mapping(address => Stats) public stats;

    event FlipResult(
        address indexed player,
        Side guess,
        Side outcome,
        bool won,
        uint256 amountIn,      // bet amount
        uint256 payoutTotal,   // 1.95x on win, 0 on loss
        uint256 profitPlayer   // payoutTotal - amountIn (0.95x on win, 0 on loss)
    );

    constructor(address _token, address _treasury) Ownable(msg.sender) {
        require(_token != address(0) && _treasury != address(0), "zero addr");
        token = IERC20(_token);
        treasury = _treasury;

        uint8 d = IERC20Metadata(_token).decimals();
        decimals_ = d;
        MAX_BET = 5 * (10 ** d); // $5 cap
    }

    // ----- Admin -----
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "zero addr");
        treasury = _treasury;
    }

    /// @notice Owner tops up liquidity for paying winners (approve required).
    function deposit(uint256 amount) external onlyOwner {
        require(token.transferFrom(msg.sender, address(this), amount), "deposit failed");
    }

    /// @notice Owner withdraws tokens to treasury (profits or liquidity management).
    function withdraw(uint256 amount) external onlyOwner {
        require(token.transfer(treasury, amount), "withdraw failed");
    }

    // ----- Game -----
    /// @notice Place a bet. Approve this contract for `amount` first.
    /// @param guess 0=Heads, 1=Tails
    /// @param amount Bet amount in token units (<= $5)
    /// @param userSeed Arbitrary number from the user to diversify entropy
    function flip(Side guess, uint256 amount, uint256 userSeed)
        external
        nonReentrant
    {
        require(amount > 0, "amount=0");
        require(amount <= MAX_BET, "exceeds $5 cap");

        // Pull tokens from player
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");

        // Pseudo-random outcome: replace with VRF for value-bearing deployments
        bytes32 h = keccak256(
            abi.encodePacked(
                blockhash(block.number - 1),
                msg.sender,
                userSeed,
                block.prevrandao,
                block.timestamp,
                address(this)
            )
        );
        Side outcome = (uint8(h[0]) & 1) == 0 ? Side.Heads : Side.Tails;
        bool won = (outcome == guess);

        uint256 payout = 0;
        if (won) {
            payout = (amount * PAYOUT_NUM) / PAYOUT_DEN; // 1.95x
            require(token.balanceOf(address(this)) >= payout, "insufficient liquidity");
            require(token.transfer(msg.sender, payout), "payout failed");
        }
        uint256 profit = payout > amount ? (payout - amount) : 0;

        // Stats
        Stats storage s = stats[msg.sender];
        s.plays += 1;
        if (won) s.wins += 1;
        s.wagered += amount;
        s.paidOut += payout;

        emit FlipResult(msg.sender, guess, outcome, won, amount, payout, profit);
    }

    // ----- Views -----
    function quotePayout(uint256 amount) external pure returns (uint256) {
        return (amount * PAYOUT_NUM) / PAYOUT_DEN;
    }

    function maxBet() external view returns (uint256) {
        return MAX_BET;
    }
}
