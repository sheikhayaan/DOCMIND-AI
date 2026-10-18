'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { getSessionInfo, loginWithGoogle, signOut, type SessionInfo } from '@/lib/api';

// Inlined at build time. Blank/undefined keeps the button hidden and the
// anonymous session flow completely untouched.
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

interface CredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
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

// Google's four-colour mark, inlined so the disabled placeholder looks like the
// real control without loading the Identity Services script.
function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
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

// Optional "Sign in with Google" control. Additive to anonymous sessions:
// signing in swaps the stored token for one tied to the verified email so
// documents persist across devices; signing out returns to anonymous use.
export default function GoogleSignIn({ onChange }: GoogleSignInProps) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(() => getSessionInfo());
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');


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

  // Initialize Google Identity Services and render its official button once the
  // script has loaded and the user is not already signed in with an email.
  useEffect(() => {
    if (!CLIENT_ID || !scriptReady || session?.email) return;
    const googleId = window.google?.accounts?.id;
    const target = buttonRef.current;
    if (!googleId || !target) return;
    googleId.initialize({ client_id: CLIENT_ID, callback: handleCredential });
    target.innerHTML = '';
    googleId.renderButton(target, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      // Squared corners so Google's own button matches the radius used by the
      // rest of the auth form rather than standing out as a pill.
      shape: 'rectangular',
      text: 'signin_with',
      logo_alignment: 'left',
    });
  }, [scriptReady, session?.email, handleCredential]);

  const handleSignOut = () => {
    window.google?.accounts?.id?.cancel();
    signOut();
    setSession(getSessionInfo());
    onChange?.();
  };

  // Not configured. In production render nothing so anonymous usage is
  // unaffected by a feature that cannot work. In development show a disabled
  // button instead: a silently absent control is indistinguishable from a broken
  // one, which is exactly how this went unnoticed. The setup steps stay folded
  // away so they do not dominate the sign-in card.
  if (!CLIENT_ID) {
    if (process.env.NODE_ENV === 'production') return null;
    return (
      <div className="gs-placeholder">
        <button type="button" className="gs-fake" disabled>
          <GoogleGlyph />
          Continue with Google
        </button>
        <details className="gs-setup">
          <summary>Not configured yet — how to enable</summary>
          <p>
            Create an <em>OAuth 2.0 Client ID</em> of type <em>Web application</em> in the Google
            Cloud Console, add <code>http://localhost:3000</code> as an authorized JavaScript
            origin, then paste the same ID into both files and restart the servers:
          </p>
          <ul>
            <li>
              <code>frontend/.env.local</code> → <code>NEXT_PUBLIC_GOOGLE_CLIENT_ID</code>
            </li>
            <li>
              <code>backend/.env</code> → <code>GOOGLE_CLIENT_ID</code>
            </li>
          </ul>
          <p className="gs-setup-note">This notice only appears in development.</p>
        </details>

        <style jsx>{`
          .gs-placeholder {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 14px;
          }
          .gs-fake {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            width: 100%;
            padding: 12px 18px;
            border: 1px solid rgba(198, 167, 94, 0.22);
            border-radius: 3px;
            background: transparent;
            color: rgba(243, 238, 226, 0.4);
            font-size: 13px;
            font-weight: 600;
            cursor: not-allowed;
          }
          .gs-fake :global(svg) {
            opacity: 0.45;
          }
          .gs-setup {
            color: rgba(255, 255, 255, 0.42);
            font-size: 12px;
            line-height: 1.55;
          }
          .gs-setup summary {
            color: rgba(255, 255, 255, 0.34);
            font-size: 11.5px;
            text-align: center;
            cursor: pointer;
            list-style: none;
          }
          .gs-setup summary::-webkit-details-marker {
            display: none;
          }
          .gs-setup summary:hover {
            color: rgba(255, 255, 255, 0.62);
          }
          .gs-setup[open] summary {
            margin-bottom: 9px;
          }
          .gs-setup p,
          .gs-setup ul {
            margin: 0 0 7px;
          }
          .gs-setup ul {
            padding-left: 17px;
          }
          .gs-setup code {
            padding: 1px 5px;
            border-radius: 3px;
            background: rgba(198, 167, 94, 0.12);
            color: #ecd9a4;
            font-size: 11px;
          }
          .gs-setup-note {
            color: rgba(255, 255, 255, 0.26);
          }
        `}</style>
      </div>
    );
  }

  const signedInEmail = session?.email;

  return (
    <div className="google-signin" aria-live="polite">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      {signedInEmail ? (
        <div className="google-signin-user">
          <span>
            Signed in as <strong>{signedInEmail}</strong>
          </span>
          <button type="button" onClick={handleSignOut} disabled={busy}>
            Sign out
          </button>
        </div>
      ) : (
        <div className="google-signin-cta">
          <div ref={buttonRef} className="google-signin-button" />
        </div>
      )}
      {error && <p className="google-signin-error">{error}</p>}

      <style jsx>{`
        .google-signin {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 14px;
        }
        .google-signin-cta {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .google-signin-button {
          min-height: 40px;
          display: flex;
          justify-content: center;
        }
        .google-signin-user {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 14px;
          border: 1px solid rgba(198, 167, 94, 0.2);
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.02);
          color: rgba(243, 238, 226, 0.72);
          font-size: 13px;
        }
        .google-signin-user strong {
          color: #fff;
          font-weight: 600;
        }
        .google-signin-user button {
          flex-shrink: 0;
          padding: 6px 14px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: transparent;
          color: rgba(255, 255, 255, 0.8);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease;
        }
        .google-signin-user button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
        }
        .google-signin-user button:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .google-signin-error {
          margin: 0;
          text-align: center;
          color: #f87171;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
