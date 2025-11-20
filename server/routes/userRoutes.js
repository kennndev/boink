import express from 'express';
import { User } from '../models/User.js';
import { getTwitterOAuthUrl, verifyFollowAfterOAuth } from '../utils/twitterVerification.js';

const router = express.Router();

// Twitter OAuth callback (MUST be before /:walletAddress route to avoid route conflicts)
router.get('/twitter-callback', async (req, res) => {
  try {
    const { oauth_token, oauth_verifier } = req.query;

    console.log(`[Twitter Callback] Received callback`);
    console.log(`[Twitter Callback] OAuth token present: ${!!oauth_token}, OAuth verifier present: ${!!oauth_verifier}`);

    if (!oauth_token || !oauth_verifier) {
      console.error('[Twitter Callback] Missing OAuth parameters');
      const frontendUrl = process.env.FRONTEND_URL || (req.headers.origin || 'http://localhost:5173');
      return res.redirect(`${frontendUrl}?twitter_error=missing_params`);
    }

    // IMPORTANT: OAuth 1.0a doesn't support state parameter, so we look up the user by oauth_token
    // The oauth_token was stored in the database when we generated the OAuth URL
    // This allows us to retrieve the wallet address associated with this OAuth session
    const user = await User.findOne({ oauthToken: oauth_token });
    
    if (!user) {
      console.error('[Twitter Callback] User not found for oauth_token:', oauth_token?.substring(0, 20) + '...');
      const frontendUrl = process.env.FRONTEND_URL || (req.headers.origin || 'http://localhost:5173');
      return res.redirect(`${frontendUrl}?twitter_error=invalid_token`);
    }

    if (!user.oauthTokenSecret) {
      console.error('[Twitter Callback] OAuth token secret not found for user:', user.walletAddress);
      const frontendUrl = process.env.FRONTEND_URL || (req.headers.origin || 'http://localhost:5173');
      return res.redirect(`${frontendUrl}?twitter_error=invalid_token`);
    }

    const normalizedAddress = user.walletAddress.toLowerCase().trim();
    console.log(`[Twitter Callback] Found user for wallet: ${normalizedAddress}`);

    console.log(`[Twitter Callback] Verifying follow for wallet ${normalizedAddress}`);
    
    // Now verify the follow using the stored secret
    // This will authenticate the USER's Twitter account (not the app owner's)
    const verification = await verifyFollowAfterOAuth(
      oauth_token,
      oauth_verifier,
      user.oauthTokenSecret
    );
    
    console.log(`[Twitter Callback] Verification result:`, {
      isFollowing: verification.isFollowing,
      twitterUserId: verification.twitterUserId,
      trustBased: verification.trustBased || false
    });
    
    // Clear OAuth tokens immediately after use (security best practice)
    user.oauthToken = null;
    user.oauthTokenSecret = null;
    
    // If trust-based (all API methods failed), log warning but allow it
    if (verification.trustBased) {
      console.warn(`[Twitter Callback] ⚠️  Trust-based verification for wallet ${normalizedAddress}`);
      console.warn(`[Twitter Callback] Warning: ${verification.warning || 'Could not verify via API'}`);
    }
    
    if (!verification.isFollowing) {
      console.log(`[Twitter Callback] User ${normalizedAddress} (Twitter ID: ${verification.twitterUserId}) is not following`);
      await user.save();
      const frontendUrl = process.env.FRONTEND_URL || (req.headers.origin || 'http://localhost:5173');
      return res.redirect(`${frontendUrl}?twitter_error=not_following`);
    }

    // User is following, award points
    const POINTS_PER_TWITTER_FOLLOW = 10;

    // Check if user already followed (prevent duplicate rewards for this wallet)
    if (user.twitterFollowed) {
      console.log(`[Twitter Callback] User ${normalizedAddress} already claimed Twitter follow points`);
      await user.save();
      const frontendUrl = process.env.FRONTEND_URL || (req.headers.origin || 'http://localhost:5173');
      return res.redirect(`${frontendUrl}?twitter_error=already_claimed`);
    }

    // IMPORTANT: Check if this Twitter account has already been used by another wallet
    // This prevents users from using the same Twitter account to claim points for multiple wallets
    const existingUserWithTwitterId = await User.findOne({ 
      twitterUserId: verification.twitterUserId,
      walletAddress: { $ne: normalizedAddress } // Exclude the current wallet
    });

    if (existingUserWithTwitterId) {
      console.log(`[Twitter Callback] Twitter account ${verification.twitterUserId} (@${verification.twitterUsername}) already used by wallet ${existingUserWithTwitterId.walletAddress}`);
      await user.save();
      const frontendUrl = process.env.FRONTEND_URL || (req.headers.origin || 'http://localhost:5173');
      return res.redirect(`${frontendUrl}?twitter_error=twitter_already_used`);
    }

    // Award points and mark as followed
    // Store the Twitter user ID to prevent duplicate claims from same Twitter account across different wallets
    user.points += POINTS_PER_TWITTER_FOLLOW;
    user.twitterFollowed = true;
    user.twitterUserId = verification.twitterUserId; // Store the authenticated USER's Twitter ID
    await user.save();

    console.log(`[Twitter Callback] Successfully awarded ${POINTS_PER_TWITTER_FOLLOW} points to wallet ${normalizedAddress}`);
    console.log(`[Twitter Callback] User's Twitter ID: ${verification.twitterUserId}`);
    console.log(`[Twitter Callback] Total points: ${user.points}`);

    const frontendUrl = process.env.FRONTEND_URL || (req.headers.origin || 'http://localhost:5173');
    return res.redirect(`${frontendUrl}?twitter_success=true&points=${user.points}`);
  } catch (error) {
    console.error('[Twitter Callback] Error in Twitter OAuth callback:', error);
    console.error('[Twitter Callback] Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    // Provide more specific error information
    let errorType = 'verification_failed';
    if (error.message?.includes('access denied') || error.message?.includes('403')) {
      errorType = 'api_access_denied';
    } else if (error.message?.includes('authentication') || error.message?.includes('401')) {
      errorType = 'authentication_failed';
    } else if (error.message?.includes('not following')) {
      errorType = 'not_following';
    }
    
    const frontendUrl = process.env.FRONTEND_URL || (req.headers.origin || 'http://localhost:5173');
    return res.redirect(`${frontendUrl}?twitter_error=${errorType}`);
  }
});

// Get or create user
router.get('/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const normalizedAddress = walletAddress.toLowerCase().trim();

    let user = await User.findOne({ walletAddress: normalizedAddress });

    if (!user) {
      user = new User({
        walletAddress: normalizedAddress,
        points: 0
      });
      await user.save();
    }

    res.json({
      success: true,
      user: {
        walletAddress: user.walletAddress,
        points: user.points,
        flips: user.flips,
        twitterFollowed: user.twitterFollowed,
        referralUsed: user.referralUsed
      }
    });
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user',
      error: error.message
    });
  }
});

