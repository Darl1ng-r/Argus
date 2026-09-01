import React from 'react';
import { ViewMode, User } from '../types';
import { useTranslation, Language } from '../i18n';

interface HeaderProps {
  topicTitle: string;
  viewMode: ViewMode;
  user: User | null;
  isPrivate?: boolean;
  isOwner?: boolean;
  onBack?: () => void;
  onSelectViewMode: (mode: ViewMode) => void;
  onFork: () => void;
  onOpenSearch?: () => void;
  onExport?: (format: 'png' | 'svg' | 'markdown') => void;
  onSwitchUser?: () => void;
  onOpenAuthModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  topicTitle,
  viewMode,
  user,
  isPrivate,
  isOwner,
  onBack,
  onSelectViewMode,
  onFork,
  onOpenSearch,
  onExport,
  onSwitchUser,
  onOpenAuthModal,
}) => {
  const [isExportOpen, setIsExportOpen] = React.useState(false);
  const { language, setLanguage, t } = useTranslation();

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 24px',
        background: 'rgba(255, 253, 248, 0.96)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--marble-line, #DED6C3)',
        boxShadow: '0 2px 10px rgba(43, 38, 34, 0.04)',
        zIndex: 100,
        gap: '16px',
        flexWrap: 'nowrap',
      }}
    >
      {/* Left: Brand & Back Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
        {onBack && (
          <button
            onClick={onBack}
            title="Return to Explore All Debates"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '20px',
              border: '1px solid var(--marble-line, #DED6C3)',
              background: '#FFFDF8',
              color: 'var(--ink-soft, #5A534B)',
              fontFamily: 'Inter, sans-serif',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--gold, #8F6414)';
              e.currentTarget.style.color = 'var(--gold, #8F6414)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--marble-line, #DED6C3)';
              e.currentTarget.style.color = 'var(--ink-soft, #5A534B)';
            }}
          >
            <span>←</span>
            <span>Debates</span>
          </button>
        )}

        <div className="brand" style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <h1 style={{ fontFamily: 'Cinzel, serif', fontSize: '20px', letterSpacing: '0.12em', margin: 0, color: 'var(--ink, #2B2622)', fontWeight: 700 }}>
            ARGUS
          </h1>
          <span className="tag" style={{ fontFamily: 'Crimson Pro, serif', fontStyle: 'italic', fontSize: '13px', color: 'var(--ink-soft, #7A7268)' }}>
            {t.brandTagline}
          </span>
        </div>
      </div>

      {/* Center: Topic Title */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
          padding: '0 16px',
        }}
      >
        <div
          title={topicTitle}
          style={{
            fontFamily: 'Cinzel, serif',
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--ink, #2B2622)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '500px',
            textAlign: 'center',
            letterSpacing: '0.02em',
          }}
        >
          {topicTitle}
        </div>
      </div>

      {/* Right: Actions, View Modes, Fork, Language, Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        {/* Search button */}
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            title="Search claims in debate (Ctrl+F)"
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '12px',
              fontWeight: 600,
              background: '#FFFDF8',
              color: 'var(--ink, #2B2622)',
              border: '1px solid var(--marble-line, #DED6C3)',
              padding: '6px 12px',
              borderRadius: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'border-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--gold, #8F6414)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--marble-line, #DED6C3)')}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>Search</span>
            <span style={{ fontSize: '10px', opacity: 0.6, background: 'rgba(0,0,0,0.05)', padding: '1px 5px', borderRadius: '4px' }}>Ctrl+F</span>
          </button>
        )}

        {/* Export Dropdown */}
        {onExport && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setIsExportOpen(!isExportOpen)}
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                background: '#FFFDF8',
                color: 'var(--aegean, #2E5C7A)',
                border: '1px solid var(--marble-line, #DED6C3)',
                padding: '6px 12px',
                borderRadius: '20px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--aegean, #2E5C7A)';
                e.currentTarget.style.background = '#F2F7FA';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--marble-line, #DED6C3)';
                e.currentTarget.style.background = '#FFFDF8';
              }}
            >
              <span>Export ▾</span>
            </button>

            {isExportOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '8px',
                  background: '#FFFDF8',
                  border: '1px solid var(--marble-line, #DED6C3)',
                  borderRadius: '8px',
                  boxShadow: '0 12px 28px rgba(43,38,34,0.15)',
                  zIndex: 200,
                  minWidth: '190px',
                  overflow: 'hidden',
                  animation: 'fadeIn 0.15s ease-out',
                }}
              >
                <div
                  onClick={() => {
                    onExport('png');
                    setIsExportOpen(false);
                  }}
                  style={{ padding: '10px 14px', fontSize: '12.5px', fontFamily: 'Inter, sans-serif', cursor: 'pointer', borderBottom: '1px solid var(--marble-line)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#F9F6F0')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  🖼️ PNG Image (High-Res)
                </div>
                <div
                  onClick={() => {
                    onExport('svg');
                    setIsExportOpen(false);
                  }}
                  style={{ padding: '10px 14px', fontSize: '12.5px', fontFamily: 'Inter, sans-serif', cursor: 'pointer', borderBottom: '1px solid var(--marble-line)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#F9F6F0')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  📐 SVG Vector Image
                </div>
                <div
                  onClick={() => {
                    onExport('markdown');
                    setIsExportOpen(false);
                  }}
                  style={{ padding: '10px 14px', fontSize: '12.5px', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#F9F6F0')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  📝 Markdown Outline (.md)
                </div>
              </div>
            )}
          </div>
        )}

        {/* View Mode Switcher: Segmented Control */}
        <nav
          style={{
            display: 'flex',
            background: '#F0ECE1',
            borderRadius: '20px',
            padding: '3px',
            border: '1px solid var(--marble-line, #DED6C3)',
          }}
        >
          <button
            onClick={() => onSelectViewMode('graph')}
            style={{
              padding: '5px 12px',
              fontSize: '11px',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 700,
              letterSpacing: '0.04em',
              border: 'none',
              borderRadius: '16px',
              cursor: 'pointer',
              background: viewMode === 'graph' ? '#FFFDF8' : 'transparent',
              color: viewMode === 'graph' ? 'var(--ink, #2B2622)' : 'var(--ink-soft, #7A7268)',
              boxShadow: viewMode === 'graph' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            GRAPH
          </button>
          <button
            onClick={() => onSelectViewMode('steelman')}
            style={{
              padding: '5px 12px',
              fontSize: '11px',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 700,
              letterSpacing: '0.04em',
              border: 'none',
              borderRadius: '16px',
              cursor: 'pointer',
              background: viewMode === 'steelman' ? '#FFFDF8' : 'transparent',
              color: viewMode === 'steelman' ? 'var(--gold, #8F6414)' : 'var(--ink-soft, #7A7268)',
              boxShadow: viewMode === 'steelman' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            STEELMAN
          </button>
          <button
            onClick={() => onSelectViewMode('diff')}
            style={{
              padding: '5px 12px',
              fontSize: '11px',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 700,
              letterSpacing: '0.04em',
              border: 'none',
              borderRadius: '16px',
              cursor: 'pointer',
              background: viewMode === 'diff' ? '#FFFDF8' : 'transparent',
              color: viewMode === 'diff' ? 'var(--aegean, #2E5C7A)' : 'var(--ink-soft, #7A7268)',
              boxShadow: viewMode === 'diff' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            DIFF
          </button>
        </nav>

        {/* Fork Button */}
        <button
          onClick={onFork}
          title={!isOwner ? 'Fork this debate to your profile to add and modify claims' : 'Create a new fork of this debate'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '20px',
            border: 'none',
            background: 'var(--gold, #8F6414)',
            color: '#FFFDF8',
            fontFamily: 'Inter, sans-serif',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(143, 100, 20, 0.25)',
            transition: 'transform 0.1s ease, box-shadow 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(143, 100, 20, 0.35)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(143, 100, 20, 0.25)';
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="12" cy="18" r="3" />
            <path d="M6 9v3a3 3 0 003 3h1M18 9v3a3 3 0 01-3 3h-1" />
          </svg>
          <span>Fork</span>
        </button>

        {/* Language Selector */}
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          title="Select Agora Language"
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '11.5px',
            fontWeight: 600,
            background: '#FFFDF8',
            color: 'var(--ink, #2B2622)',
            border: '1px solid var(--marble-line, #DED6C3)',
            padding: '5px 8px',
            borderRadius: '16px',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="ar">العربية</option>
          <option value="fr">Français</option>
          <option value="el">Ἑλληνικά</option>
        </select>

        {/* User Pill / Sign-in */}
        {user ? (
          <button
            onClick={onOpenAuthModal || onSwitchUser}
            title="Authentication & Profile settings"
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '11.5px',
              fontWeight: 600,
              background: '#FFFDF8',
              color: 'var(--ink, #2B2622)',
              border: '1px solid var(--marble-line, #DED6C3)',
              padding: '5px 12px',
              borderRadius: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'border-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--gold, #8F6414)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--marble-line, #DED6C3)')}
          >
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--laurel, #5B693A)' }}></span>
            <span>@{user.username}</span>
          </button>
        ) : (
          <button
            onClick={onOpenAuthModal}
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '11.5px',
              fontWeight: 700,
              background: 'var(--gold, #8F6414)',
              color: '#FFFDF8',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '20px',
              cursor: 'pointer',
            }}
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
};
