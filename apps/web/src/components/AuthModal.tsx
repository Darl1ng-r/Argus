import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';
import { setAuthSession, logout, deactivateAccount } from '../utils/auth';

interface AuthModalProps {
  isOpen: boolean;
  user: User | null;
  /** Which tab to open initially */
  initialTab?: 'signin' | 'register' | 'profile';
  noticeMessage?: string | null;
  onClose: () => void;
  onUserChanged: () => void;
}

type Tab = 'signin' | 'register' | 'verify' | 'profile';

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  user,
  initialTab,
  noticeMessage,
  onClose,
  onUserChanged,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>(
    user ? 'profile' : (initialTab || 'signin')
  );

  // Reset tab when modal open state changes
  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(user ? 'profile' : (initialTab || 'signin'));
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsDeactivating(false);
  }, [isOpen, user, initialTab]);

  // Sign In states
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Register states
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  // Email verify states
  const [pendingEmail, setPendingEmail] = useState('');
  const [devCode, setDevCode] = useState('');
  const [verifyCode, setVerifyCode] = useState('');

  // Deactivate state
  const [isDeactivating, setIsDeactivating] = useState(false);

  // General feedback
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const navigate = useNavigate();

  if (!isOpen) return null;

  const showError = (msg: string) => { setErrorMsg(msg); setSuccessMsg(null); };
  const showSuccess = (msg: string) => { setSuccessMsg(msg); setErrorMsg(null); };

  // ── Sign In ────────────────────────────────────────────────────────────────

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!loginIdentifier.trim()) return showError('Please enter your username or email address.');
    if (!loginPassword) return showError('Please enter your password.');

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loginIdentifier.trim(), password: loginPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.error || 'Authentication failed.');
        return;
      }

      setAuthSession(data.accessToken || data.token, data.refreshToken);
      onUserChanged();
      showSuccess(`Welcome back, @${data.user.username}!`);
      setTimeout(() => { onClose(); setSuccessMsg(null); }, 1000);
    } catch {
      showError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Register ───────────────────────────────────────────────────────────────

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!regName.trim()) return showError('Full name is required.');
    if (!regEmail.trim()) return showError('Email address is required.');
    if (regPassword.length < 8) return showError('Password must be at least 8 characters.');
    if (regPassword !== regConfirmPassword) return showError('Passwords do not match.');

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          email: regEmail.trim(),
          password: regPassword,
          confirmPassword: regConfirmPassword,
          termsAccepted: true,
          privacyAccepted: true,
          captchaToken: 'dev_bypass',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.error || 'Registration failed.');
        return;
      }

      setPendingEmail(data.email);
      setDevCode(data.devCode || '');
      setVerifyCode(data.devCode || '');
      setActiveTab('verify');
      setErrorMsg(null);
    } catch {
      showError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Verify Email ───────────────────────────────────────────────────────────

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!verifyCode.trim() || verifyCode.trim().length !== 6) {
      return showError('Please enter the 6-digit verification code.');
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail, code: verifyCode.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.error || 'Verification failed.');
        return;
      }

      setAuthSession(data.accessToken || data.token, data.refreshToken);
      onUserChanged();
      showSuccess(`Welcome to Argus, @${data.user.username}!`);
      setTimeout(() => { onClose(); setSuccessMsg(null); }, 1200);
    } catch {
      showError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Sign Out ───────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await logout();
    } finally {
      setLoading(false);
    }
    onUserChanged();
    showSuccess('Signed out successfully.');
    setTimeout(() => { onClose(); setSuccessMsg(null); }, 900);
  };

  // ── GDPR Account Deactivation ──────────────────────────────────────────────

  const handleDeactivate = async () => {
    setLoading(true);
    try {
      const ok = await deactivateAccount();
      if (ok) {
        onUserChanged();
        showSuccess('Account successfully deleted and data scrubbed in compliance with GDPR.');
        setTimeout(() => { onClose(); setSuccessMsg(null); }, 1500);
      } else {
        showError('Failed to deactivate account. Please try again.');
      }
    } catch {
      showError('An error occurred during account deactivation.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(20, 18, 16, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'authFadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      <style>{`
        @keyframes authFadeIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .auth-input-wrap { position: relative; display: flex; align-items: center; }
        .auth-input-wrap input {
          width: 100%; padding: 12px 14px 12px 42px;
          font-size: 13.5px; font-family: 'Inter', sans-serif;
          border: 1px solid var(--marble-line, #DED6C3); border-radius: 8px;
          background: #FFFDF8; color: var(--ink, #2B2622); outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease; box-sizing: border-box;
        }
        .auth-input-wrap input:focus { border-color: var(--gold, #B8892B); box-shadow: 0 0 0 3px rgba(184,137,43,0.15); }
        .auth-icon { position: absolute; left: 14px; color: var(--ink-soft, #7A7062); pointer-events: none; display: flex; align-items: center; }
        .auth-tab { flex: 1; padding: 13px 8px; font-family: 'Cinzel', serif; font-size: 11px;
          letter-spacing: 0.08em; border: none; background: var(--marble-panel, #F4EFE6);
          color: var(--ink-soft, #5B5348); cursor: pointer; transition: all 0.15s ease; }
        .auth-tab.active { background: #FFFDF8; color: var(--ink, #2B2622); font-weight: 700; box-shadow: inset 0 -2px 0 var(--gold, #B8892B); }
        .auth-tab:hover:not(.active) { background: #EFE9DD; color: var(--ink, #2B2622); }
        .auth-btn-primary {
          background: var(--gold, #B8892B); color: #FFFDF8; border: none; padding: 13px;
          font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; border-radius: 8px;
          cursor: pointer; box-shadow: 0 4px 12px rgba(184,137,43,0.25);
          display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
          transition: opacity 0.15s ease;
        }
        .auth-btn-primary:disabled { opacity: 0.65; cursor: not-allowed; }
        .auth-btn-secondary {
          background: var(--aegean, #2E5C7A); color: #FFFDF8; border: none; padding: 13px;
          font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; border-radius: 8px;
          cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; transition: opacity 0.15s ease;
        }
        .auth-btn-secondary:disabled { opacity: 0.65; cursor: not-allowed; }
        .auth-label { display: block; font-family: 'Cinzel', serif; font-size: 10.5px; font-weight: 700;
          letter-spacing: 0.08em; margin-bottom: 7px; color: var(--ink, #2B2622); }
        .auth-field { display: flex; flex-direction: column; }
        .auth-code-input {
          width: 100%; padding: 16px; font-size: 28px; letter-spacing: 0.3em; font-weight: 700;
          text-align: center; font-family: 'Inter', sans-serif;
          border: 2px solid var(--gold, #B8892B); border-radius: 10px; background: #FFFDF8;
          color: var(--ink, #2B2622); outline: none; box-sizing: border-box;
        }
        .auth-code-input:focus { box-shadow: 0 0 0 3px rgba(184,137,43,0.2); }
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
          maxHeight: '90vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--marble-line, #DED6C3)',
          background: 'linear-gradient(180deg, #F8F4ED 0%, #EFEAE0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '9px',
              background: 'var(--ink, #2B2622)', color: 'var(--gold-bright, #D4AF37)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Cinzel, serif', fontWeight: 700, fontSize: '17px',
            }}>A</div>
            <div>
              <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '16px', margin: 0, letterSpacing: '0.1em', color: 'var(--ink, #2B2622)', fontWeight: 700 }}>
                {activeTab === 'profile' ? 'YOUR PROFILE' : 'ARGUS ACCESS'}
              </h2>
              <div style={{ fontFamily: 'Crimson Pro, serif', fontStyle: 'italic', fontSize: '13px', color: 'var(--ink-soft, #5B5348)', marginTop: '1px' }}>
                {activeTab === 'profile' ? `@${user?.username}` : 'Security & Identity Gateway'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(43,38,34,0.06)', border: 'none', width: '30px', height: '30px',
            borderRadius: '50%', fontSize: '15px', color: 'var(--ink-soft)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>

        {/* Tab Navigation */}
        {activeTab !== 'verify' && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--marble-line, #DED6C3)' }}>
            {!user && (
              <>
                <button className={`auth-tab ${activeTab === 'signin' ? 'active' : ''}`} onClick={() => { setActiveTab('signin'); setErrorMsg(null); }}>
                  Sign In
                </button>
                <button className={`auth-tab ${activeTab === 'register' ? 'active' : ''}`} onClick={() => { setActiveTab('register'); setErrorMsg(null); }}>
                  Create Account
                </button>
              </>
            )}
            {user && (
              <button className="auth-tab active" style={{ cursor: 'default' }}>
                Account Settings & Security
              </button>
            )}
          </div>
        )}

        {/* Alerts */}
        {noticeMessage && !errorMsg && !successMsg && (
          <div style={{ background: '#FFF9E6', borderBottom: '1px solid #FFE099', color: '#8A6D0B', fontSize: '13px', fontFamily: 'Inter', padding: '11px 24px', fontWeight: 600, lineHeight: 1.4 }}>
            🔒 {noticeMessage}
          </div>
        )}
        {errorMsg && (
          <div style={{ background: '#FDF2F0', borderBottom: '1px solid #E8C5BE', color: 'var(--oxide, #A2472E)', fontSize: '13px', fontFamily: 'Inter', padding: '11px 24px', fontWeight: 600 }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{ background: '#F0F4E8', borderBottom: '1px solid #C4D4A4', color: '#4B572E', fontSize: '13px', fontFamily: 'Inter', padding: '11px 24px', fontWeight: 600 }}>
            ✓ {successMsg}
          </div>
        )}

        {/* Tab Content */}
        <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>

          {/* ── SIGN IN ── */}
          {activeTab === 'signin' && (
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="auth-field">
                <label className="auth-label">USERNAME OR EMAIL ADDRESS</label>
                <div className="auth-input-wrap">
                  <span className="auth-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input type="text" value={loginIdentifier} onChange={(e) => setLoginIdentifier(e.target.value)} placeholder="e.g. alexander or alexander@argus.org" autoComplete="username" />
                </div>
              </div>

              <div className="auth-field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                  <label className="auth-label" style={{ margin: 0 }}>PASSWORD</label>
                  <button type="button" onClick={() => { onClose(); navigate('/forgot-password'); }}
                    style={{ background: 'transparent', border: 'none', fontSize: '12px', fontFamily: 'Inter', color: 'var(--aegean, #2E5C7A)', cursor: 'pointer', fontWeight: 500 }}>
                    Forgot password?
                  </button>
                </div>
                <div className="auth-input-wrap">
                  <span className="auth-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input type={showPassword ? 'text' : 'password'} value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="••••••••••••" style={{ paddingRight: '50px' }} autoComplete="current-password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '12px', background: 'transparent', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '11px', fontFamily: 'Inter', fontWeight: 600 }}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button type="submit" className="auth-btn-primary" disabled={loading}>
                {loading ? <><span style={{ width: '16px', height: '16px', border: '2px solid #FFFDF8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Authenticating…</> : 'Sign In to Workspace →'}
              </button>

              <div style={{ textAlign: 'center', borderTop: '1px solid var(--marble-line)', paddingTop: '14px' }}>
                <span style={{ fontSize: '13px', fontFamily: 'Inter', color: 'var(--ink-soft)' }}>Don't have an account?{' '}</span>
                <button type="button" onClick={() => { setActiveTab('register'); setErrorMsg(null); }}
                  style={{ background: 'transparent', border: 'none', fontFamily: 'Inter', fontSize: '13px', fontWeight: 600, color: 'var(--aegean, #2E5C7A)', cursor: 'pointer' }}>
                  Create one now
                </button>
              </div>
            </form>
          )}

          {/* ── REGISTER ── */}
          {activeTab === 'register' && (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="auth-field">
                <label className="auth-label">FULL NAME / DISPLAY NAME</label>
                <div className="auth-input-wrap">
                  <span className="auth-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="e.g. Hypatia of Alexandria" autoComplete="name" />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label">EMAIL ADDRESS</label>
                <div className="auth-input-wrap">
                  <span className="auth-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
                    </svg>
                  </span>
                  <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="e.g. hypatia@argus.org" autoComplete="email" />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label">PASSWORD (MIN 8 CHARACTERS)</label>
                <div className="auth-input-wrap">
                  <span className="auth-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="••••••••••••" autoComplete="new-password" />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label">CONFIRM PASSWORD</label>
                <div className="auth-input-wrap">
                  <span className="auth-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input type="password" value={regConfirmPassword} onChange={(e) => setRegConfirmPassword(e.target.value)} placeholder="••••••••••••" autoComplete="new-password" />
                </div>
              </div>

              <button type="submit" className="auth-btn-secondary" disabled={loading}>
                {loading ? <><span style={{ width: '16px', height: '16px', border: '2px solid #FFFDF8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Creating Account…</> : 'Create Account & Activate →'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <span style={{ fontSize: '13px', fontFamily: 'Inter', color: 'var(--ink-soft)' }}>Already have an account?{' '}</span>
                <button type="button" onClick={() => { setActiveTab('signin'); setErrorMsg(null); }}
                  style={{ background: 'transparent', border: 'none', fontFamily: 'Inter', fontSize: '13px', fontWeight: 600, color: 'var(--aegean, #2E5C7A)', cursor: 'pointer' }}>
                  Sign in
                </button>
              </div>
            </form>
          )}

          {/* ── VERIFY EMAIL ── */}
          {activeTab === 'verify' && (
            <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '40px', marginBottom: '10px' }}>📬</div>
                <h3 style={{ fontFamily: 'Cinzel, serif', fontSize: '15px', margin: '0 0 8px', color: 'var(--ink)' }}>VERIFY YOUR EMAIL</h3>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', color: 'var(--ink-soft)', lineHeight: 1.5, margin: 0 }}>
                  We sent a 6-digit code to <strong>{pendingEmail}</strong>
                </p>
              </div>

              {devCode && (
                <div style={{ background: '#F0F4E8', border: '1px solid #C4D4A4', borderRadius: '8px', padding: '12px 16px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'Cinzel, serif', fontSize: '10px', color: '#4B572E', letterSpacing: '0.08em', marginBottom: '4px' }}>DEV MODE — YOUR CODE</div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '28px', fontWeight: 700, color: '#4B572E', letterSpacing: '0.3em' }}>{devCode}</div>
                </div>
              )}

              <div className="auth-field">
                <label className="auth-label" style={{ textAlign: 'center' }}>ENTER 6-DIGIT CODE</label>
                <input
                  className="auth-code-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                />
              </div>

              <button type="submit" className="auth-btn-primary" disabled={loading || verifyCode.length !== 6}>
                {loading ? <><span style={{ width: '16px', height: '16px', border: '2px solid #FFFDF8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Verifying…</> : 'Verify & Activate Account →'}
              </button>

              <div style={{ textAlign: 'center' }}>
                <button type="button" onClick={() => { setActiveTab('register'); setVerifyCode(''); setDevCode(''); setErrorMsg(null); }}
                  style={{ background: 'transparent', border: 'none', fontFamily: 'Inter', fontSize: '12px', color: 'var(--ink-soft)', cursor: 'pointer' }}>
                  ← Back to registration
                </button>
              </div>
            </form>
          )}

          {/* ── PROFILE ── */}
          {activeTab === 'profile' && user && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Avatar + Info Card */}
              <div style={{ background: 'var(--marble-panel, #F8F4ED)', border: '1px solid var(--marble-line)', borderRadius: '12px', padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{
                  width: '58px', height: '58px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--gold, #B8892B), #D4AF37)',
                  color: '#FFFDF8', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Cinzel, serif', fontWeight: 700, fontSize: '24px',
                  boxShadow: '0 4px 12px rgba(184,137,43,0.3)',
                }}>
                  {(user.username || 'U')[0].toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'Cinzel, serif', fontSize: '18px', fontWeight: 700, color: 'var(--ink)' }}>
                    @{user.username}
                  </div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', color: 'var(--ink-soft)', marginTop: '2px' }}>
                    {user.email}
                  </div>
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ background: '#EAE4D6', border: '1px solid #D4AF37', color: '#7A5C14', fontFamily: 'Inter', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '12px' }}>
                      ⭐ {user.reputation} rep
                    </span>
                    <span style={{ background: '#F0F4E8', border: '1px solid #C4D4A4', color: '#6E7B4A', fontFamily: 'Inter', fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '12px' }}>
                      🛡️ Rotating Token Pair Active
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={handleSignOut}
                  disabled={loading}
                  style={{
                    background: 'var(--marble-panel)', color: 'var(--ink)',
                    border: '1px solid var(--marble-line)',
                    fontFamily: 'Inter', fontSize: '13px', fontWeight: 600,
                    padding: '11px 18px', borderRadius: '8px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    width: '100%',
                  }}
                >
                  {loading ? 'Signing Out…' : '→ Sign Out'}
                </button>

                {!isDeactivating ? (
                  <button
                    onClick={() => setIsDeactivating(true)}
                    type="button"
                    style={{
                      background: 'transparent', color: 'var(--oxide, #A2472E)',
                      border: '1px dashed rgba(162, 71, 46, 0.4)',
                      fontFamily: 'Inter', fontSize: '12px', fontWeight: 500,
                      padding: '8px 14px', borderRadius: '6px', cursor: 'pointer',
                      marginTop: '8px',
                    }}
                  >
                    Delete Account & Scrub Data (GDPR)
                  </button>
                ) : (
                  <div style={{ background: '#FDF2F0', border: '1px solid #E8C5BE', borderRadius: '8px', padding: '14px', marginTop: '6px' }}>
                    <div style={{ fontFamily: 'Cinzel, serif', fontSize: '12px', fontWeight: 700, color: 'var(--oxide)', marginBottom: '6px' }}>
                      CONFIRM ACCOUNT DELETION
                    </div>
                    <p style={{ fontFamily: 'Inter', fontSize: '12px', color: 'var(--ink)', lineHeight: 1.45, margin: '0 0 12px' }}>
                      In compliance with GDPR, your email and credentials will be permanently erased. Your argument steles will remain on the public marble as anonymous contributions.
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={handleDeactivate}
                        disabled={loading}
                        style={{
                          flex: 1, background: 'var(--oxide, #A2472E)', color: '#FFFDF8',
                          border: 'none', padding: '8px 12px', borderRadius: '6px',
                          fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        {loading ? 'Scrubbing…' : 'Confirm Permanent Deletion'}
                      </button>
                      <button
                        onClick={() => setIsDeactivating(false)}
                        disabled={loading}
                        style={{
                          background: 'transparent', color: 'var(--ink)',
                          border: '1px solid var(--marble-line)', padding: '8px 12px',
                          borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
