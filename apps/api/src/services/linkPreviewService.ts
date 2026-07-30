import ogs from 'open-graph-scraper';
import dns from 'node:dns/promises';

export interface LinkPreviewData {
  url: string;
  title: string | null;
  siteName: string | null;
  description: string | null;
  image: string | null;
}

// ---------------------------------------------------------------------------
// Private IP / sensitive range blocklist (for both hostname and resolved IP)
// ---------------------------------------------------------------------------
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254', // AWS / GCP metadata
  'metadata.google.internal',
  'metadata.internal',
]);

/**
 * Checks whether a raw hostname or IP string falls within a private/restricted range.
 * Used for BOTH the pre-fetch hostname check AND the post-DNS-resolution IP check.
 */
function isPrivateHostOrIp(host: string): boolean {
  const h = host.toLowerCase().trim();

  if (BLOCKED_HOSTNAMES.has(h)) return true;

  // .local / .internal TLDs (mDNS, Kubernetes, cloud internals)
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;

  // RFC 1918 private IPv4 ranges
  if (/^10\./.test(h)) return true;                              // 10.0.0.0/8
  if (/^192\.168\./.test(h)) return true;                        // 192.168.0.0/16
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;   // 172.16.0.0/12
  if (/^0\./.test(h)) return true;                               // 0.x.x.x (invalid source)

  // Link-local IPv4 (covers 169.254.x.x metadata variants)
  if (/^169\.254\./.test(h)) return true;

  // Loopback range 127.0.0.0/8
  if (/^127\./.test(h)) return true;

  // IPv6 loopback / link-local / ULA
  if (/^::1$/.test(h)) return true;
  if (/^fe80:/i.test(h)) return true;    // IPv6 link-local
  if (/^fc00:/i.test(h)) return true;    // IPv6 ULA
  if (/^fd/i.test(h)) return true;       // IPv6 ULA (fd00::/8)

  return false;
}

/**
 * Validates that a target URL:
 *  1. Has an http: or https: scheme.
 *  2. Its hostname does not match any private/internal range (string check).
 *  3. Its hostname resolves via DNS to a non-private IP address (DNS rebinding fix).
 *
 * Returns false if ANY check fails.
 */
async function isSafeExternalUrl(targetUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return false;

  const hostname = parsed.hostname.toLowerCase();

  // Step 1: Reject obviously private hostnames before hitting DNS
  if (isPrivateHostOrIp(hostname)) return false;

  // Step 2: Resolve DNS and validate the resolved IP addresses.
  // This defeats DNS Rebinding attacks where the hostname first resolves to a public IP
  // (passing the string check) and then re-resolves to a private IP on the actual fetch.
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateHostOrIp(address)) {
        return false; // Resolved to a private IP — block it
      }
    }
  } catch {
    // DNS resolution failed entirely — treat as unsafe
    return false;
  }

  return true;
}

/**
 * Fetches OpenGraph metadata for an external evidence URL.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData> {
  // Await the async DNS-resolving check (was previously synchronous — SSRF fix)
  const safe = await isSafeExternalUrl(url);
  if (!safe) {
    let domain = url;
    try { domain = new URL(url).hostname; } catch {}
    return {
      url,
      title: domain,
      siteName: domain,
      description: 'External link (preview restricted for internal addresses)',
      image: null,
    };
  }

  try {
    const options = { url, timeout: 5000 };
    const { result } = await ogs(options);

    return {
      url,
      title: result.ogTitle || result.twitterTitle || null,
      siteName: result.ogSiteName || null,
      description: result.ogDescription || result.twitterDescription || null,
      image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || null,
    };
  } catch (err) {
    // Graceful fallback on failed metadata fetch
    let domain = url;
    try {
      domain = new URL(url).hostname;
    } catch {
      // Ignore URL parsing error
    }

    return {
      url,
      title: domain,
      siteName: domain,
      description: 'External evidence source link',
      image: null,
    };
  }
}
