'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import {
  Copy,
  Check,
  ExternalLink,
  X,
  Sparkles,
  Shield,
  ArrowRight,
} from 'lucide-react';
import {
  getSessionInfo,
  loginWithEmail,
  loginWithGoogle,
  signUpWithEmail,
  signOut,
  type SessionInfo,
} from '@/lib/api';

// Inlined at build time with stable fallback for Google Identity Services.
const CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  '78953766328-981d3m2bisao1o1tiar2oblv0igl4ng5.apps.googleusercontent.com';

interface CredentialResponse {
  credential?: string;
}

interface PromptNotification {
  isNotDisplayed(): boolean;
  isSkippedMoment(): boolean;
  isDismissedMoment(): boolean;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  prompt(momentListener?: (notification: PromptNotification) => void): void;
  cancel(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

interface GoogleSignInProps {
  // Called after sign-in or sign-out so the page can reload user-scoped data.
  onChange?: () => void;
}

// Google's official four-color logo mark.
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

// Unbreakable Google Sign-In supporting live Google Identity Services, immediate fallback rendering, and demo mode.
export default function GoogleSignIn({ onChange }: GoogleSignInProps) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(() => getSessionInfo());
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Copies configuration text to the user clipboard and gives brief visual feedback.
  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Exchanges Google Identity credential token with backend session token.
  const handleCredential = useCallback(
    async (response: CredentialResponse) => {
      if (!response.credential) return;
      setBusy(true);
      setError('');
      try {
        await loginWithGoogle(response.credential);
        setSession(getSessionInfo());
        onChange?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Google sign-in failed');
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  // Mounts the official Google Identity Services button once the script is loaded.
  useEffect(() => {
    if (!CLIENT_ID || !scriptReady || session?.email) return;
    const googleId = window.google?.accounts?.id;
    const target = buttonRef.current;
    if (!googleId || !target) return;

    try {
      googleId.initialize({ client_id: CLIENT_ID, callback: handleCredential });
      target.innerHTML = '';
      googleId.renderButton(target, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        shape: 'rectangular',
        text: 'signin_with',
        logo_alignment: 'left',
        width: 320,
      });
    } catch {
      // If renderButton fails (e.g. invalid origin), fallback button remains visible
    }
  }, [scriptReady, session?.email, handleCredential]);

  // Invokes Google One Tap prompt or opens fallback setup/demo modal if blocked.
  const handleNativeClick = () => {
    if (busy) return;
    const googleId = window.google?.accounts?.id;
    if (googleId && CLIENT_ID) {
      try {
        googleId.prompt((notification) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            setShowModal(true);
          }
        });
      } catch {
        setShowModal(true);
      }
    } else {
      setShowModal(true);
    }
  };

  // Signs out the user and clears authentication state.
  const handleSignOut = () => {
    window.google?.accounts?.id?.cancel();
    signOut();
    setSession(getSessionInfo());
    onChange?.();
  };

  // Signs in as a verified demo user so LinkedIn visitors can test full authenticated features immediately.
  const handleDemoSignIn = async () => {
    setBusy(true);
    setError('');
    try {
      try {
        await loginWithEmail('demo.user@docmind.ai', 'DocMindDemo2026!');
      } catch {
        // If not registered yet, auto-create the demo user account
        await signUpWithEmail('demo.user@docmind.ai', 'DocMindDemo2026!');
      }
      setSession(getSessionInfo());
      setShowModal(false);
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign into demo account');
    } finally {
      setBusy(false);
    }
  };

  const signedInEmail = session?.email;

  return (
    <div className="google-signin-container">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />

      {signedInEmail ? (
        <div className="google-user-pill">
          <div className="user-info">
            <GoogleGlyph />
            <span>
              Signed in as <strong>{signedInEmail}</strong>
            </span>
          </div>
          <button
            type="button"
            className="signout-button"
            onClick={handleSignOut}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="google-button-stack">
          {/* Always rendered, immediately visible native button */}
          <button
            type="button"
            className="google-action-button"
            onClick={handleNativeClick}
            disabled={busy}
          >
            <GoogleGlyph />
            <span>Continue with Google</span>
          </button>

          {/* Official Google Identity Services element layered over target when mounted */}
          <div ref={buttonRef} className="google-gis-slot" />
        </div>
      )}

      {error && <p className="google-error-text">{error}</p>}

      {/* Google OAuth Configuration & Quick Demo Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div className="modal-title-row">
                <GoogleGlyph />
                <h3>Google OAuth 2.0 Integration</h3>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setShowModal(false)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <p className="modal-desc">
              DocMind AI features built-in Google OAuth with cryptographic JWT sessions,
              cross-device document sync, and 4 PDF document slots.
            </p>

            <div className="demo-callout">
              <div className="demo-header">
                <Sparkles size={16} className="text-amber-400" />
                <strong>LinkedIn &amp; Evaluator Demo Mode</strong>
              </div>
              <p>
                Want to test authenticated features right now without entering credentials?
              </p>
              <button
                type="button"
                className="demo-btn"
                onClick={handleDemoSignIn}
                disabled={busy}
              >
                {busy ? 'Authenticating...' : 'Sign In as Demo User (demo.user@docmind.ai)'}
                <ArrowRight size={14} />
              </button>
            </div>

            <div className="setup-section">
              <div className="setup-title">
                <Shield size={14} />
                <span>How to enable your own Google Client ID:</span>
              </div>
              <ol className="setup-steps">
                <li>
                  Open{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="link-highlight"
                  >
                    Google Cloud Console Credentials <ExternalLink size={12} />
                  </a>{' '}
                  and create an <em>OAuth 2.0 Client ID (Web application)</em>.
                </li>
                <li>
                  Add to <strong>Authorized JavaScript origins</strong>:
                  <div className="copy-row">
                    <code>https://docmind-ai-dusky.vercel.app</code>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() =>
                        copyText('origin1', 'https://docmind-ai-dusky.vercel.app')
                      }
                    >
                      {copiedKey === 'origin1' ? <Check size={13} /> : <Copy size={13} />}
                      {copiedKey === 'origin1' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="copy-row">
                    <code>http://localhost:3000</code>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => copyText('origin2', 'http://localhost:3000')}
                    >
                      {copiedKey === 'origin2' ? <Check size={13} /> : <Copy size={13} />}
                      {copiedKey === 'origin2' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </li>
                <li>
                  Add the Client ID to your environment variables:
                  <div className="copy-row">
                    <code>Vercel → NEXT_PUBLIC_GOOGLE_CLIENT_ID</code>
                  </div>
                  <div className="copy-row">
                    <code>Hugging Face → GOOGLE_CLIENT_ID</code>
                  </div>
                </li>
              </ol>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="close-footer-btn"
                onClick={() => setShowModal(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .google-signin-container {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .google-button-stack {
          position: relative;
          width: 100%;
          display: flex;
          justify-content: center;
          min-height: 44px;
        }

        .google-action-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
          padding: 12px 18px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .google-action-button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.09);
          border-color: rgba(255, 255, 255, 0.28);
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        }

        .google-action-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .google-gis-slot {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        }

        .google-gis-slot:empty {
          display: none;
        }

        .google-user-pill {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 14px;
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 8px;
          background: rgba(59, 130, 246, 0.06);
          color: rgba(255, 255, 255, 0.9);
          font-size: 13px;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 10px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .user-info strong {
          color: #60a5fa;
        }

        .signout-button {
          padding: 5px 12px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          background: transparent;
          color: rgba(255, 255, 255, 0.7);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .signout-button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .google-error-text {
          margin: 0;
          text-align: center;
          color: #f87171;
          font-size: 12px;
        }

        /* Modal Styles */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 99999;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .modal-content {
          background: #0b1120;
          border: 1px solid rgba(59, 130, 246, 0.25);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 0 0 30px rgba(37, 99, 235, 0.15);
          border-radius: 16px;
          width: 100%;
          max-width: 500px;
          padding: 24px;
          color: #f1f5f9;
          animation: popIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .modal-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .modal-title-row h3 {
          margin: 0;
          font-size: 17px;
          font-weight: 700;
          color: #fff;
        }

        .close-button {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.5);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          transition: color 0.2s;
        }

        .close-button:hover {
          color: #fff;
        }

        .modal-desc {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.65);
          line-height: 1.5;
          margin: 0 0 16px 0;
        }

        .demo-callout {
          background: linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(124, 58, 237, 0.1));
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 16px;
        }

        .demo-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #93c5fd;
          margin-bottom: 6px;
        }

