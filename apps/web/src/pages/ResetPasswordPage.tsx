import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { apiFetch } from '../utils/auth';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  // Mode: 'forgot' (enter email) OR 'reset' (enter new password using token)
  const mode = token ? 'reset' : 'forgot';

  // Forgot Password State
  const [email, setEmail] = useState('');
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const [resetTokenUrl, setResetTokenUrl] = useState<string | null>(null);

  // Reset Password State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  // General States
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Password Policy Rules
  const hasMinLength = newPassword.length >= 12;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(newPassword);

  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecial;
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const strengthScore = [hasMinLength, hasUppercase, hasLowercase, hasNumber, hasSpecial]
    .filter(Boolean).length * 20;

  const getStrengthColor = () => {
    if (strengthScore <= 40) return '#A2472E';
    if (strengthScore <= 80) return '#B8892B';
    return '#6E7B4A';
  };

  // Validate Token on Page Load in Reset Mode
  useEffect(() => {
    if (token) {
      validateToken(token);
    }
  }, [token]);

  const validateToken = async (tok: string) => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/validate-reset-token', {
        method: 'POST',
        body: JSON.stringify({ token: tok }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setTokenValid(true);
        if (data.email) setEmail(data.email);
      } else {
        setTokenValid(false);
        setErrorMsg(data.error || 'Password reset token is invalid or has expired.');
      }
    } catch (err) {
      setTokenValid(false);
      setErrorMsg('Failed to validate reset token.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setErrorMsg('Please enter a valid email address.');
    }

    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send password reset email.');
      }

      setForgotSubmitted(true);
      setSuccessMsg(data.message || `Password reset link sent to ${email}`);
      if (data.resetUrl) {
        setResetTokenUrl(data.resetUrl);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error processing request.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!isPasswordValid) {
      return setErrorMsg('New password does not satisfy complexity requirements.');
    }

    if (!passwordsMatch) {
      return setErrorMsg('Passwords do not match.');
    }

    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Password reset failed.');
      }

      setResetSuccess(true);
      setSuccessMsg(data.message || 'Password successfully updated!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--marble-bg, #FAF6F0)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '30px 20px',
        boxSizing: 'border-box',
      }}
    >
      <Link
        to="/"
        style={{
          fontFamily: 'Cinzel, serif',
          fontSize: '22px',
          fontWeight: 700,
          color: 'var(--ink, #2B2622)',
          textDecoration: 'none',
          letterSpacing: '0.1em',
          marginBottom: '24px',
        }}
      >
        ARGUS <span style={{ fontFamily: 'Crimson Pro, serif', fontStyle: 'italic', fontSize: '15px', color: 'var(--parchment, #A89070)', fontWeight: 400 }}>Ratio, in the open.</span>
      </Link>

      <div
        style={{
          background: '#FFFDF8',
          border: '1px solid var(--marble-line, #DED6C3)',
          borderRadius: '16px',
          maxWidth: '480px',
          width: '100%',
          boxShadow: '0 20px 40px rgba(0,0,0,0.08)',
          overflow: 'hidden',
        }}
      >
        {/* Title Header */}
        <div
          style={{
            padding: '24px 28px 18px',
            background: 'var(--marble-panel, #F8F4ED)',
            borderBottom: '1px solid var(--marble-line, #DED6C3)',
          }}
        >
          <h1
            style={{
              fontFamily: 'Cinzel, serif',
              fontSize: '20px',
              margin: 0,
              letterSpacing: '0.08em',
              color: 'var(--ink, #2B2622)',
            }}
          >
            {mode === 'forgot' ? 'FORGOT PASSWORD' : 'SET NEW PASSWORD'}
          </h1>
          <p
            style={{
              fontFamily: 'Crimson Pro, serif',
              fontStyle: 'italic',
              fontSize: '15px',
              color: 'var(--ink-soft, #5B5348)',
              margin: '4px 0 0',
            }}
          >
            {mode === 'forgot'
              ? 'Enter your registered email address to receive a single-use password reset link.'
              : 'Choose a strong, compliant new password for your account.'}
          </p>
        </div>

        {/* Notifications */}
        {errorMsg && (
          <div
            style={{
              background: '#FDF2F0',
              borderBottom: '1px solid #E8C5BE',
              color: 'var(--oxide, #A2472E)',
              fontSize: '13px',
              fontFamily: 'Inter, sans-serif',
              padding: '12px 24px',
              fontWeight: 600,
            }}
          >
            ⚠️ {errorMsg}
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
              padding: '12px 24px',
              fontWeight: 600,
            }}
          >
            ✓ {successMsg}
          </div>
        )}

        {/* MODE 1: FORGOT PASSWORD */}
        {mode === 'forgot' && !forgotSubmitted && (
          <form onSubmit={handleForgotSubmit} style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                REGISTERED EMAIL ADDRESS
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.org"
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: '14px',
                  fontFamily: 'Inter, sans-serif',
                  border: '1px solid var(--marble-line, #DED6C3)',
                  borderRadius: '6px',
                  background: '#FFFDF8',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              style={{
                background: 'var(--gold, #B8892B)',
                color: '#FFFDF8',
                border: 'none',
                padding: '12px 20px',
                fontFamily: 'Cinzel, serif',
                fontSize: '13.5px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                borderRadius: '6px',
                cursor: 'pointer',
                opacity: (loading || !email.trim()) ? 0.6 : 1,
              }}
            >
              {loading ? 'Sending Request…' : 'Send Password Reset Link'}
            </button>

            <div style={{ textAlign: 'center', fontSize: '13px', fontFamily: 'Inter, sans-serif', color: 'var(--ink-soft, #5B5348)' }}>
              Remember your password? <Link to="/" style={{ color: 'var(--aegean, #2E5C7A)', fontWeight: 600, textDecoration: 'none' }}>Sign In here</Link>
            </div>
          </form>
        )}

        {/* FORGOT PASSWORD CONFIRMATION SCREEN */}
        {mode === 'forgot' && forgotSubmitted && (
          <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px', textAlign: 'center' }}>
            <div style={{ fontSize: '36px' }}>✉️</div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13.5px', color: 'var(--ink-soft, #5B5348)', lineHeight: 1.5 }}>
              A password reset link has been dispatched to <b>{email}</b>.
            </p>

            {resetTokenUrl && (
              <div style={{ background: '#FFFDF8', border: '1px dashed var(--gold, #B8892B)', padding: '12px', borderRadius: '8px', marginTop: '8px' }}>
                <div style={{ fontSize: '11px', fontFamily: 'Cinzel, serif', fontWeight: 700, color: 'var(--gold, #B8892B)', marginBottom: '6px' }}>
                  DEV SINGLE-USE RESET LINK
                </div>
                <Link
                  to={resetTokenUrl}
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '12.5px',
                    color: 'var(--aegean, #2E5C7A)',
                    wordBreak: 'break-all',
                    fontWeight: 600,
                  }}
                >
                  Click to Reset Password →
                </Link>
              </div>
            )}

            <Link
              to="/"
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '13px',
                color: 'var(--aegean, #2E5C7A)',
                fontWeight: 600,
                textDecoration: 'none',
                marginTop: '12px',
              }}
            >
              ← Back to Sign In
            </Link>
          </div>
        )}

        {/* MODE 2: RESET PASSWORD FORM */}
        {mode === 'reset' && tokenValid === true && !resetSuccess && (
          <form onSubmit={handleResetSubmit} style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div>
              <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                NEW PASSWORD
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 12 chars (A-z, 0-9, special char)"
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: '14px',
                  fontFamily: 'Inter, sans-serif',
                  border: `1px solid ${newPassword ? getStrengthColor() : 'var(--marble-line, #DED6C3)'}`,
                  borderRadius: '6px',
                  background: '#FFFDF8',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />

              {newPassword && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ height: '4px', background: '#EAE4D6', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${strengthScore}%`, height: '100%', background: getStrengthColor(), transition: 'width 0.3s' }}></div>
                  </div>
                </div>
              )}

              {/* Password Requirements Checklist */}
              <div style={{ background: 'var(--marble-panel, #F8F4ED)', border: '1px solid var(--marble-line, #DED6C3)', borderRadius: '6px', padding: '10px 12px', marginTop: '10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 12px', fontSize: '11.5px', fontFamily: 'Inter, sans-serif' }}>
                  <div style={{ color: hasMinLength ? '#6E7B4A' : '#A2472E' }}>
                    {hasMinLength ? '✓' : '✕'} Min 12 characters
                  </div>
                  <div style={{ color: hasUppercase ? '#6E7B4A' : '#A2472E' }}>
                    {hasUppercase ? '✓' : '✕'} Uppercase letter (A-Z)
                  </div>
                  <div style={{ color: hasLowercase ? '#6E7B4A' : '#A2472E' }}>
                    {hasLowercase ? '✓' : '✕'} Lowercase letter (a-z)
                  </div>
                  <div style={{ color: hasNumber ? '#6E7B4A' : '#A2472E' }}>
                    {hasNumber ? '✓' : '✕'} Number (0-9)
                  </div>
                  <div style={{ color: hasSpecial ? '#6E7B4A' : '#A2472E', gridColumn: 'span 2' }}>
                    {hasSpecial ? '✓' : '✕'} Special character (!@#$%^&*...)
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                CONFIRM NEW PASSWORD
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: '14px',
                  fontFamily: 'Inter, sans-serif',
                  border: `1px solid ${confirmPassword ? (passwordsMatch ? '#6E7B4A' : '#A2472E') : 'var(--marble-line, #DED6C3)'}`,
                  borderRadius: '6px',
                  background: '#FFFDF8',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !isPasswordValid || !passwordsMatch}
              style={{
                background: 'var(--gold, #B8892B)',
                color: '#FFFDF8',
                border: 'none',
                padding: '12px 20px',
                fontFamily: 'Cinzel, serif',
                fontSize: '13.5px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                borderRadius: '6px',
                cursor: 'pointer',
                opacity: (loading || !isPasswordValid || !passwordsMatch) ? 0.6 : 1,
              }}
            >
              {loading ? 'Updating Password…' : 'Update & Reset Password'}
            </button>
          </form>
        )}

        {/* RESET PASSWORD SUCCESS SCREEN */}
        {mode === 'reset' && resetSuccess && (
          <div style={{ padding: '28px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '36px' }}>🎉</div>
            <h2 style={{ fontFamily: 'Cinzel, serif', fontSize: '18px', margin: 0, color: 'var(--ink, #2B2622)' }}>
              PASSWORD RESET SUCCESSFUL
            </h2>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13.5px', color: 'var(--ink-soft, #5B5348)' }}>
              Your password has been updated. You can now sign in using your new credentials.
            </p>
            <button
              onClick={() => navigate('/')}
              style={{
                background: 'var(--gold, #B8892B)',
                color: '#FFFDF8',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '6px',
                fontSize: '13px',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign In Now →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
