// Use relative URL if VITE_API_BASE_URL is not set (same domain deployment)
// Otherwise use the configured URL (for separate deployments)
// In development, default to localhost:3001 if not specified
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');

export interface UserData {
  walletAddress: string;
  points: number;
  flips: number;
  twitterFollowed: boolean;
  referralUsed: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

/**
 * Get user data by wallet address
 */
export async function getUser(walletAddress: string): Promise<UserData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/${walletAddress}`);
    const data = await response.json();
    
    if (data.success && data.user) {
      return data.user;
    }
    return null;
  } catch (error) {
    console.error('Error fetching user:', error);
    return null;
  }
}

/**
 * Award points for coin flip
 */
export async function awardFlipPoints(walletAddress: string): Promise<{ success: boolean; points?: number; pointsAwarded?: number; message?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/${walletAddress}/flip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return {
      success: data.success,
      points: data.points,
      pointsAwarded: data.pointsAwarded,
      message: data.message
    };
  } catch (error) {
    console.error('Error awarding flip points:', error);
    return {
      success: false,
      message: 'Failed to award points'
    };
  }
}

/**
 * Get Twitter OAuth URL for verification
 */
export async function getTwitterOAuthUrl(walletAddress: string): Promise<{ success: boolean; oauthUrl?: string; requiresOAuth?: boolean; trustBased?: boolean; message?: string; error?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/${walletAddress}/twitter-oauth`);
    
    if (!response.ok) {
      // Try to parse error response
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: `Server error: ${response.status} ${response.statusText}` };
      }
      
      console.error('Twitter OAuth API error:', response.status, errorData);
      
      // If Twitter API is not configured, return trust-based response
      if (response.status === 500 && errorData.message?.includes('not configured')) {
        return {
          success: false,
          trustBased: true,
          message: 'Twitter API not configured. Using trust-based system.'
        };
      }
      
      return {
        success: false,
        message: errorData.message || `Failed to get OAuth URL: ${response.status}`,
        error: errorData.error
      };
    }
    
    const data = await response.json();
    return {
      success: data.success,
      oauthUrl: data.oauthUrl,
      requiresOAuth: data.requiresOAuth,
      trustBased: data.trustBased,
      message: data.message
    };
  } catch (error) {
    console.error('Error getting Twitter OAuth URL:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get OAuth URL'
    };
  }
}

/**
 * Award points for Twitter follow (trust-based fallback)
 */
export async function awardTwitterFollowPoints(walletAddress: string): Promise<{ success: boolean; points?: number; pointsAwarded?: number; message?: string; requiresOAuth?: boolean }> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/${walletAddress}/twitter-follow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return {
      success: data.success,
      points: data.points,
      pointsAwarded: data.pointsAwarded,
      message: data.message,
      requiresOAuth: data.requiresOAuth
    };
  } catch (error) {
    console.error('Error awarding Twitter follow points:', error);
    return {
      success: false,
      message: 'Failed to award points'
    };
  }
}

/**
 * Award points for referral
 */
export async function awardReferralPoints(walletAddress: string): Promise<{ success: boolean; points?: number; pointsAwarded?: number; message?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/${walletAddress}/referral`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return {
      success: data.success,
      points: data.points,
      pointsAwarded: data.pointsAwarded,
      message: data.message
    };
  } catch (error) {
    console.error('Error awarding referral points:', error);
    return {
      success: false,
      message: 'Failed to award points'
    };
  }
}

/**
 * Get leaderboard
 */
export async function getLeaderboard(limit: number = 10): Promise<Array<{ walletAddress: string; points: number; flips: number }>> {
  try {
    const response = await fetch(`${API_BASE_URL}/users/leaderboard/top?limit=${limit}`);
    const data = await response.json();
    
    if (data.success && data.leaderboard) {
      return data.leaderboard;
    }
    return [];
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return [];
  }
}

