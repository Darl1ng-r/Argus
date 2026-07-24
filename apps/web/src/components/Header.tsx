import React from 'react';
import { ViewMode } from '../types';

interface HeaderProps {
  topicTitle: string;
  viewMode: ViewMode;
  onSelectViewMode: (mode: ViewMode) => void;
  onFork: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  topicTitle,
  viewMode,
  onSelectViewMode,
  onFork
}) => {
  return (
    <header>
      <div className="brand">
        <h1>ARGUS</h1>
        <span className="tag">Ratio, in the open.</span>
      </div>
      
      <div className="topic-line">
        <b>{topicTitle}</b>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
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
      </div>
    </header>
  );
};
