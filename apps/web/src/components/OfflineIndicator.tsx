import React, { useState, useEffect } from 'react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowRestored(true);
      const timer = setTimeout(() => setShowRestored(false), 3500);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowRestored(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !showRestored) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        padding: '8px 18px',
        borderRadius: '24px',
        fontSize: '12.5px',
        fontFamily: 'Inter, sans-serif',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        animation: 'slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        background: isOnline ? '#F0F5E8' : '#FFF9EB',
        color: isOnline ? '#4A6B22' : '#8A5D14',
        border: `1px solid ${isOnline ? '#C2DB9D' : '#EED799'}`,
      }}
    >
      <span style={{ fontSize: '14px' }}>{isOnline ? '🟢' : '⚠️'}</span>
      <span>
        {isOnline
          ? 'Agora connection restored. Real-time sync active.'
          : 'Working offline — claim drafts are safely preserved locally.'}
      </span>
    </div>
  );
};
