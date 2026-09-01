/**
 * Authentication and API Client Manager for Argus Web Application.
 *
 * Implements:
 *  - Dual Token Storage (15-min Access Token + 7-day Rotating Refresh Token).
 *  - Silent Token Refresh Interceptor with single-flight mutex on 401 Unauthorized.
 *  - Immediate local & server-side session cleanup on logout / deactivation.
 */

const ACCESS_TOKEN_KEY = 'argus_auth_token';
const REFRESH_TOKEN_KEY = 'argus_refresh_token';

/** Gets active Access Token */
export function getAuthToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

/** Sets active Access Token */
export function setAuthToken(token: string): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
}

/** Gets active Refresh Token */
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

/** Sets active Refresh Token */
export function setRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
}

/** Sets the full active authentication session */
export function setAuthSession(accessToken: string, refreshToken?: string): void {
  setAuthToken(accessToken);
  if (refreshToken) {
    setRefreshToken(refreshToken);
  }
}

/** Clears all tokens from local storage */
export function clearAuthSession(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function clearAuthToken(): void {
  clearAuthSession();
}

/** Generates standard request headers */
export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

// Single-flight promise mutex to prevent concurrent refresh storms
let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempts to silently refresh the access token using the stored refresh token.
 * Uses a single-flight mutex so concurrent 401s reuse the same refresh request.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const currentRefreshToken = getRefreshToken();
  if (!currentRefreshToken) {
    clearAuthSession();
    return null;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: currentRefreshToken }),
      });

      if (!res.ok) {
        clearAuthSession();
        window.dispatchEvent(new CustomEvent('argus_auth_expired'));
        return null;
      }

      const data = await res.json();
      if (data.accessToken) {
        setAuthSession(data.accessToken, data.refreshToken);
        return data.accessToken as string;
      }
      clearAuthSession();
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Standardized fetch wrapper that:
 * 1. Automatically injects active Authorization headers.
 * 2. Catches 401 Unauthorized responses and performs a silent token refresh.
 * 3. Transparently replays the original request with the fresh token.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const initialHeaders = {
    ...getAuthHeaders(),
    ...(init?.headers || {}),
  };

  let response = await fetch(input, {
    ...init,
    headers: initialHeaders,
  });

  // If 401 Unauthorized occurs and we have a refresh token, attempt silent refresh once
  if (response.status === 401 && getRefreshToken()) {
    const newAccessToken = await refreshAccessToken();
    if (newAccessToken) {
      // Re-try the original request with the newly minted access token
      const retryHeaders = {
        ...(init?.headers || {}),
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${newAccessToken}`,
      };

      response = await fetch(input, {
        ...init,
        headers: retryHeaders,
      });
    }
  }

  return response;
}

/** Signs the user out by revoking sessions on the server and clearing local storage */
export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    await apiFetch('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Clear locally regardless of network outcome
  }
  clearAuthSession();
}

/** Deactivates user account and scrubs personal data (GDPR) */
export async function deactivateAccount(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/auth/me/deactivate', {
      method: 'POST',
    });
    if (res.ok) {
      clearAuthSession();
      window.dispatchEvent(new CustomEvent('argus_auth_expired'));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
