import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';
import { getAuthToken, setAuthToken, clearAuthToken } from '../utils/auth';

interface AuthModalProps {
  isOpen: boolean;
  user: User | null;
  onClose: () => void;
  onUserChanged: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  user,
  onClose,
  onUserChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'signin'>('signin');
  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [showAdvancedToken, setShowAdvancedToken] = useState(false);
  const [jwtTokenInput, setJwtTokenInput] = useState('');
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);

  const navigate = useNavigate();
  if (!isOpen) return null;

  const handleSwitchPersona = (personaName: string) => {
    const devId = 'usr_' + personaName.toLowerCase() + '_' + Math.floor(Math.random() * 100);
    sessionStorage.setItem('argus_dev_user_id', devId);
    sessionStorage.setItem('argus_dev_user_name', personaName);
    onUserChanged();
    setTokenMsg(`Signed in as @${personaName}`);
    setTimeout(() => setTokenMsg(null), 2500);
  };

  const handleCustomLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim()) return;
    const cleanName = usernameInput.trim().replace(/^@/, '');
    const devId = 'usr_' + cleanName.toLowerCase();
    sessionStorage.setItem('argus_dev_user_id', devId);
    sessionStorage.setItem('argus_dev_user_name', cleanName);
    onUserChanged();
    setUsernameInput('');
    setEmailInput('');
    setTokenMsg(`Successfully signed in as @${cleanName}`);
    setTimeout(() => setTokenMsg(null), 2500);
  };

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jwtTokenInput.trim()) {
      clearAuthToken();
      setTokenMsg('Cleared authentication token.');
    } else {
      setAuthToken(jwtTokenInput.trim());
      setTokenMsg('Bearer JWT Token saved to session.');
    }
    onUserChanged();
    setJwtTokenInput('');
    setTimeout(() => setTokenMsg(null), 2500);
  };

  const handleSignOut = () => {
    clearAuthToken();
    sessionStorage.removeItem('argus_dev_user_id');
    sessionStorage.removeItem('argus_dev_user_name');
    onUserChanged();
    setTokenMsg('Signed out successfully.');
    setTimeout(() => setTokenMsg(null), 2000);
  };

  const personas = [
    { name: 'Socrates', role: 'Philosopher of Dialectic', icon: '🏛️' },
    { name: 'Athena', role: 'Goddess of Wisdom', icon: '🦉' },
    { name: 'Aristotle', role: 'Master of Logic', icon: '📜' },
    { name: 'Hypatia', role: 'Neoplatonist Scholar', icon: '🌌' },
    { name: 'Diogenes', role: 'Cynic Logician', icon: '🏮' },
  ];

  const activeToken = getAuthToken();

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(43, 38, 34, 0.45)',
        backdropFilter: 'blur(4px)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#FFFDF8',
          border: '1px solid var(--marble-line, #DED6C3)',
          borderRadius: '14px',
          maxWidth: '500px',
          width: '100%',
          boxShadow: '0 24px 48px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--marble-line, #DED6C3)',
            background: 'var(--marble-panel, #F8F4ED)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: 'Cinzel, serif',
                fontSize: '18px',
                margin: 0,
                letterSpacing: '0.08em',
                color: 'var(--ink, #2B2622)',
              }}
            >
              USER AUTHENTICATION
            </h2>
            <div
              style={{
                fontFamily: 'Crimson Pro, serif',
                fontStyle: 'italic',
                fontSize: '14px',
                color: 'var(--ink-soft, #5B5348)',
                marginTop: '2px',
              }}
            >
              Sign in to post claims, vote, and build reputation
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '18px',
              color: 'var(--ink-soft, #5B5348)',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Status Notification */}
        {tokenMsg && (
          <div
            style={{
              background: '#F0F4E8',
              borderBottom: '1px solid #C4D4A4',
              color: '#4B572E',
              fontSize: '13px',
              fontFamily: 'Inter, sans-serif',
              padding: '10px 24px',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            ✓ {tokenMsg}
          </div>
        )}

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--marble-line, #DED6C3)',
            background: '#FFFDF8',
          }}
        >
          <button
            onClick={() => setActiveTab('signin')}
            style={{
              flex: 1,
              padding: '12px',
              fontFamily: 'Cinzel, serif',
              fontSize: '12px',
              letterSpacing: '0.06em',
              background: activeTab === 'signin' ? '#FFFDF8' : 'var(--marble-panel, #F8F4ED)',
              border: 'none',
              borderBottom: activeTab === 'signin' ? '2px solid var(--gold, #B8892B)' : 'none',
              color: activeTab === 'signin' ? 'var(--ink, #2B2622)' : 'var(--ink-soft, #5B5348)',
              cursor: 'pointer',
              fontWeight: activeTab === 'signin' ? 700 : 500,
            }}
          >
            Sign In / Switch Account
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            style={{
              flex: 1,
              padding: '12px',
              fontFamily: 'Cinzel, serif',
              fontSize: '12px',
              letterSpacing: '0.06em',
              background: activeTab === 'profile' ? '#FFFDF8' : 'var(--marble-panel, #F8F4ED)',
              border: 'none',
              borderBottom: activeTab === 'profile' ? '2px solid var(--gold, #B8892B)' : 'none',
              color: activeTab === 'profile' ? 'var(--ink, #2B2622)' : 'var(--ink-soft, #5B5348)',
              cursor: 'pointer',
              fontWeight: activeTab === 'profile' ? 700 : 500,
            }}
          >
            My Profile & Reputation
          </button>
        </div>

        {/* Tab Body */}
        <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
          {activeTab === 'signin' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Create Account Link Banner */}
              <div style={{ textAlign: 'center', background: 'var(--marble-panel, #F8F4ED)', border: '1px solid #DED6C3', borderRadius: '8px', padding: '12px 16px' }}>
                <div style={{ fontSize: '13px', fontFamily: 'Inter, sans-serif', color: 'var(--ink, #2B2622)', fontWeight: 600, marginBottom: '4px' }}>
                  Need a new production account?
                </div>
                <button
                  type="button"
                  onClick={() => { onClose(); navigate('/register'); }}
                  style={{
                    background: 'var(--aegean, #2E5C7A)',
                    color: '#FFFDF8',
                    border: 'none',
                    padding: '8px 18px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontFamily: 'Cinzel, serif',
                    fontWeight: 700,
                    cursor: 'pointer',
                    letterSpacing: '0.06em',
                  }}
                >
                  Create Production Account →
                </button>
              </div>
              {/* Quick Persona Picker */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'Cinzel, serif',
                    fontSize: '12px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    marginBottom: '10px',
                    color: 'var(--ink, #2B2622)',
                  }}
                >
                  QUICK SIGN IN AS PERSONA
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                  {personas.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => handleSwitchPersona(p.name)}
                      style={{
                        background: user?.username?.toLowerCase() === p.name.toLowerCase() ? 'var(--marble-panel, #F8F4ED)' : '#FFFDF8',
                        border: user?.username?.toLowerCase() === p.name.toLowerCase() ? '2px solid var(--gold, #B8892B)' : '1px solid var(--marble-line, #DED6C3)',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      <span style={{ fontSize: '20px' }}>{p.icon}</span>
                      <div>
                        <div style={{ fontFamily: 'Cinzel, serif', fontSize: '13px', fontWeight: 700, color: 'var(--ink, #2B2622)' }}>
                          @{p.name}
                        </div>
                        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '10.5px', color: 'var(--ink-soft, #5B5348)' }}>
                          {p.role}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Username / Email Form */}
              <form onSubmit={handleCustomLogin} style={{ borderTop: '1px solid var(--marble-line, #DED6C3)', paddingTop: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'Cinzel, serif',
                    fontSize: '12px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    marginBottom: '8px',
                    color: 'var(--ink, #2B2622)',
                  }}
                >
                  OR ENTER USERNAME / EMAIL
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    placeholder="Username (e.g. Hypatia)"
                    style={{
                      padding: '10px 14px',
                      fontSize: '13.5px',
                      fontFamily: 'Inter, sans-serif',
                      border: '1px solid var(--marble-line, #DED6C3)',
                      borderRadius: '6px',
                      background: '#FFFDF8',
                      outline: 'none',
                    }}
                  />
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="Email address (optional)"
                    style={{
                      padding: '10px 14px',
                      fontSize: '13.5px',
                      fontFamily: 'Inter, sans-serif',
                      border: '1px solid var(--marble-line, #DED6C3)',
                      borderRadius: '6px',
                      background: '#FFFDF8',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      background: 'var(--gold, #B8892B)',
                      color: '#FFFDF8',
                      border: 'none',
                      padding: '10px 18px',
                      fontFamily: 'Inter, sans-serif',
                      fontSize: '13px',
                      fontWeight: 600,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      marginTop: '4px',
                    }}
                  >
                    Sign In to Account
                  </button>

                  <div style={{ textAlign: 'right', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => { onClose(); navigate('/forgot-password'); }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: '12px',
                        fontFamily: 'Inter, sans-serif',
                        color: 'var(--aegean, #2E5C7A)',
                        cursor: 'pointer',
                        fontWeight: 500,
                        padding: 0,
                      }}
                    >
                      Forgot Password?
                    </button>
                  </div>
                </div>
              </form>

              {/* Advanced Token Collapsible Toggle */}
              <div style={{ borderTop: '1px solid var(--marble-line, #DED6C3)', paddingTop: '14px' }}>
                <button
                  type="button"
                  onClick={() => setShowAdvancedToken(!showAdvancedToken)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '12px',
                    color: 'var(--aegean, #2E5C7A)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: 0,
                  }}
                >
                  {showAdvancedToken ? '▾ Hide' : '▸ Advanced:'} Clerk Production JWT Token
                </button>

                {showAdvancedToken && (
                  <form onSubmit={handleSaveToken} style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '11.5px', fontFamily: 'Inter, sans-serif', color: 'var(--ink-soft, #5B5348)', marginBottom: '8px' }}>
                      Paste a raw Clerk Authorization Bearer JWT token to authenticate against a production API deployment.
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="password"
                        value={jwtTokenInput}
                        onChange={(e) => setJwtTokenInput(e.target.value)}
                        placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6..."
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                          border: '1px solid var(--marble-line, #DED6C3)',
                          borderRadius: '6px',
                          background: '#FFFDF8',
                          outline: 'none',
                        }}
                      />
                      <button
                        type="submit"
                        style={{
                          background: 'var(--aegean, #2E5C7A)',
                          color: '#FFFDF8',
                          border: 'none',
                          padding: '8px 14px',
                          fontFamily: 'Inter, sans-serif',
                          fontSize: '12px',
                          fontWeight: 600,
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        Save Token
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {activeTab === 'profile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Profile Summary Card */}
              <div
                style={{
                  background: 'var(--marble-panel, #F8F4ED)',
                  border: '1px solid var(--marble-line, #DED6C3)',
                  borderRadius: '10px',
                  padding: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    width: '54px',
                    height: '54px',
                    borderRadius: '50%',
                    background: 'var(--gold, #B8892B)',
                    color: '#FFFDF8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Cinzel, serif',
                    fontWeight: 700,
                    fontSize: '22px',
                  }}
                >
                  {(user?.username || 'U')[0].toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontFamily: 'Cinzel, serif',
                      fontSize: '16px',
                      fontWeight: 700,
                      color: 'var(--ink, #2B2622)',
                    }}
                  >
                    @{user?.username || 'Anonymous'}
                  </div>
                  <div
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize: '12px',
                      color: 'var(--ink-soft, #5B5348)',
                      marginTop: '2px',
                    }}
                  >
                    User ID: {user?.id || 'dev_session'}
                  </div>
                  <div style={{ marginTop: '8px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span
                      style={{
                        background: '#EAE4D6',
                        border: '1px solid #D4AF37',
                        color: '#7A5C14',
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: '12px',
                      }}
                    >
                      Reputation: {user?.reputation ?? 0} pts
                    </span>
                    <span
                      style={{
                        background: '#F0F4E8',
                        border: '1px solid #C4D4A4',
                        color: '#6E7B4A',
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '3px 10px',
                        borderRadius: '12px',
                      }}
                    >
                      {activeToken ? 'Clerk JWT Token' : 'Active Session'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Account Permissions Matrix */}
              <div>
                <h4
                  style={{
                    fontFamily: 'Cinzel, serif',
                    fontSize: '13px',
                    margin: '0 0 8px',
                    letterSpacing: '0.06em',
                    color: 'var(--ink, #2B2622)',
                  }}
                >
                  ACCOUNT PERMISSIONS
                </h4>
                <div
                  style={{
                    fontSize: '13px',
                    fontFamily: 'Inter, sans-serif',
                    color: 'var(--ink-soft, #5B5348)',
                    lineHeight: 1.5,
                    background: '#FFFDF8',
                    border: '1px solid var(--marble-line, #DED6C3)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                  }}
                >
                  • <b>Topic Owner:</b> Edit root claim, moderate claims, toggle steelman status, delete topic.<br />
                  • <b>Contributor:</b> Add new claim nodes, vote on support/contest, flag claims.<br />
                  • <b>Rate Limits:</b> 15 mutations/min, 30 votes/min per authenticated IP.
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
                <button
                  onClick={handleSignOut}
                  style={{
                    background: '#FDF2F0',
                    color: 'var(--oxide, #A2472E)',
                    border: '1px solid var(--oxide, #A2472E)',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '8px 16px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Sign Out / Reset Session
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