// Award points for coin flip
router.post('/:walletAddress/flip', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const normalizedAddress = walletAddress.toLowerCase().trim();
    const POINTS_PER_FLIP = 100;

    let user = await User.findOne({ walletAddress: normalizedAddress });

    if (!user) {
      user = new User({
        walletAddress: normalizedAddress,
        points: 0,
        flips: 0
      });
    }

    // Award points and increment flip count
    user.points += POINTS_PER_FLIP;
    user.flips += 1;
    await user.save();

    res.json({
      success: true,
      message: `Awarded ${POINTS_PER_FLIP} points for coin flip`,
      points: user.points,
      pointsAwarded: POINTS_PER_FLIP
    });
  } catch (error) {
    console.error('Error awarding flip points:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to award points',
      error: error.message
    });
  }
});

// Get Twitter OAuth URL to start verification
router.get('/:walletAddress/twitter-oauth', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const normalizedAddress = walletAddress.toLowerCase().trim();
    
    console.log(`[Twitter OAuth] Request from wallet: ${normalizedAddress}`);
    
    // Check if Twitter API is configured
    const hasClientId = process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_ID.trim() !== '';
    const hasClientSecret = process.env.TWITTER_CLIENT_SECRET && process.env.TWITTER_CLIENT_SECRET.trim() !== '';
    
    if (!hasClientId || !hasClientSecret) {
      console.log('[Twitter OAuth] Twitter API not configured - returning trust-based response');
      return res.json({
        success: false,
        message: 'Twitter API not configured. Using trust-based system.',
        trustBased: true
      });
    }

    // Build callback URL - handle both Vercel and local development
    // For Vercel, use the request origin; for local, use localhost
    let protocol = req.protocol || 'https';
    let host = req.get('host') || req.headers.host;
    
    // Check for Vercel headers
    if (req.headers['x-forwarded-proto']) {
      protocol = req.headers['x-forwarded-proto'].split(',')[0].trim();
    }
    if (req.headers['x-forwarded-host']) {
      host = req.headers['x-forwarded-host'].split(',')[0].trim();
    }
    
    // Fallback to origin header if available
    if (req.headers.origin && !host.includes('localhost')) {
      try {
        const originUrl = new URL(req.headers.origin);
        protocol = originUrl.protocol.replace(':', '');
        host = originUrl.host;
      } catch (e) {
        console.warn('[Twitter OAuth] Could not parse origin header:', e);
      }
    }
    
    if (!host) {
      console.error('[Twitter OAuth] Cannot determine host for callback URL');
      return res.json({
        success: false,
        message: 'Cannot determine callback URL. Using trust-based system.',
        trustBased: true
      });
    }
    
    // Use a single callback URL (without wallet address) since Twitter doesn't support wildcards
    // OAuth 1.0a doesn't support state parameter, so we'll use oauth_token to look up the wallet address
    const callbackUrl = `${protocol}://${host}/api/users/twitter-callback`;
    console.log(`[Twitter OAuth] Generating OAuth URL for wallet ${normalizedAddress}`);
    console.log(`[Twitter OAuth] Callback URL: ${callbackUrl}`);
    console.log(`[Twitter OAuth] Protocol: ${protocol}, Host: ${host}`);

    try {
      // Generate OAuth URL - the oauth_token will be stored with the wallet address
      // In the callback, we'll look up the user by oauth_token to get the wallet address
      const oauthData = await getTwitterOAuthUrl(callbackUrl, normalizedAddress);
      
      // Store oauth_token_secret in the database for this user
      // This allows us to retrieve it when the callback happens
      let user = await User.findOne({ walletAddress: normalizedAddress });
      
      if (!user) {
        user = new User({
          walletAddress: normalizedAddress,
          points: 0
        });
      }
      
      // Store the oauth_token and oauth_token_secret temporarily
      // These will be used when the user returns from Twitter
      // IMPORTANT: Each user gets their own OAuth tokens - this allows each user to authenticate separately
      user.oauthToken = oauthData.oauth_token;
      user.oauthTokenSecret = oauthData.oauth_token_secret;
      await user.save();
      
      console.log(`[Twitter OAuth] OAuth tokens stored for wallet ${normalizedAddress}`);
      console.log(`[Twitter OAuth] OAuth URL generated successfully`);
      
      // Return only the OAuth URL to the client (don't expose the secret)
      res.json({
        success: true,
        oauthUrl: oauthData.url
      });
    } catch (twitterError) {
      // If Twitter API call fails, fall back to trust-based system
      console.error('[Twitter OAuth] Twitter API error - falling back to trust-based system:', twitterError);
      console.error('[Twitter OAuth] Error details:', {
        message: twitterError.message,
        code: twitterError.code,
        stack: twitterError.stack
      });
      return res.json({
        success: false,
        message: 'Twitter API error. Using trust-based system.',
        trustBased: true,
        error: twitterError.message
      });
    }
  } catch (error) {
    console.error('[Twitter OAuth] Error generating Twitter OAuth URL:', error);
    console.error('[Twitter OAuth] Error stack:', error.stack);
    
    // Always fall back to trust-based system instead of returning 500
    res.json({
      success: false,
      message: 'Failed to generate OAuth URL. Using trust-based system.',
      trustBased: true,
      error: error.message
    });
  }
});

