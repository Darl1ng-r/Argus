import ogs from 'open-graph-scraper';

export interface LinkPreviewData {
  url: string;
  title: string | null;
  siteName: string | null;
  description: string | null;
  image: string | null;
}

/**
 * Validates that a target URL does not resolve to private, loopback, or cloud metadata IP addresses (SSRF Protection).
 */
function isSafeExternalUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;

    const hostname = parsed.hostname.toLowerCase();
    
    // Block loopback, localhost, and cloud metadata endpoints
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '169.254.169.254' || // AWS/GCP Metadata
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local')
    ) {
      return false;
    }

    // Block private RFC1918 IPv4 ranges (10.x.x.x, 172.16.x.x - 172.31.x.x, 192.168.x.x)
    if (
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^0\./.test(hostname)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches OpenGraph metadata for an external evidence URL.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData> {
  if (!isSafeExternalUrl(url)) {
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
