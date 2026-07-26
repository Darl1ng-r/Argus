import React, { useEffect, useState } from 'react';

interface LinkPreviewData {
  url: string;
  title: string | null;
  siteName: string | null;
  description: string | null;
  image: string | null;
}

interface LinkPreviewCardProps {
  url: string;
}

export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = ({ url }) => {
  const [data, setData] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: LinkPreviewData | null) => {
        if (isMounted && data) {
          setData(data);
        }
      })
      .catch(() => {
        // Fallback domain display on network error
        if (isMounted) {
          try {
            const domain = new URL(url).hostname;
            setData({ url, title: domain, siteName: domain, description: null, image: null });
          } catch {
            setData(null);
          }
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [url]);

  if (loading) {
    return (
      <div
        style={{
          marginTop: '10px',
          padding: '10px 14px',
          background: 'var(--marble-panel, #F3ECE0)',
          borderRadius: '6px',
          fontSize: '12px',
          color: 'var(--parchment, #A89070)',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        Fetching evidence preview…
      </div>
    );
  }

  if (!data) return null;

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        gap: '12px',
        marginTop: '12px',
        padding: '12px',
        background: '#FFFDF8',
        border: '1px solid var(--marble-line, #DED6C3)',
        borderRadius: '8px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 0.2s',
      }}
    >
      {data.image && (
        <img
          src={data.image}
          alt=""
          style={{
            width: '64px',
            height: '64px',
            objectFit: 'cover',
            borderRadius: '6px',
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {data.siteName && (
          <div
            style={{
              fontSize: '10px',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 700,
              color: 'var(--gold, #B8892B)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: '2px',
            }}
          >
            {data.siteName}
          </div>
        )}
        <div
          style={{
            fontSize: '13px',
            fontFamily: 'Crimson Pro, serif',
            fontWeight: 600,
            color: 'var(--ink, #2B2622)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {data.title || data.url}
        </div>
        {data.description && (
          <div
            style={{
              fontSize: '11.5px',
              fontFamily: 'Inter, sans-serif',
              color: 'var(--ink-soft, #5A524A)',
              marginTop: '4px',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              lineHeight: 1.35,
            }}
          >
            {data.description}
          </div>
        )}
      </div>
    </a>
  );
};
