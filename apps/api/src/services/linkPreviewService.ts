import ogs from 'open-graph-scraper';

export interface LinkPreviewData {
  url: string;
  title: string | null;
  siteName: string | null;
  description: string | null;
  image: string | null;
}

/**
 * Fetches OpenGraph metadata for an external evidence URL.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData> {
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
