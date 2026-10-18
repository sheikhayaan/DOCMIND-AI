'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, FileText, ArrowLeft, Shield, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';
import GoogleSignIn from '@/components/GoogleSignIn';
import { allowGuestAccess } from '@/components/AuthGate';
import { getSessionInfo, loginWithEmail, signUpWithEmail } from '@/lib/api';

type Mode = 'signin' | 'signup';

const PASSWORD_MIN_LENGTH = 8;
const GUEST_PDF_LIMIT = 2;
const ACCOUNT_PDF_LIMIT = 4;

function passwordGloss(password: string): string {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `${PASSWORD_MIN_LENGTH - password.length} characters needed`;
  }
  if (password.length >= 12 || /[^a-zA-Z0-9]/.test(password)) return 'Strong password';
  if (/[a-zA-Z]/.test(password) && /[0-9]/.test(password)) return 'Good password';
  return 'Fair password';
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [settled, setSettled] = useState(false);

  // Skip login form if already signed in
  useEffect(() => {
    if (getSessionInfo()?.email) router.replace('/');
  }, [router]);

  const finish = useCallback(() => {
    setSettled(true);
    router.replace('/');
  }, [router]);

  const isSignUp = mode === 'signup';
  const gloss = useMemo(
    () => (isSignUp && password ? passwordGloss(password) : ''),
    [isSignUp, password],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || settled) return;
    setError('');

    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError('Please enter your email and password.');
      return;
    }
    if (isSignUp && password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    setBusy(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(trimmed, password);
      } else {
        await loginWithEmail(trimmed, password);
      }
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setError('');
  };

  const continueAsGuest = () => {
    allowGuestAccess();
    router.push('/');
  };

  return (
    <main className="login-page noise">
      {/* Ambient Glows */}
      <div className="glow-orb" style={{ width: 600, height: 600, background: 'radial-gradient(circle, rgba(37,99,235,0.2) 0%, transparent 70%)', top: -150, left: -150 }} />
      <div className="glow-orb" style={{ width: 500, height: 500, background: 'radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 70%)', bottom: -100, right: -100 }} />

      {/* Navigation Bar Header */}
      <header className="login-header">
        <button onClick={() => router.push('/')} className="brand-logo">
          <div className="logo-icon">
            <FileText size={18} color="white" />
          </div>
          <span className="logo-text">DocMind <span className="blue">AI</span></span>
        </button>

        <button onClick={() => router.push('/')} className="back-btn">
          <ArrowLeft size={16} /> Back to Home
        </button>
      </header>

      {/* Main Container */}
      <div className="login-container">
        {/* Left Side: Value Proposition */}
        <motion.section 
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="login-hero"
        >
          <div className="tag-badge">
            <Sparkles size={12} color="#3b82f6" />
            <span>Document Intelligence Workspace</span>
          </div>

          <h1>
            Your Documents, <br />
            <span className="blue-gradient-text">Fully Grounded.</span>
          </h1>

          <p className="hero-sub">
            Sign in to unlock persistent multi-device document sessions, expanded storage slots, and exact source citations.
          </p>

          <div className="benefit-list">
            <div className="benefit-item">
              <CheckCircle2 size={18} color="#3b82f6" />
              <div>
                <strong>{ACCOUNT_PDF_LIMIT} Active Document Slots</strong>
                <p>Guest access provides {GUEST_PDF_LIMIT} slots. Accounts expand capacity.</p>
              </div>
            </div>

            <div className="benefit-item">
              <CheckCircle2 size={18} color="#3b82f6" />
              <div>
                <strong>Persistent Conversational Memory</strong>
                <p>Saved transcripts stay synchronized across browser restarts.</p>
              </div>
            </div>

            <div className="benefit-item">
              <CheckCircle2 size={18} color="#3b82f6" />
              <div>
                <strong>Page-Level Citations</strong>
                <p>Every answer links directly to exact page excerpts in your uploaded PDF.</p>
              </div>
            </div>
          </div>

          <div className="guest-box glass">
            <p>Just exploring? You can start right away without signing in.</p>
            <button onClick={continueAsGuest} className="outline-btn guest-btn">
              Continue as Guest ({GUEST_PDF_LIMIT} PDFs) <ArrowRight size={14} />
            </button>
          </div>
        </motion.section>

        {/* Right Side: Auth Form */}
        <motion.section 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="auth-card glass"
        >
          {/* Mode Switcher Tabs */}
          <div className="tab-group">
            <button
              type="button"
              className={`tab-btn ${!isSignUp ? 'active' : ''}`}
              onClick={() => switchMode('signin')}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`tab-btn ${isSignUp ? 'active' : ''}`}
              onClick={() => switchMode('signup')}
            >
              Create Account
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.p
              key={mode}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="tab-subtitle"
            >
              {isSignUp
                ? `Create a free account for ${ACCOUNT_PDF_LIMIT} document slots.`
                : 'Welcome back! Enter your credentials to access your documents.'}
            </motion.p>
          </AnimatePresence>

          {/* Social Sign In */}
          <div className="google-wrap">
            <GoogleSignIn />
          </div>

          <div className="divider">
            <span>or email authentication</span>
          </div>

          {/* Form */}
          <form onSubmit={submit} className="auth-form" noValidate>
            <div className="input-group">
              <label htmlFor="auth-email">Email Address</label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="input-group">
              <div className="label-row">
                <label htmlFor="auth-password">Password</label>
                {isSignUp && gloss && <span className="gloss-tag">{gloss}</span>}
              </div>
              <div className="password-wrap">
                <input
                  id="auth-password"
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                />
                <button
                  type="button"
                  onClick={() => setReveal(!reveal)}
                  className="eye-btn"
                  title={reveal ? 'Hide password' : 'Show password'}
                >
                  {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="error-banner">
                {error}
              </motion.div>
            )}

            <motion.button
              type="submit"
              disabled={busy}
              className="glow-btn submit-btn"
              whileTap={{ scale: 0.98 }}
              whileHover={{ y: -2 }}
            >
              {busy ? (
                <span className="spinner-row">
                  <span className="spin-dot" /> Authenticating...
                </span>
              ) : isSignUp ? (
                'Create Free Account →'
              ) : (
                'Sign In to Dashboard →'
              )}
            </motion.button>
          </form>

          <div className="admin-link-box">
            <span>System owner? </span>
            <button onClick={() => router.push('/admin')} className="admin-link">
              <Shield size={12} /> Admin Security Console
            </button>
          </div>
        </motion.section>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          background: var(--bg-primary);
          color: var(--text-primary);
          position: relative;
          display: flex;
          flex-direction: column;
          overflow-x: hidden;
        }

        .login-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: clamp(16px, 3vw, 24px) clamp(16px, 4vw, 32px);
          position: relative;
          z-index: 10;
          gap: 12px;
        }

        .brand-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          background: none;
          border: none;
          cursor: pointer;
        }

        .logo-icon {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 16px rgba(37,99,235,0.4);
        }

        .logo-text {
          font-weight: 800;
          font-size: 18px;
          color: #fff;
          letter-spacing: -0.02em;
        }

        .blue {
          color: #3b82f6;
        }

        .back-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 99px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.7);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .back-btn:hover {
          color: #fff;
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
          box-shadow: 0 0 15px rgba(255, 255, 255, 0.08);
        }

        .login-container {
          flex: 1;
          width: min(1140px, 100%);
          margin: 0 auto;
          padding: clamp(24px, 5vw, 40px) clamp(16px, 4vw, 24px) clamp(56px, 8vw, 80px);
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: clamp(32px, 5vw, 60px);
          align-items: center;
          position: relative;
          z-index: 1;
        }

        @media (max-width: 900px) {
          .login-container {
            grid-template-columns: minmax(0, 1fr);
            gap: 40px;
          }

          .auth-card {
            justify-self: center;
            width: 100%;
          }
        }

        /* Hero Left Column */
        .login-hero {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .tag-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 99px;
          background: rgba(37, 99, 235, 0.1);
          border: 1px solid rgba(37, 99, 235, 0.25);
          color: #60a5fa;
          font-size: 12px;
          font-weight: 600;
          width: fit-content;
        }

        h1 {
          font-size: clamp(32px, 4vw, 48px);
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -0.03em;
        }

        .hero-sub {
          font-size: 16px;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.6;
        }

        .benefit-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-top: 10px;
        }

        .benefit-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .benefit-item strong {
          display: block;
          font-size: 14px;
          color: #fff;
          margin-bottom: 2px;
        }

        .benefit-item p {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.45);
        }

        .guest-box {
          margin-top: 16px;
          padding: clamp(18px, 3vw, 22px);
          border-radius: 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }

        .guest-box p {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.55);
        }

        .guest-btn {
          padding: 11px 20px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          background: rgba(37, 99, 235, 0.08);
          border: 1px solid rgba(59, 130, 246, 0.3);
          color: #60a5fa;
          box-shadow: 0 0 15px rgba(37, 99, 235, 0.15);
          cursor: pointer;
          transition: all 0.25s ease;
        }

        .guest-btn:hover {
          background: rgba(37, 99, 235, 0.18);
          border-color: rgba(96, 165, 250, 0.6);
          color: #fff;
          box-shadow: 0 0 25px rgba(37, 99, 235, 0.35);
          transform: translateY(-1px);
        }

        /* Auth Card Right Column */
        .auth-card {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          border-radius: 28px;
          padding: clamp(26px, 4vw, 40px) clamp(22px, 4.5vw, 40px);
          display: flex;
          flex-direction: column;
          gap: 20px;
          background: linear-gradient(
            155deg,
            rgba(255, 255, 255, 0.095) 0%,
            rgba(255, 255, 255, 0.028) 42%,
            rgba(37, 99, 235, 0.07) 100%
          );
          border: 1px solid rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(24px) saturate(145%);
          -webkit-backdrop-filter: blur(24px) saturate(145%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.18),
            inset 0 -1px 0 rgba(255, 255, 255, 0.04),
            0 30px 80px rgba(0, 0, 0, 0.55),
            0 0 60px rgba(37, 99, 235, 0.12);
        }

        .auth-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(
            115deg,
            rgba(255, 255, 255, 0.04) 12%,
            rgba(96, 165, 250, 0.7) 36%,
            rgba(167, 139, 250, 0.45) 52%,
            rgba(255, 255, 255, 0.06) 74%
          );
          background-size: 260% 260%;
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          animation: auth-border-shimmer 7s ease-in-out infinite;
          opacity: 0.72;
          pointer-events: none;
          transition: opacity 0.35s ease, filter 0.35s ease;
          z-index: 2;
        }

        .auth-card::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background:
            radial-gradient(120% 60% at 10% 0%, rgba(255, 255, 255, 0.13), transparent 55%),
            radial-gradient(90% 55% at 100% 100%, rgba(37, 99, 235, 0.16), transparent 62%);
          pointer-events: none;
          z-index: -1;
        }

        .auth-card:hover::before,
        .auth-card:focus-within::before {
          opacity: 1;
          animation-duration: 3.4s;
          filter: drop-shadow(0 0 14px rgba(59, 130, 246, 0.45));
        }

        @keyframes auth-border-shimmer {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        .tab-group {
          display: flex;
          background: rgba(255, 255, 255, 0.04);
          padding: 4px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(12px);
        }

        .tab-btn {
          flex: 1;
          padding: 10px;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.5);
          font-size: 14px;
          font-weight: 600;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.25s ease;
        }

        .tab-btn:hover:not(.active) {
          color: #fff;
          background: rgba(255, 255, 255, 0.05);
        }

        .tab-btn.active {
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: #fff;
          border: 1px solid rgba(147, 197, 253, 0.4);
          box-shadow: 0 0 20px rgba(37, 99, 235, 0.5), 0 0 40px rgba(37, 99, 235, 0.2);
        }

        .tab-subtitle {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.5);
          margin-top: -8px;
        }

        .google-wrap {
          margin-top: 4px;
        }

        .divider {
          display: flex;
          align-items: center;
          text-align: center;
          color: rgba(255, 255, 255, 0.3);
          font-size: 12px;
        }

        .divider::before,
        .divider::after {
          content: '';
          flex: 1;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }

        .divider span {
          padding: 0 12px;
        }

        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .input-group label {
          font-size: 12px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.7);
        }

        .label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .gloss-tag {
          font-size: 11px;
          color: #60a5fa;
        }

        .input-group input {
          width: 100%;
          padding: 14px 16px;
          background: rgba(255, 255, 255, 0.035);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          color: #fff;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }

        .input-group input:hover {
          border-color: rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.05);
        }

        .input-group input:focus {
          border-color: rgba(37, 99, 235, 0.75);
          background: rgba(37, 99, 235, 0.06);
          box-shadow: 0 0 20px rgba(37, 99, 235, 0.3);
        }

        .password-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .eye-btn {
          position: absolute;
          right: 12px;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.4);
          cursor: pointer;
          display: flex;
          align-items: center;
          padding: 4px;
        }

        .eye-btn:hover {
          color: #fff;
        }

        .error-banner {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #f87171;
          padding: 11px 15px;
          border-radius: 14px;
          font-size: 13px;
          backdrop-filter: blur(12px);
        }

        .submit-btn {
          padding: 15px 22px;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.01em;
          margin-top: 6px;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 46%, #1d4ed8 100%);
          color: #fff;
          border: 1px solid rgba(191, 219, 254, 0.42);
          box-shadow:
            0 0 28px rgba(37, 99, 235, 0.55),
            0 10px 26px rgba(0, 0, 0, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.35);
          cursor: pointer;
          transition: box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1), background 0.25s ease;
          position: relative;
          overflow: hidden;
        }

        .submit-btn:hover {
          box-shadow:
            0 0 40px rgba(59, 130, 246, 0.75),
            0 14px 32px rgba(37, 99, 235, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.45);
          border-color: rgba(219, 234, 254, 0.65);
        }

        .submit-btn:active {
          transform: translateY(0);
        }

        .spinner-row {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .spin-dot {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .admin-link-box {
          text-align: center;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.4);
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }

        .admin-link {
          background: rgba(129, 140, 248, 0.1);
          border: 1px solid rgba(129, 140, 248, 0.25);
          color: #a5b4fc;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 11px;
          border-radius: 999px;
          margin-left: 6px;
          transition: all 0.2s ease;
        }

        .admin-link:hover {
          background: rgba(129, 140, 248, 0.2);
          color: #fff;
          border-color: rgba(165, 180, 252, 0.5);
          box-shadow: 0 0 15px rgba(129, 140, 248, 0.3);
          text-decoration: underline;
        }

        @media (max-width: 640px) {
          /* Keep the form close to the top of the fold on phones. */
          .benefit-list {
            display: none;
          }

          .login-hero {
            gap: 14px;
          }
        }
      `}</style>
    </main>
  );
}
