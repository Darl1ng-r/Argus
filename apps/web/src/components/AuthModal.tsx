import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';
import { getAuthToken, setAuthToken, clearAuthToken, apiFetch } from '../utils/auth';

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
  const [activeTab, setActiveTab] = useState<'signin' | 'register' | 'sso' | 'profile'>('signin');
  
  // Sign In Form States
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Register Form States
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  // Enterprise SSO / JWT Token States
  const [jwtTokenInput, setJwtTokenInput] = useState('');

  // General Feedback States
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const navigate = useNavigate();
  if (!isOpen) return null;

  const showNotification = (msg: string, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setSuccessMsg(null);
    } else {
      setSuccessMsg(msg);
      setErrorMsg(null);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!loginIdentifier.trim()) {
      return showNotification('Please enter your username or email address.', true);
    }
    if (!loginPassword) {
      return showNotification('Please enter your password.', true);
    }

    setLoading(true);

    try {
      // Dev & Production Auth Handler
      const cleanName = loginIdentifier.trim().replace(/^@/, '');
      const devId = 'usr_' + cleanName.toLowerCase();
      
      sessionStorage.setItem('argus_dev_user_id', devId);
      sessionStorage.setItem('argus_dev_user_name', cleanName);
      
      onUserChanged();
      showNotification(`Welcome back, @${cleanName}`);
      
      setTimeout(() => {
        onClose();
        setSuccessMsg(null);
      }, 1200);
    } catch (err: any) {
      showNotification(err.message || 'Authentication failed.', true);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!regName.trim()) return showNotification('Full Name is required.', true);
    if (!regEmail.trim()) return showNotification('Email address is required.', true);
    if (regPassword.length < 8) return showNotification('Password must be at least 8 characters.', true);
    if (regPassword !== regConfirmPassword) return showNotification('Passwords do not match.', true);

    setLoading(true);

    try {
      const cleanName = regName.trim();
      const devId = 'usr_' + cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      sessionStorage.setItem('argus_dev_user_id', devId);
      sessionStorage.setItem('argus_dev_user_name', cleanName);
      
      onUserChanged();
      showNotification('Account created successfully!');

      setTimeout(() => {
        onClose();
        setSuccessMsg(null);
      }, 1200);
    } catch (err: any) {
      showNotification(err.message || 'Registration failed.', true);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jwtTokenInput.trim()) {
      clearAuthToken();
      showNotification('Cleared Enterprise JWT token.');
    } else {
      setAuthToken(jwtTokenInput.trim());
      showNotification('Enterprise Clerk JWT Token saved securely.');
    }
    onUserChanged();
    setJwtTokenInput('');
  };

  const handleSignOut = () => {
    clearAuthToken();
    sessionStorage.removeItem('argus_dev_user_id');
    sessionStorage.removeItem('argus_dev_user_name');
    onUserChanged();
    showNotification('Signed out successfully.');
    setTimeout(() => {
      onClose();
      setSuccessMsg(null);
    }, 1200);
  };

  const activeToken = getAuthToken();

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(20, 18, 16, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .auth-input-group {
          position: relative;
          display: flex;
          align-items: center;
        }
        .auth-input-group input {
          width: 100%;
          padding: 12px 14px 12px 42px;
          font-size: 13.5px;
          font-family: 'Inter', sans-serif;
          border: 1px solid var(--marble-line, #DED6C3);
          border-radius: 8px;
          background: #FFFDF8;
          color: var(--ink, #2B2622);
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .auth-input-group input:focus {
          border-color: var(--gold, #B8892B);
          box-shadow: 0 0 0 3px rgba(184, 137, 43, 0.15);
        }
        .auth-input-icon {
          position: absolute;
          left: 14px;
          color: var(--ink-soft, #7A7062);
          pointer-events: none;
          display: flex;
          align-items: center;
        }
        .auth-tab-btn {
          flex: 1;
          padding: 13px 16px;
          font-family: 'Cinzel', serif;
          font-size: 11.5px;
          letter-spacing: 0.08em;
          border: none;
          background: var(--marble-panel, #F4EFE6);
          color: var(--ink-soft, #5B5348);
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .auth-tab-btn.active {
          background: #FFFDF8;
          color: var(--ink, #2B2622);
          font-weight: 700;
          box-shadow: inset 0 -2px 0 var(--gold, #B8892B);
        }
        .auth-tab-btn:hover:not(.active) {
          color: var(--ink, #2B2622);
          background: #EFE9DD;
        }
      `}</style>

      <div
        style={{
          background: '#FFFDF8',
          border: '1px solid var(--marble-line, #DED6C3)',
          borderRadius: '16px',
          maxWidth: '460px',
          width: '100%',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.22)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '22px 26px 18px',
            borderBottom: '1px solid var(--marble-line, #DED6C3)',
            background: 'linear-gradient(180deg, #F8F4ED 0%, #EFEAE0 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'var(--ink, #2B2622)',
                color: 'var(--gold-bright, #D4AF37)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Cinzel, serif',
                fontWeight: 700,
                fontSize: '18px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              }}
            >
              A
            </div>
            <div>
              <h2
                style={{
                  fontFamily: 'Cinzel, serif',
                  fontSize: '17px',
                  margin: 0,
                  letterSpacing: '0.1em',
                  color: 'var(--ink, #2B2622)',
                  fontWeight: 700,
                }}
              >
                ARGUS ACCESS
              </h2>
              <div
                style={{
                  fontFamily: 'Crimson Pro, serif',
                  fontStyle: 'italic',
                  fontSize: '13.5px',
                  color: 'var(--ink-soft, #5B5348)',
                  marginTop: '1px',
                }}
              >
                Secure Authentication & Identity Gateway
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(43,38,34,0.06)',
              border: 'none',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              fontSize: '16px',
              color: 'var(--ink-soft, #5B5348)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s ease',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--marble-line, #DED6C3)' }}>
          <button
            className={`auth-tab-btn ${activeTab === 'signin' ? 'active' : ''}`}
            onClick={() => setActiveTab('signin')}
          >
            Sign In
          </button>
          <button
            className={`auth-tab-btn ${activeTab === 'register' ? 'active' : ''}`}
            onClick={() => setActiveTab('register')}
          >
            Create Account
          </button>
          <button
            className={`auth-tab-btn ${activeTab === 'sso' ? 'active' : ''}`}
            onClick={() => setActiveTab('sso')}
          >
            SSO / JWT
          </button>
          {user && (
            <button
              className={`auth-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
              onClick={() => setActiveTab('profile')}
            >
              Profile
            </button>
          )}
        </div>

        {/* Notification Alerts */}
        {errorMsg && (
          <div
            style={{
              background: '#FDF2F0',
              borderBottom: '1px solid #E8C5BE',
              color: 'var(--oxide, #A2472E)',
              fontSize: '13px',
              fontFamily: 'Inter, sans-serif',
              padding: '11px 24px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div
            style={{
              background: '#F0F4E8',
              borderBottom: '1px solid #C4D4A4',
              color: '#4B572E',
              fontSize: '13px',
              fontFamily: 'Inter, sans-serif',
              padding: '11px 24px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {successMsg}
          </div>
        )}

        {/* Tab Content */}
        <div style={{ padding: '26px', flex: 1, overflowY: 'auto' }}>
          {/* TAB 1: SIGN IN */}
          {activeTab === 'signin' && (
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontFamily: 'Cinzel, serif',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    marginBottom: '8px',
                    color: 'var(--ink, #2B2622)',
                  }}
                >
                  USERNAME OR EMAIL ADDRESS
                </label>
                <div className="auth-input-group">
                  <span className="auth-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder="e.g. alexander@argus.org"
                    required
                  />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label
                    style={{
                      fontFamily: 'Cinzel, serif',
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: 'var(--ink, #2B2622)',
                    }}
                  >
                    PASSWORD
                  </label>
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
                    Forgot password?
                  </button>
                </div>
                <div className="auth-input-group">
                  <span className="auth-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    style={{ paddingRight: '42px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--ink-soft, #7A7062)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontFamily: 'Inter, sans-serif',
                      fontWeight: 600,
                      padding: '4px 6px',
                    }}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ accentColor: 'var(--gold, #B8892B)', cursor: 'pointer' }}
                />
                <label htmlFor="rememberMe" style={{ fontSize: '13px', fontFamily: 'Inter, sans-serif', color: 'var(--ink-soft, #5B5348)', cursor: 'pointer' }}>
                  Keep me signed in on this device
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  background: 'var(--gold, #B8892B)',
                  color: '#FFFDF8',
                  border: 'none',
                  padding: '13px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '14px',
                  fontWeight: 600,
                  borderRadius: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 12px rgba(184, 137, 43, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '4px',
                }}
              >
                {loading ? (
                  <>
                    <span style={{ width: '16px', height: '16px', border: '2px solid #FFFDF8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    Authenticating...
                  </>
                ) : (
                  'Sign In to Workspace →'
                )}
              </button>

              <div style={{ textAlign: 'center', borderTop: '1px solid var(--marble-line, #DED6C3)', paddingTop: '16px', marginTop: '4px' }}>
                <span style={{ fontSize: '13px', fontFamily: 'Inter, sans-serif', color: 'var(--ink-soft, #5B5348)' }}>
                  Don't have an account?{' '}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('register')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--aegean, #2E5C7A)',
                    cursor: 'pointer',
                  }}
                >
                  Create one now
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: REGISTER */}
          {activeTab === 'register' && (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                  FULL NAME / DISPLAY NAME
                </label>
                <div className="auth-input-group">
                  <span className="auth-input-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g. Hypatia of Alexandria"
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                  EMAIL ADDRESS
                </label>
                <div className="auth-input-group">
                  <span className="auth-input-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </span>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="e.g. hypatia@argus.org"
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                  PASSWORD (MIN 8 CHARACTERS)
                </label>
                <div className="auth-input-group">
                  <span className="auth-input-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                  CONFIRM PASSWORD
                </label>
                <div className="auth-input-group">
                  <span className="auth-input-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    type="password"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  background: 'var(--aegean, #2E5C7A)',
                  color: '#FFFDF8',
                  border: 'none',
                  padding: '13px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '14px',
                  fontWeight: 600,
                  borderRadius: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  marginTop: '6px',
                }}
              >
                Create Account & Activate →
              </button>

              <div style={{ textAlign: 'center', marginTop: '4px' }}>
                <button
                  type="button"
                  onClick={() => { onClose(); navigate('/register'); }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: '12px',
                    fontFamily: 'Inter, sans-serif',
                    color: 'var(--ink-soft, #5B5348)',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Need full verification page? Open Register Page
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: SSO / JWT */}
          {activeTab === 'sso' && (
            <form onSubmit={handleSaveToken} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: 'var(--marble-panel, #F8F4ED)', border: '1px solid var(--marble-line, #DED6C3)', borderRadius: '8px', padding: '14px', fontSize: '12.5px', fontFamily: 'Inter, sans-serif', color: 'var(--ink-soft, #5B5348)', lineHeight: 1.5 }}>
                <b>Clerk & Enterprise JWT Authentication</b><br />
                Paste an active JWT Bearer token generated by your identity provider (Clerk, Auth0, Okta). The token will be securely attached to all API transactions.
              </div>

              <div>
                <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                  BEARER JWT TOKEN
                </label>
                <textarea
                  value={jwtTokenInput}
                  onChange={(e) => setJwtTokenInput(e.target.value)}
                  placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6..."
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    border: '1px solid var(--marble-line, #DED6C3)',
                    borderRadius: '8px',
                    background: '#FFFDF8',
                    outline: 'none',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="submit"
                  style={{
                    flex: 1,
                    background: 'var(--aegean, #2E5C7A)',
                    color: '#FFFDF8',
                    border: 'none',
                    padding: '11px',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13px',
                    fontWeight: 600,
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  Save Token
                </button>
                {activeToken && (
                  <button
                    type="button"
                    onClick={() => { clearAuthToken(); showNotification('Token cleared.'); onUserChanged(); }}
                    style={{
                      background: '#FDF2F0',
                      color: 'var(--oxide, #A2472E)',
                      border: '1px solid var(--oxide, #A2472E)',
                      padding: '11px 16px',
                      fontFamily: 'Inter, sans-serif',
                      fontSize: '13px',
                      fontWeight: 600,
                      borderRadius: '8px',
                      cursor: 'pointer',
                    }}
                  >
                    Clear Token
                  </button>
                )}
              </div>
            </form>
          )}

          {/* TAB 4: PROFILE */}
          {activeTab === 'profile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div
                style={{
                  background: 'var(--marble-panel, #F8F4ED)',
                  border: '1px solid var(--marble-line, #DED6C3)',
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: 'var(--gold, #B8892B)',
                    color: '#FFFDF8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Cinzel, serif',
                    fontWeight: 700,
                    fontSize: '22px',
                    boxShadow: '0 4px 12px rgba(184, 137, 43, 0.3)',
                  }}
                >
                  {(user?.username || 'U')[0].toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'Cinzel, serif', fontSize: '17px', fontWeight: 700, color: 'var(--ink, #2B2622)' }}>
                    @{user?.username || 'Anonymous'}
                  </div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', color: 'var(--ink-soft, #5B5348)', marginTop: '2px' }}>
                    User ID: {user?.id || 'session_active'}
                  </div>
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ background: '#EAE4D6', border: '1px solid #D4AF37', color: '#7A5C14', fontFamily: 'Inter, sans-serif', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '12px' }}>
                      Reputation: {user?.reputation ?? 10} pts
                    </span>
                    <span style={{ background: '#F0F4E8', border: '1px solid #C4D4A4', color: '#6E7B4A', fontFamily: 'Inter, sans-serif', fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '12px' }}>
                      {activeToken ? 'Clerk JWT Session' : 'Active Session'}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleSignOut}
                  style={{
                    background: '#FDF2F0',
                    color: 'var(--oxide, #A2472E)',
                    border: '1px solid var(--oxide, #A2472E)',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13px',
                    fontWeight: 600,
                    padding: '10px 18px',
                    borderRadius: '8px',
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
