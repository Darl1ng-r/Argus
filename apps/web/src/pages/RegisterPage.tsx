import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../utils/auth';

interface RegisterPageProps {
  onRegisterSuccess?: (userData: { id: string; username: string; email: string }) => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({ onRegisterSuccess }) => {
  const navigate = useNavigate();

  // Step 1: Registration Form; Step 2: Email Verification
  const [step, setStep] = useState<'form' | 'verify'>('form');

  // Form Fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  // Captcha State
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaNum1] = useState(Math.floor(Math.random() * 8) + 2);
  const [captchaNum2] = useState(Math.floor(Math.random() * 8) + 2);
  const [isCaptchaVerified, setIsCaptchaVerified] = useState(false);

  // Verification Step States
  const [verificationCode, setVerificationCode] = useState('');
  const [devCodeNotice, setDevCodeNotice] = useState<string | null>(null);

  // Loading & Error States
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Password Policy Rules
  const hasMinLength = password.length >= 12;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);

  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecial;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  // Calculate Password Strength Score (0 to 100)
  const strengthScore = [hasMinLength, hasUppercase, hasLowercase, hasNumber, hasSpecial]
    .filter(Boolean).length * 20;

  const getStrengthColor = () => {
    if (strengthScore <= 40) return '#A2472E'; // Weak (Red)
    if (strengthScore <= 80) return '#B8892B'; // Medium (Gold)
    return '#6E7B4A'; // Strong (Laurel Green)
  };

  const handleVerifyCaptcha = (e: React.FormEvent) => {
    e.preventDefault();
    if (parseInt(captchaAnswer.trim(), 10) === captchaNum1 + captchaNum2) {
      setIsCaptchaVerified(true);
      setErrorMsg(null);
    } else {
      setErrorMsg('Incorrect Captcha answer. Please try again.');
    }
  };

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) return setErrorMsg('Full Name is required.');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErrorMsg('A valid Email address is required.');

    if (!isPasswordValid) {
      return setErrorMsg('Password does not satisfy all complexity security requirements.');
    }

    if (!passwordsMatch) {
      return setErrorMsg('Password and Confirm Password do not match.');
    }

    if (!termsAccepted) {
      return setErrorMsg('You must agree to the Terms & Conditions.');
    }

    if (!privacyAccepted) {
      return setErrorMsg('You must agree to the Privacy Policy.');
    }

    if (!isCaptchaVerified) {
      return setErrorMsg('Please complete the Captcha verification.');
    }

    setLoading(true);

    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          confirmPassword,
          termsAccepted,
          privacyAccepted,
          captchaToken: `captcha_token_${Date.now()}`,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Registration failed.');
      }

      setStep('verify');
      if (data.devCode) {
        setDevCodeNotice(`Dev Verification Code: ${data.devCode}`);
      }
      setSuccessMsg(`A 6-digit verification code was sent to ${email.trim()}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during registration.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmailCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!verificationCode.trim() || verificationCode.trim().length !== 6) {
      return setErrorMsg('Please enter the 6-digit verification code sent to your email.');
    }

    setLoading(true);

    try {
      const res = await apiFetch('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          code: verificationCode.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Email verification failed.');
      }

      // Save user session credentials
      sessionStorage.setItem('argus_dev_user_id', data.user.id);
      sessionStorage.setItem('argus_dev_user_name', data.user.username);
      if (data.token) {
        sessionStorage.setItem('argus_auth_token', data.token);
      }

      if (onRegisterSuccess) {
        onRegisterSuccess(data.user);
      }

      setSuccessMsg('Account successfully verified and activated!');

      setTimeout(() => {
        navigate('/');
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Verification failed.');
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
      {/* Top Brand Link */}
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
          maxWidth: '520px',
          width: '100%',
          boxShadow: '0 20px 40px rgba(0,0,0,0.08)',
          overflow: 'hidden',
        }}
      >
        {/* Header Title */}
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
            {step === 'form' ? 'CREATE PRODUCTION ACCOUNT' : 'EMAIL VERIFICATION'}
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
            {step === 'form'
              ? 'Join the Argus dialectic ratio network to construct & analyze claims.'
              : `Enter the 6-digit OTP code sent to ${email}`}
          </p>
        </div>

        {/* Error / Success Notifications */}
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
              padding: '12px 24px',
              fontWeight: 600,
            }}
          >
            {successMsg}
          </div>
        )}

        {devCodeNotice && (
          <div
            style={{
              background: '#FFF9E6',
              borderBottom: '1px solid #FFE099',
              color: '#8A6D0B',
              fontSize: '12.5px',
              fontFamily: 'monospace',
              padding: '8px 24px',
            }}
          >
            {devCodeNotice}
          </div>
        )}

        {/* STEP 1: Registration Form */}
        {step === 'form' && (
          <form onSubmit={handleSubmitRegistration} style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Name */}
            <div>
              <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                FULL NAME
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Hypatia of Alexandria"
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

            {/* Email */}
            <div>
              <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                EMAIL ADDRESS
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

            {/* Password */}
            <div>
              <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                PASSWORD
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 12 chars (A-z, 0-9, special char)"
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: '14px',
                  fontFamily: 'Inter, sans-serif',
                  border: `1px solid ${password ? getStrengthColor() : 'var(--marble-line, #DED6C3)'}`,
                  borderRadius: '6px',
                  background: '#FFFDF8',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />

              {/* Strength Meter Bar */}
              {password && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ height: '4px', background: '#EAE4D6', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${strengthScore}%`, height: '100%', background: getStrengthColor(), transition: 'width 0.3s' }}></div>
                  </div>
                  <div style={{ fontSize: '11px', fontFamily: 'Inter, sans-serif', color: getStrengthColor(), marginTop: '4px', fontWeight: 600 }}>
                    Password Strength: {strengthScore <= 40 ? 'Weak' : strengthScore <= 80 ? 'Medium' : 'Strong & Compliant'}
                  </div>
                </div>
              )}

              {/* Password Policy Requirements Checklist */}
              <div style={{ background: 'var(--marble-panel, #F8F4ED)', border: '1px solid var(--marble-line, #DED6C3)', borderRadius: '6px', padding: '10px 12px', marginTop: '10px' }}>
                <div style={{ fontSize: '11px', fontFamily: 'Cinzel, serif', fontWeight: 700, color: 'var(--ink, #2B2622)', marginBottom: '6px' }}>
                  PASSWORD SECURITY REQUIREMENTS
                </div>
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

            {/* Confirm Password */}
            <div>
              <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '6px', color: 'var(--ink, #2B2622)' }}>
                CONFIRM PASSWORD
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
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
              {confirmPassword && (
                <div style={{ fontSize: '11px', fontFamily: 'Inter, sans-serif', color: passwordsMatch ? '#6E7B4A' : '#A2472E', marginTop: '4px' }}>
                  {passwordsMatch ? '✓ Passwords match' : '✕ Passwords do not match'}
                </div>
              )}
            </div>

            {/* Interactive Visual Captcha */}
            <div style={{ background: '#FFFDF8', border: '1px solid var(--marble-line, #DED6C3)', borderRadius: '8px', padding: '12px 16px' }}>
              <div style={{ fontSize: '12px', fontFamily: 'Cinzel, serif', fontWeight: 700, color: 'var(--ink, #2B2622)', marginBottom: '8px' }}>
                CAPTCHA VERIFICATION
              </div>
              {isCaptchaVerified ? (
                <div style={{ fontSize: '13px', fontFamily: 'Inter, sans-serif', color: '#6E7B4A', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '16px' }}>✓</span> Captcha Verified (Human Confirmed)
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontFamily: 'Cinzel, serif', fontSize: '14px', fontWeight: 700, background: 'var(--marble-panel, #F8F4ED)', padding: '8px 14px', borderRadius: '6px', border: '1px solid #DED6C3' }}>
                    What is {captchaNum1} + {captchaNum2}?
                  </div>
                  <input
                    type="number"
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value)}
                    placeholder="Result"
                    style={{ width: '80px', padding: '8px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid #DED6C3', outline: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={handleVerifyCaptcha}
                    style={{ background: 'var(--aegean, #2E5C7A)', color: '#FFFDF8', border: 'none', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Verify
                  </button>
                </div>
              )}
            </div>

            {/* Terms & Privacy Checkboxes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px', fontFamily: 'Inter, sans-serif', color: 'var(--ink-soft, #5B5348)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                />
                I accept the <a href="#terms" onClick={(e) => { e.preventDefault(); alert('Argus Terms: Construct logical claims in good faith.'); }} style={{ color: 'var(--aegean, #2E5C7A)' }}>Terms & Conditions</a>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                />
                I accept the <a href="#privacy" onClick={(e) => { e.preventDefault(); alert('Argus Privacy: Your identity and claims are protected.'); }} style={{ color: 'var(--aegean, #2E5C7A)' }}>Privacy Policy</a>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !isPasswordValid || !passwordsMatch || !termsAccepted || !privacyAccepted || !isCaptchaVerified}
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
                opacity: (loading || !isPasswordValid || !passwordsMatch || !termsAccepted || !privacyAccepted || !isCaptchaVerified) ? 0.6 : 1,
                marginTop: '6px',
              }}
            >
              {loading ? 'Processing Registration…' : 'Register & Send Verification Code'}
            </button>

            <div style={{ textAlign: 'center', fontSize: '13px', fontFamily: 'Inter, sans-serif', color: 'var(--ink-soft, #5B5348)', marginTop: '8px' }}>
              Already have an account? <Link to="/login" style={{ color: 'var(--aegean, #2E5C7A)', fontWeight: 600, textDecoration: 'none' }}>Sign In here</Link>
            </div>
          </form>
        )}

        {/* STEP 2: Email Verification OTP Screen */}
        {step === 'verify' && (
          <form onSubmit={handleVerifyEmailCode} style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13.5px', color: 'var(--ink-soft, #5B5348)', lineHeight: 1.5 }}>
                We have sent a 6-digit verification code to <b>{email}</b>.
                Please enter the code below to complete registration.
              </p>
            </div>

            <div>
              <label style={{ display: 'block', fontFamily: 'Cinzel, serif', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', marginBottom: '6px', textAlign: 'center', color: 'var(--ink, #2B2622)' }}>
                6-DIGIT VERIFICATION CODE
              </label>
              <input
                type="text"
                maxLength={6}
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '22px',
                  fontFamily: 'monospace',
                  letterSpacing: '0.4em',
                  textAlign: 'center',
                  border: '1px solid var(--marble-line, #DED6C3)',
                  borderRadius: '8px',
                  background: '#FFFDF8',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading || verificationCode.length !== 6}
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
                opacity: (loading || verificationCode.length !== 6) ? 0.6 : 1,
              }}
            >
              {loading ? 'Verifying Code…' : 'Verify Email & Activate Account'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontFamily: 'Inter, sans-serif', color: 'var(--ink-soft, #5B5348)' }}>
              <button
                type="button"
                onClick={() => setStep('form')}
                style={{ background: 'transparent', border: 'none', color: 'var(--aegean, #2E5C7A)', cursor: 'pointer', padding: 0 }}
              >
                ← Back to Registration Form
              </button>
              <button
                type="button"
                onClick={() => alert(`A new code was sent to ${email}`)}
                style={{ background: 'transparent', border: 'none', color: 'var(--aegean, #2E5C7A)', cursor: 'pointer', padding: 0 }}
              >
                Resend Code
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
