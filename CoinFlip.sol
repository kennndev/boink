// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Gas-Only Coin Flip (No VRF)
/// @notice Users guess heads/tails; contract computes a pseudo-random outcome and records the result.
/// @dev No ether is accepted or held. Outcome is derived from prior blockhash + msg.sender + user-supplied seed.
contract CoinFlipGasOnly {
    enum Side { Heads, Tails }

    struct Stats {
        uint256 plays;
        uint256 wins;
    }

    event FlipResult(
        address indexed player,
        Side guess,
        Side outcome,
        bool won,
        uint256 playIndex
    );

    mapping(address => Stats) public stats;

    /// @notice Perform a coin flip. User pays only gas.
    /// @param guess The user's guess (0=heads, 1=tails).
    /// @param userSeed An arbitrary number provided by the user to vary entropy.
    /// @return won True if guess matched the outcome.
    /// @return outcome The outcome side.
    function flip(Side guess, uint256 userSeed) external returns (bool won, Side outcome) {
        // Use prior blockhash to avoid same-block predictability from pending tx inspection.
        bytes32 h = keccak256(
            abi.encodePacked(
                blockhash(block.number - 1),
                msg.sender,
                userSeed,
                block.prevrandao,   // a.k.a. mixHash on pre-merge; adds some variability on PoS
                block.timestamp,    // weak entropy; included to diversify the mix
                block.chainid
            )
        );

        // Least significant bit decides
        outcome = (uint8(h[0]) & 1) == 0 ? Side.Heads : Side.Tails;

        Stats storage s = stats[msg.sender];
        s.plays += 1;
        if (outcome == guess) {
            s.wins += 1;
            won = true;
        } else {
            won = false;
        }

        emit FlipResult(msg.sender, guess, outcome, won, s.plays);
    }

    /// @notice Convenience view to preview how encoding maps to a side for a given hash (for testing).
    /// @dev Not a source of truth for real flips since it uses provided bytes32, not live chain data.
    function _bitToSide(bytes32 x) external pure returns (Side) {
        return (uint8(x[0]) & 1) == 0 ? Side.Heads : Side.Tails;
    }

    /// @notice Returns caller stats (plays, wins).
    function myStats() external view returns (uint256 plays, uint256 wins) {
        Stats memory s = stats[msg.sender];
        return (s.plays, s.wins);
    }
}
