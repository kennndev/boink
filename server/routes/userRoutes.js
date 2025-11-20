import express from 'express';
import { User } from '../models/User.js';
import { getTwitterOAuthUrl, verifyFollowAfterOAuth } from '../utils/twitterVerification.js';

const router = express.Router();

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
    
    // Check if Twitter API is configured
    if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
      console.log('Twitter API not configured - returning trust-based response');
      return res.json({
        success: false,
        message: 'Twitter API not configured. Using trust-based system.',
        trustBased: true
      });
    }

    // Build callback URL - handle both Vercel and local development
    const protocol = req.protocol || 'https';
    const host = req.get('host') || req.headers.host;
    const callbackUrl = `${protocol}://${host}/api/users/${walletAddress}/twitter-callback`;
    
    console.log('Generating Twitter OAuth URL with callback:', callbackUrl);

    const oauthData = await getTwitterOAuthUrl(callbackUrl);
    
    // Store oauth_token_secret temporarily (in production, use Redis or database)
    // For now, we'll return it to the client to send back
    res.json({
      success: true,
      oauthUrl: oauthData.url,
      oauthToken: oauthData.oauth_token,
      oauthTokenSecret: oauthData.oauth_token_secret
    });
  } catch (error) {
    console.error('Error generating Twitter OAuth URL:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to generate OAuth URL',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Twitter OAuth callback
router.get('/:walletAddress/twitter-callback', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const { oauth_token, oauth_verifier, oauth_token_secret } = req.query;

    if (!oauth_token || !oauth_verifier || !oauth_token_secret) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?twitter_error=missing_params`);
    }

    const verification = await verifyFollowAfterOAuth(
      oauth_token,
      oauth_verifier,
      oauth_token_secret
    );

    if (!verification.isFollowing) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?twitter_error=not_following`);
    }

    // User is following, award points
    const normalizedAddress = walletAddress.toLowerCase().trim();
    const POINTS_PER_TWITTER_FOLLOW = 10;

    let user = await User.findOne({ walletAddress: normalizedAddress });

    if (!user) {
      user = new User({
        walletAddress: normalizedAddress,
        points: 0
      });
    }

    // Check if user already followed (prevent duplicate rewards)
    if (user.twitterFollowed) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?twitter_error=already_claimed`);
    }

    // Award points and mark as followed
    user.points += POINTS_PER_TWITTER_FOLLOW;
    user.twitterFollowed = true;
    user.twitterUserId = verification.twitterUserId;
    await user.save();

    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?twitter_success=true&points=${user.points}`);
  } catch (error) {
    console.error('Error in Twitter OAuth callback:', error);
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}?twitter_error=verification_failed`);
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
        message: 'Please use Twitter OAuth verification. Click "Verify with Twitter" button.',
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

