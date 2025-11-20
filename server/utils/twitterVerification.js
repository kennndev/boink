import { TwitterApi } from 'twitter-api-v2';

/**
 * Verify if a Twitter user is following a specific account
 * @param {string} userTwitterId - The Twitter user ID to check
 * @param {string} targetUsername - The username to check if they're following (e.g., 'boinknfts')
 * @returns {Promise<boolean>} - True if user is following, false otherwise
 */
export async function verifyTwitterFollow(userTwitterId, targetUsername = 'boinknfts') {
  try {
    // Initialize Twitter API client
    // You'll need to set these in your .env file:
    // TWITTER_BEARER_TOKEN - Your Twitter Bearer Token
    // TWITTER_CLIENT_ID - Your Twitter App Client ID
    // TWITTER_CLIENT_SECRET - Your Twitter App Client Secret
    
    const client = new TwitterApi({
      appKey: process.env.TWITTER_CLIENT_ID,
      appSecret: process.env.TWITTER_CLIENT_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    // For read-only operations, you can use Bearer Token
    const bearerClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
    const readOnlyClient = bearerClient.readOnly;

    // Get the target user's ID
    const targetUser = await readOnlyClient.v2.userByUsername(targetUsername);
    if (!targetUser.data) {
      console.error(`Target user ${targetUsername} not found`);
      return false;
    }

    const targetUserId = targetUser.data.id;

    // Check if user is following the target account
    // Note: This requires OAuth 1.0a User Context (user must authenticate)
    // The following endpoint requires the user's access token
    const following = await readOnlyClient.v2.following(userTwitterId, {
      max_results: 1000,
    });

    // Check if target user ID is in the following list
    const isFollowing = following.data?.some(
      (user) => user.id === targetUserId
    );

    return isFollowing || false;
  } catch (error) {
    console.error('Error verifying Twitter follow:', error);
    return false;
  }
}

/**
 * Alternative: Verify using OAuth flow
 * This requires the user to authenticate with Twitter
 */
export async function getTwitterOAuthUrl(callbackUrl) {
  try {
    // Validate credentials
    if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
      throw new Error('Twitter API credentials not configured');
    }

    const client = new TwitterApi({
      appKey: process.env.TWITTER_CLIENT_ID,
      appSecret: process.env.TWITTER_CLIENT_SECRET,
    });

    console.log('Generating Twitter OAuth link with callback:', callbackUrl);
    
    const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(
      callbackUrl,
      { linkMode: 'authorize' }
    );

    if (!url || !oauth_token || !oauth_token_secret) {
      throw new Error('Failed to generate OAuth link - missing required data');
    }

    return {
      url,
      oauth_token,
      oauth_token_secret,
    };
  } catch (error) {
    console.error('Error generating Twitter OAuth URL:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Verify follow after OAuth callback
 */
export async function verifyFollowAfterOAuth(oauthToken, oauthVerifier, oauthTokenSecret) {
  try {
    const client = new TwitterApi({
      appKey: process.env.TWITTER_CLIENT_ID,
      appSecret: process.env.TWITTER_CLIENT_SECRET,
      accessToken: oauthToken,
      accessSecret: oauthTokenSecret,
    });

    // Complete OAuth flow - this authenticates the USER's Twitter account (not the app owner)
    const { client: loggedClient, accessToken, accessSecret } = await client.login(oauthVerifier);

    // Get the authenticated USER's Twitter ID (the person who clicked "Verify")
    // This will be different for each user who authenticates
    const me = await loggedClient.v2.me();
    const userId = me.data.id; // This is the USER's Twitter ID, not the app owner's!

    // Get the target account to check if user is following (e.g., @boinknfts)
    const targetUsername = process.env.TWITTER_TARGET_USERNAME || 'boinknfts';
    const targetUser = await loggedClient.v2.userByUsername(targetUsername);
    const targetUserId = targetUser.data.id;

    // Check if the authenticated USER is following the target account
    // This checks the USER's following list, not the app owner's
    const following = await loggedClient.v2.following(userId, {
      max_results: 1000,
    });

    // Verify if the target account is in the user's following list
    const isFollowing = following.data?.some(
      (user) => user.id === targetUserId
    );

    return {
      isFollowing,
      twitterUserId: userId,
      accessToken,
      accessSecret,
    };
  } catch (error) {
    console.error('Error verifying follow after OAuth:', error);
    throw error;
  }
}

