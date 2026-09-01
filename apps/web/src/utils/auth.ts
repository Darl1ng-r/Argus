/**
 * Authentication and API Client Manager for Argus Web Application.
 *
 * Stores the JWT issued by the Argus API in sessionStorage.
 * Attaches `Authorization: Bearer <token>` to all outgoing API requests.
 */

const TOKEN_KEY = 'argus_auth_token';

/** Gets the active Bearer JWT token from sessionStorage. */
export function getAuthToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

/** Sets the active Bearer JWT token in sessionStorage. */
export function setAuthToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

/** Clears the active Bearer JWT token from sessionStorage. */
export function clearAuthToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * Generates standard request headers for API requests.
 * Always includes `Authorization: Bearer <token>` when a token is present.
 */
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

/**
 * Standardized fetch wrapper that automatically injects auth headers.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = {
    ...getAuthHeaders(),
    ...(init?.headers || {}),
  };

  return fetch(input, {
    ...init,
    headers,
  });
}

/**
 * Signs the user out by blacklisting the token on the server,
 * then clearing the local session.
 */
export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Ignore network errors — clear locally regardless
  }
  clearAuthToken();
}

// ── Legacy dev-mode helpers kept for backward compat but no longer used ──────
/** @deprecated No longer used — kept so old imports don't break */
export function getDevUserCredentials(): { id: string; name: string } {
  return { id: 'legacy', name: 'legacy' };
}
/** @deprecated No longer used */
export function switchDevUser(): { id: string; name: string } {
  return { id: 'legacy', name: 'legacy' };
}
