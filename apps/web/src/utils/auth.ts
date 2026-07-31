/**
 * Authentication and API Client Manager for Argus Web Application.
 *
 * Enforces standard Bearer token header authentication flow:
 *  - Stores auth tokens securely in sessionStorage.
 *  - Attaches `Authorization: Bearer <token>` to all outgoing API requests.
 *  - Provides dev mode session user fallback without exposing raw identity in persistent localStorage.
 */

const TOKEN_KEY = 'argus_auth_token';
const DEV_USER_ID_KEY = 'argus_dev_user_id';
const DEV_USER_NAME_KEY = 'argus_dev_user_name';

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

/** Gets or initializes dev mode user session credentials in sessionStorage. */
export function getDevUserCredentials(): { id: string; name: string } {
  let devId = sessionStorage.getItem(DEV_USER_ID_KEY);
  let devName = sessionStorage.getItem(DEV_USER_NAME_KEY);

  if (!devId) {
    devId = 'usr_' + Math.random().toString(36).substring(2, 9);
    devName = 'User_' + devId.slice(4);
    sessionStorage.setItem(DEV_USER_ID_KEY, devId);
    sessionStorage.setItem(DEV_USER_NAME_KEY, devName);
  }

  return { id: devId, name: devName || 'User' };
}

/** Switches dev mode user session credentials. */
export function switchDevUser(): { id: string; name: string } {
  const names = ['Athena', 'Socrates', 'Hypatia', 'Aristotle', 'Diogenes', 'Cleopatra'];
  const randomName = names[Math.floor(Math.random() * names.length)];
  const newId = 'usr_' + randomName.toLowerCase() + '_' + Math.floor(Math.random() * 100);

  sessionStorage.setItem(DEV_USER_ID_KEY, newId);
  sessionStorage.setItem(DEV_USER_NAME_KEY, randomName);

  return { id: newId, name: randomName };
}

/**
 * Generates standard request headers for API requests.
 * Always includes `Authorization: Bearer <token>` header.
 * Fix 4: X-User-Id / X-User-Name headers are ONLY sent in DEV builds.
 * In production (import.meta.env.DEV === false) they are never emitted,
 * preventing accidental bypass if ALLOW_DEV_AUTH were ever misconfigured.
 */
export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  const devUser = getDevUserCredentials();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (import.meta.env.DEV) {
    // Dev-only fallback: send a recognisable-but-fake Bearer token and the
    // custom X-User-Id / X-User-Name headers the ALLOW_DEV_AUTH path reads.
    headers['Authorization'] = `Bearer dev_session_${devUser.id}`;
    headers['X-User-Id'] = devUser.id;
    headers['X-User-Name'] = devUser.name;
  }
  // In production without a token: no Authorization header is sent.
  // The server will treat the request as unauthenticated (401 on protected routes).

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
