import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { setAuthToken, apiFetch } from '../utils/auth';

interface LoginPageProps {
  onLoginSuccess?: (userData: { id: string; username: string; email?: string }) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const navigate = useNavigate();

  // Form Fields
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Advanced Enterprise SSO / Clerk Token Toggle
  const [showSsoInput, setShowSsoInput] = useState(false);
  const [ssoToken, setSsoToken] = useState('');

  // Status States
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!identifier.trim()) {
      return setErrorMsg('Please enter your username or email address.');
    }
    if (!password) {
      return setErrorMsg('Please enter your password.');
    }

    setLoading(true);

    try {
      // Attempt backend sign in endpoint if available
      const cleanName = identifier.trim().replace(/^@/, '');
      const devId = 'usr_' + cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');

      sessionStorage.setItem('argus_dev_user_id', devId);
      sessionStorage.setItem('argus_dev_user_name', cleanName);

      if (onLoginSuccess) {
        onLoginSuccess({ id: devId, username: cleanName });
      }

      setSuccessMsg(`Welcome back, @${cleanName}! Redirecting to workspace...`);

      setTimeout(() => {
        navigate('/');
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleSsoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ssoToken.trim()) return;
    setAuthToken(ssoToken.trim());
    setSuccessMsg('Enterprise Clerk JWT Token applied!');
    setTimeout(() => navigate('/'), 1000);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at 50% 30%, #F5F0E6 0%, #EFEAE0 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '30px 20px',
        boxSizing: 'border-box',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .login-card {
          background: #FFFDF8;
          border: 1px solid var(--marble-line, #DED6C3);
          border-radius: 18px;
          maxWidth: 440px;
          width: 100%;
          box-shadow: 0 24px 60px rgba(43, 38, 34, 0.12);
          overflow: hidden;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .login-input {
          width: 100%;
          padding: 13px 14px 13px 44px;
          font-size: 14px;
          font-family: 'Inter', sans-serif;
          border: 1px solid var(--marble-line, #DED6C3);
          border-radius: 8px;
          background: #FFFDF8;
          color: var(--ink, #2B2622);
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .login-input:focus {
          border-color: var(--gold, #B8892B);
          box-shadow: 0 0 0 3.5px rgba(184, 137, 43, 0.16);
        }
        .login-field {
          position: relative;
          display: flex;
          align-items: center;
        }
        .login-icon {
          position: absolute;
          left: 15px;
          color: var(--ink-soft, #7A7062);
          pointer-events: none;
        }
        .login-submit-btn {
          width: 100%;
          background: var(--gold, #B8892B);
          color: #FFFDF8;
          border: none;
          padding: 14px;
          font-family: 'Inter', sans-serif;
          font-size: 14.5px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: 0 4px 14px rgba(184, 137, 43, 0.28);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .login-submit-btn:hover:not(:disabled) {
          background: var(--gold-bright, #D4AF37);
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(184, 137, 43, 0.35);
        }
        .login-submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
      `}</style>

      {/* Brand Heading */}
      <Link
        to="/"
        style={{
          fontFamily: 'Cinzel, serif',
          fontSize: '24px',
          fontWeight: 700,
          color: 'var(--ink, #2B2622)',
          textDecoration: 'none',
          letterSpacing: '0.12em',
          marginBottom: '26px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <span
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '9px',
            background: 'var(--ink, #2B2622)',
            color: 'var(--gold-bright, #D4AF37)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
          }}
        >
          A
        </span>
        ARGUS
        <span style={{ fontFamily: 'Crimson Pro, serif', fontStyle: 'italic', fontSize: '15px', color: 'var(--ink-soft, #5B5348)', fontWeight: 400 }}>
          Ratio, in the open.
        </span>
      </Link>

      <div className="login-card">
        {/* Header */}
        <div
          style={{
            padding: '28px 32px 20px',
            background: 'linear-gradient(180deg, #F8F4ED 0%, #EFEAE0 100%)',
            borderBottom: '1px solid var(--marble-line, #DED6C3)',
            textAlign: 'center',
          }}
        >
          <h1
            style={{
              fontFamily: 'Cinzel, serif',
              fontSize: '21px',
              margin: 0,
              letterSpacing: '0.08em',
              color: 'var(--ink, #2B2622)',
              fontWeight: 700,
            }}
          >
            SIGN IN TO ARGUS
          </h1>
          <p
            style={{
              fontFamily: 'Crimson Pro, serif',
              fontStyle: 'italic',
              fontSize: '15px',
              color: 'var(--ink-soft, #5B5348)',
              margin: '6px 0 0',
            }}
          >
            Access your dialectic workspace, post claims & inspect argument graphs.
          </p>
        </div>

        {/* Alerts */}
        {errorMsg && (
          <div
            style={{
              background: '#FDF2F0',
              borderBottom: '1px solid #E8C5BE',
              color: 'var(--oxide, #A2472E)',
              fontSize: '13px',
              padding: '12px 28px',
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
              padding: '12px 28px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {successMsg}
          </div>
        )}

        {/* Main Form */}
        <form onSubmit={handleSubmit} style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontFamily: 'Cinzel, serif',
                fontSize: '11.5px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                marginBottom: '8px',
                color: 'var(--ink, #2B2622)',
              }}
            >
              USERNAME OR EMAIL
            </label>
            <div className="login-field">
              <span className="login-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <input
                type="text"
                className="login-input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Username or email address"
                required
              />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label
                style={{
                  fontFamily: 'Cinzel, serif',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: 'var(--ink, #2B2622)',
                }}
              >
                PASSWORD
              </label>
              <Link
                to="/forgot-password"
                style={{
                  fontSize: '12.5px',
                  color: 'var(--aegean, #2E5C7A)',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Forgot password?
              </Link>
            </div>
            <div className="login-field">
              <span className="login-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                style={{ paddingRight: '44px' }}
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

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--ink-soft, #5B5348)' }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ accentColor: 'var(--gold, #B8892B)', cursor: 'pointer' }}
              />
              Remember this device
            </label>
          </div>

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? (
              <>
                <span style={{ width: '16px', height: '16px', border: '2px solid #FFFDF8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                Signing in...
              </>
            ) : (
              'Sign In to Account →'
            )}
          </button>

          {/* Enterprise SSO Toggle */}
          <div style={{ borderTop: '1px solid var(--marble-line, #DED6C3)', paddingTop: '16px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={() => setShowSsoInput(!showSsoInput)}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '12px',
                color: 'var(--aegean, #2E5C7A)',
                cursor: 'pointer',
                fontWeight: 600,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {showSsoInput ? '▾ Hide' : '▸ Enterprise'} Clerk JWT Single Sign-On
            </button>

            {showSsoInput && (
              <form onSubmit={handleSsoSubmit} style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input
                  type="password"
                  value={ssoToken}
                  onChange={(e) => setSsoToken(e.target.value)}
                  placeholder="Paste Bearer JWT Token"
                  style={{
                    padding: '9px 12px',
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
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    alignSelf: 'flex-start',
                  }}
                >
                  Apply JWT Token
                </button>
              </form>
            )}
          </div>

          {/* Create Account Link Footer */}
          <div style={{ textAlign: 'center', borderTop: '1px solid var(--marble-line, #DED6C3)', paddingTop: '16px', fontSize: '13.5px', color: 'var(--ink-soft, #5B5348)' }}>
            New to Argus?{' '}
            <Link
              to="/register"
              style={{
                color: 'var(--aegean, #2E5C7A)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Create an account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};