        .demo-callout p {
          margin: 0 0 10px 0;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
        }

        .demo-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 9px 16px;
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }

        .demo-btn:hover:not(:disabled) {
          background: #1d4ed8;
        }

        .demo-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .setup-section {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 10px;
          padding: 14px;
          margin-bottom: 16px;
        }

        .setup-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.85);
          margin-bottom: 10px;
        }

        .setup-steps {
          margin: 0;
          padding-left: 18px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.65);
          line-height: 1.6;
        }

        .setup-steps li {
          margin-bottom: 8px;
        }

        .link-highlight {
          color: #60a5fa;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          text-decoration: underline;
        }

        .copy-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          padding: 5px 10px;
          margin-top: 4px;
        }

        .copy-row code {
          font-size: 11px;
          color: #93c5fd;
          word-break: break-all;
        }

        .copy-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 4px;
          color: #fff;
          font-size: 11px;
          padding: 3px 8px;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s;
        }

        .copy-btn:hover {
          background: rgba(255, 255, 255, 0.16);
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
        }

        .close-footer-btn {
          padding: 8px 18px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          color: #fff;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .close-footer-btn:hover {
          background: rgba(255, 255, 255, 0.15);
        }

        @keyframes popIn {
          from {
            opacity: 0;
            transform: scale(0.96);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
