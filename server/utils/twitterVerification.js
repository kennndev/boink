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
 * Detect if credentials are OAuth 2.0 instead of OAuth 1.0a
 * OAuth 2.0 Client IDs often have specific patterns
 * @param {string} clientId - The client ID to check
 * @returns {boolean} True if likely OAuth 2.0 credentials
 */
function isOAuth2Credentials(clientId) {
  if (!clientId) return false;
  const trimmed = clientId.trim();
  
  // OAuth 2.0 Client IDs often start with specific prefixes or have different patterns
  // Common patterns: longer strings, different character distribution
  // OAuth 1.0a API Keys are typically 20-25 characters, alphanumeric
  // OAuth 2.0 Client IDs are often longer (30+ characters) and may have different formats
  
  // If it's very long (40+ chars), it's likely OAuth 2.0
  if (trimmed.length > 40) {
    return true;
  }
  
  // Check for common OAuth 2.0 patterns (these are heuristics)
  // OAuth 2.0 Client IDs sometimes have different character patterns
  // This is a best-effort detection
  
  return false;
}

/**
 * Validate Twitter API credentials format
 * @returns {Object} Validation result with isValid flag and issues array
 */
function validateTwitterCredentials() {
  const issues = [];
  const warnings = [];
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;

  if (!clientId) {
    issues.push('TWITTER_CLIENT_ID is not set');
  } else {
    const trimmedId = clientId.trim();
    if (trimmedId === '') {
      issues.push('TWITTER_CLIENT_ID is empty');
    } else if (trimmedId.length < 10) {
      issues.push('TWITTER_CLIENT_ID appears to be too short (should be 20+ characters)');
    }
    
    // Check for OAuth 2.0 credentials (common mistake)
    if (isOAuth2Credentials(trimmedId) || trimmedId.length > 35) {
      warnings.push('⚠️  CRITICAL: Your TWITTER_CLIENT_ID appears to be OAuth 2.0 credentials, but this code requires OAuth 1.0a credentials!\n' +
        '   → You need to use "API Key" and "API Key Secret" from the "Consumer Keys" section\n' +
        '   → NOT "OAuth 2.0 Client ID" and "OAuth 2.0 Client Secret"\n' +
        '   → Enable OAuth 1.0a in your Twitter App → "User authentication settings"');
    }
    
    // Check for common issues
    if (trimmedId.includes(' ')) {
      issues.push('TWITTER_CLIENT_ID contains spaces (may need trimming)');
    }
    if (trimmedId.startsWith('"') || trimmedId.endsWith('"')) {
      issues.push('TWITTER_CLIENT_ID appears to have quotes around it (remove quotes)');
    }
  }

  if (!clientSecret) {
    issues.push('TWITTER_CLIENT_SECRET is not set');
  } else {
    const trimmedSecret = clientSecret.trim();
    if (trimmedSecret === '') {
      issues.push('TWITTER_CLIENT_SECRET is empty');
    } else if (trimmedSecret.length < 10) {
      issues.push('TWITTER_CLIENT_SECRET appears to be too short (should be 40+ characters)');
    }
    
    // Check for common issues
    if (trimmedSecret.includes(' ')) {
      issues.push('TWITTER_CLIENT_SECRET contains spaces (may need trimming)');
    }
    if (trimmedSecret.startsWith('"') || trimmedSecret.endsWith('"')) {
      issues.push('TWITTER_CLIENT_SECRET appears to have quotes around it (remove quotes)');
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * Alternative: Verify using OAuth flow
 * This requires the user to authenticate with Twitter
 */
export async function getTwitterOAuthUrl(callbackUrl, state = null) {
  try {
    // Validate credentials format first
    const validation = validateTwitterCredentials();
    
    // Log warnings (like OAuth 2.0 vs 1.0a mismatch)
    if (validation.warnings && validation.warnings.length > 0) {
      console.error('[Twitter OAuth] ⚠️  WARNING - Credential Type Mismatch:');
      validation.warnings.forEach(warning => console.error(warning));
    }
    
    if (!validation.isValid) {
      let errorMsg = 'Twitter API credentials validation failed:\n' + validation.issues.map(issue => `- ${issue}`).join('\n');
      if (validation.warnings && validation.warnings.length > 0) {
        errorMsg += '\n\n' + validation.warnings.join('\n');
      }
      console.error('[Twitter OAuth] Credential validation failed:', validation.issues);
      throw new Error(errorMsg);
    }

    // Get trimmed credentials
    const clientId = process.env.TWITTER_CLIENT_ID.trim();
    const clientSecret = process.env.TWITTER_CLIENT_SECRET.trim();

    // Log credential info (safely, without exposing full values)
    console.log('[Twitter OAuth] Credential info:', {
      clientIdLength: clientId.length,
      clientSecretLength: clientSecret.length,
      clientIdPrefix: clientId.substring(0, 10) + '...',
      callbackUrl: callbackUrl
    });

    // Create Twitter API client with OAuth 1.0a credentials
    const client = new TwitterApi({
      appKey: clientId,
      appSecret: clientSecret,
    });

    console.log('[Twitter OAuth] Generating OAuth link with callback:', callbackUrl);
    console.log('[Twitter OAuth] Note: Wallet address will be retrieved via oauth_token lookup (OAuth 1.0a doesn\'t support state parameter)');
    
    // Generate OAuth link
    // Note: OAuth 1.0a doesn't support state parameter, so we'll use oauth_token to look up the wallet address
    // The state parameter is kept for potential future OAuth 2.0 support, but won't be used in OAuth 1.0a
    const authOptions = { linkMode: 'authorize' };
    
    const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(
      callbackUrl,
      authOptions
    );

    if (!url || !oauth_token || !oauth_token_secret) {
      throw new Error('Failed to generate OAuth link - missing required data');
    }

    console.log('[Twitter OAuth] Successfully generated OAuth URL');
    return {
      url,
      oauth_token,
      oauth_token_secret,
    };
  } catch (error) {
    console.error('[Twitter OAuth] Error generating Twitter OAuth URL:', error);
    console.error('[Twitter OAuth] Error details:', {
      message: error.message,
      code: error.code,
      twitterErrorCode: error.errors?.[0]?.code,
      twitterErrorMessage: error.errors?.[0]?.message,
      stack: error.stack
    });
    
    // Provide helpful error messages for common issues
    if (error.code === 401 || (error.errors && error.errors[0]?.code === 32)) {
      // Check if this might be an OAuth 2.0 vs 1.0a mismatch
      const clientId = process.env.TWITTER_CLIENT_ID?.trim() || '';
      const mightBeOAuth2 = isOAuth2Credentials(clientId) || clientId.length > 35;
      
      let errorMessage = 'Twitter API authentication failed (Error Code 32). This usually means:\n\n';
      
      if (mightBeOAuth2) {
        errorMessage += '⚠️  **CRITICAL ISSUE DETECTED:** You appear to be using OAuth 2.0 credentials!\n\n' +
        'This code requires OAuth 1.0a credentials, but you\'re using OAuth 2.0 Client ID/Secret.\n\n' +
        '🔧 **FIX THIS FIRST:**\n' +
        '1. Go to https://developer.twitter.com/en/portal/dashboard\n' +
        '2. Select your app → "Keys and tokens" tab\n' +
        '3. Scroll to "Consumer Keys" section (NOT "OAuth 2.0 Client ID and Client Secret")\n' +
        '4. Copy the "API Key" (this is your TWITTER_CLIENT_ID)\n' +
        '5. Copy the "API Key Secret" (this is your TWITTER_CLIENT_SECRET)\n' +
        '6. Update your environment variables with these values\n\n' +
        '📋 **Also enable OAuth 1.0a:**\n' +
        '1. Go to your Twitter App → "User authentication settings"\n' +
        '2. Click "Set up" or "Edit"\n' +
        '3. Enable "OAuth 1.0a"\n' +
        '4. Set App permissions to "Read" (or "Read and Write")\n' +
        '5. Add callback URL: ' + callbackUrl + '\n' +
        '6. Click "Save"\n\n';
      } else {
        errorMessage += '1. ❌ TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET are incorrect or don\'t match\n' +
        '   → Go to https://developer.twitter.com/en/portal/dashboard\n' +
        '   → Select your app → "Keys and tokens" tab\n' +
        '   → Use "API Key" and "API Key Secret" from "Consumer Keys" section (OAuth 1.0a)\n' +
        '   → NOT "OAuth 2.0 Client ID" and "OAuth 2.0 Client Secret"\n' +
        '   → Verify they are from the SAME app\n\n' +
        '2. ❌ OAuth 1.0a is not enabled in your Twitter App\n' +
        '   → Go to your Twitter App → "User authentication settings"\n' +
        '   → Enable "OAuth 1.0a"\n' +
        '   → Set App permissions to "Read" (or "Read and Write")\n' +
        '   → Click "Save"\n\n';
      }
      
      errorMessage += '3. ❌ Callback URL is not registered\n' +
        '   → In "User authentication settings", add this callback URL:\n' +
        '   → ' + callbackUrl + '\n' +
        '   → Click "Save" (very important!)\n\n' +
        '4. ❌ Credentials have extra spaces or quotes\n' +
        '   → Check your .env file or Vercel environment variables\n' +
        '   → Remove any quotes, spaces, or newlines\n' +
        '   → Redeploy after updating\n\n' +
        '5. ❌ Twitter App is suspended or inactive\n' +
        '   → Check Twitter Developer Portal for any warnings\n' +
        '   → Ensure your developer account is active\n\n' +
        'After fixing, wait 2-3 minutes for changes to propagate, then try again.';
      
      const detailedError = new Error(errorMessage);
      detailedError.originalError = error;
      detailedError.code = 401;
      detailedError.twitterErrorCode = 32;
      throw detailedError;
    }
    
    throw error;
  }
}

/**
 * Verify follow after OAuth callback
 * IMPORTANT: This function authenticates the USER's Twitter account (the person who clicked "Verify"),
 * NOT the app owner's account. Each user authenticates separately with their own Twitter account.
 */
export async function verifyFollowAfterOAuth(oauthToken, oauthVerifier, oauthTokenSecret) {
  try {
    console.log('[Twitter Verification] Starting OAuth verification...');
    
    const client = new TwitterApi({
      appKey: process.env.TWITTER_CLIENT_ID,
      appSecret: process.env.TWITTER_CLIENT_SECRET,
      accessToken: oauthToken,
      accessSecret: oauthTokenSecret,
    });

    // Complete OAuth flow - this authenticates the USER's Twitter account (not the app owner)
    // Each user who clicks "Verify" will authenticate with their own Twitter account
    console.log('[Twitter Verification] Completing OAuth login...');
    const { client: loggedClient, accessToken, accessSecret } = await client.login(oauthVerifier);

    // Get the authenticated USER's Twitter ID (the person who clicked "Verify")
    // This will be DIFFERENT for each user who authenticates
    // User A gets their Twitter ID, User B gets their Twitter ID, etc.
    // Use v1.1 API to avoid requiring Project attachment (v2 API requires Project)
    console.log('[Twitter Verification] Getting authenticated user info...');
    const v1Client = loggedClient.v1; // Access v1.1 API (doesn't require Project attachment)
    const account = await v1Client.verifyCredentials();
    const userId = account.id_str; // This is the USER's Twitter ID, not the app owner's!
    const username = account.screen_name;
    
    console.log(`[Twitter Verification] Authenticated as Twitter user: @${username} (ID: ${userId})`);
    console.log(`[Twitter Verification] This is the USER's account, not the app owner's account`);

    // Get the target account to check if user is following (e.g., @boinknfts)
    const targetUsername = process.env.TWITTER_TARGET_USERNAME || 'boinknfts';
    console.log(`[Twitter Verification] Checking if @${username} is following @${targetUsername}...`);
    
    // Use the friendships/show endpoint (v1.1) to directly check follow status
    // This endpoint doesn't require Project attachment and is more efficient
    try {
      const relationship = await v1Client.friendship({
        source_id: userId,
        target_screen_name: targetUsername,
      });

      // Check if the source user (authenticated user) is following the target
      const isFollowing = relationship.relationship?.source?.following === true;
      
      console.log(`[Twitter Verification] Result: @${username} ${isFollowing ? 'IS' : 'IS NOT'} following @${targetUsername}`);
      
      return {
        isFollowing,
        twitterUserId: userId,
        twitterUsername: username,
        accessToken,
        accessSecret,
      };
    } catch (friendshipError) {
      // If friendships/show fails, provide detailed error
      console.error('[Twitter Verification] friendships/show endpoint failed:', friendshipError.message);
      console.error('[Twitter Verification] Error details:', {
        code: friendshipError.code,
        data: friendshipError.data
      });
      
      // Provide helpful error message
      if (friendshipError.code === 403) {
        throw new Error(
          'Twitter API access denied. Please check:\n' +
          '1. Your Twitter App has "Read" or "Read and Write" permissions\n' +
          '2. OAuth 1.0a is enabled in your Twitter App settings\n' +
          '3. The user has authorized your app with the correct permissions\n' +
          `Original error: ${friendshipError.message}`
        );
      }
      
      throw new Error(`Failed to verify follow status: ${friendshipError.message}`);
    }
  } catch (error) {
    console.error('[Twitter Verification] Error verifying follow after OAuth:', error);
    console.error('[Twitter Verification] Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}

