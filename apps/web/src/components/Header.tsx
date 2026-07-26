import React from 'react';
import { ViewMode, User } from '../types';

interface HeaderProps {
  topicTitle: string;
  viewMode: ViewMode;
  user: User | null;
  isLive?: boolean;
  onSelectViewMode: (mode: ViewMode) => void;
  onFork: () => void;
  onAIAnalyze?: () => void;
  onSwitchUser?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  topicTitle,
  viewMode,
  user,
  isLive,
  onSelectViewMode,
  onFork,
  onAIAnalyze,
  onSwitchUser
}) => {
  return (
    <header>
      <div className="brand">
        <h1>ARGUS</h1>
        <span className="tag">Ratio, in the open.</span>
      </div>
      
      <div className="topic-line" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <b>{topicTitle}</b>
        {isLive && (
          <span
            title="Real-time collaboration live via Server-Sent Events"
            style={{
              fontSize: '10px',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: '#6E7B4A',
              background: '#F0F4E8',
              border: '1px solid #C4D4A4',
              padding: '2px 8px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#6E7B4A', animation: 'pulse 1.5s infinite' }}></span>
            LIVE
          </span>
        )}
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {onAIAnalyze && (
          <button
            onClick={onAIAnalyze}
            title="Analyze logical structure & fallacies using Gemini AI"
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '12px',
              fontWeight: 600,
              background: 'var(--marble-panel)',
              color: 'var(--gold)',
              border: '1px solid var(--gold)',
              padding: '6px 14px',
              borderRadius: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            ✨ AI Analysis
          </button>
        )}
        <nav className="modes">
          <button
            className={viewMode === 'graph' ? 'active' : ''}
            onClick={() => onSelectViewMode('graph')}
          >
            GRAPH
          </button>
          <button
            className={viewMode === 'steelman' ? 'active' : ''}
            onClick={() => onSelectViewMode('steelman')}
          >
            STEELMAN
          </button>
          <button
            className={viewMode === 'diff' ? 'active' : ''}
            onClick={() => onSelectViewMode('diff')}
          >
            DIFF
          </button>
        </nav>
        
        <button className="fork-btn" onClick={onFork}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="12" cy="18" r="3" />
            <path d="M6 9v3a3 3 0 003 3h1M18 9v3a3 3 0 01-3 3h-1" />
          </svg>
          Fork
        </button>

        {user && (
          <button
            onClick={onSwitchUser}
            title="Click to switch test user identity"
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '11px',
              fontWeight: 600,
              background: 'var(--marble-panel)',
              color: 'var(--ink)',
              border: '1px solid var(--marble-line)',
              padding: '6px 12px',
              borderRadius: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--laurel)' }}></span>
            @{user.username}
          </button>
        )}
      </div>
    </header>
  );
};