// Award points for Twitter follow (trust-based fallback)
router.post('/:walletAddress/twitter-follow', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const normalizedAddress = walletAddress.toLowerCase().trim();
    const POINTS_PER_TWITTER_FOLLOW = 10;

    // Check if Twitter API is configured
    const twitterConfigured = process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET;
    
    if (twitterConfigured) {
      return res.json({
        success: false,
        message: 'Twitter OAuth verification is required. Please use the "Verify & Claim 10 Points" button.',
        requiresOAuth: true
      });
    }

    // Trust-based system (fallback when Twitter API not configured)
    let user = await User.findOne({ walletAddress: normalizedAddress });

    if (!user) {
      user = new User({
        walletAddress: normalizedAddress,
        points: 0
      });
    }

    // Check if user already followed (prevent duplicate rewards)
    if (user.twitterFollowed) {
      return res.json({
        success: false,
        message: 'Twitter follow points already awarded',
        points: user.points
      });
    }

    // Award points and mark as followed
    user.points += POINTS_PER_TWITTER_FOLLOW;
    user.twitterFollowed = true;
    await user.save();

    res.json({
      success: true,
      message: `Awarded ${POINTS_PER_TWITTER_FOLLOW} points for Twitter follow`,
      points: user.points,
      pointsAwarded: POINTS_PER_TWITTER_FOLLOW,
      trustBased: true
    });
  } catch (error) {
    console.error('Error awarding Twitter follow points:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to award points',
      error: error.message
    });
  }
});

// Award points for referral
router.post('/:walletAddress/referral', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const normalizedAddress = walletAddress.toLowerCase().trim();
    const POINTS_PER_REFERRAL = 5;

    let user = await User.findOne({ walletAddress: normalizedAddress });

    if (!user) {
      user = new User({
        walletAddress: normalizedAddress,
        points: 0
      });
    }

    // Check if user already used referral (prevent duplicate rewards)
    if (user.referralUsed) {
      return res.json({
        success: false,
        message: 'Referral points already awarded',
        points: user.points
      });
    }

    // Award points and mark as used
    user.points += POINTS_PER_REFERRAL;
    user.referralUsed = true;
    await user.save();

    res.json({
      success: true,
      message: `Awarded ${POINTS_PER_REFERRAL} points for referral`,
      points: user.points,
      pointsAwarded: POINTS_PER_REFERRAL
    });
  } catch (error) {
    console.error('Error awarding referral points:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to award points',
      error: error.message
    });
  }
});

// Get leaderboard
router.get('/leaderboard/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const users = await User.find({})
      .sort({ points: -1 })
      .limit(limit)
      .select('walletAddress points flips -_id');

    res.json({
      success: true,
      leaderboard: users
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get leaderboard',
      error: error.message
    });
  }
});

export { router as userRoutes };

