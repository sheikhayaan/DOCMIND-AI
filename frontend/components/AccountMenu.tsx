'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LogOut } from 'lucide-react';
import { clearGuestAccess } from '@/components/AuthGate';
import {
  getSessionInfo,
  signOut,
  SESSION_CHANGED_EVENT,
  type SessionInfo,
} from '@/lib/api';

// Top-right account control. Shows a Sign in link for anonymous visitors and an
// avatar with a dropdown once a verified email is attached to the session.
export default function AccountMenu() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Read identity on mount, after an in-tab sign in/out, and when another tab
  // changes the stored token.
  useEffect(() => {
    const sync = () => setSession(getSessionInfo());
    sync();
    window.addEventListener(SESSION_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  // Close the dropdown on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const email = session?.email ?? null;

  const handleSignOut = () => {
    signOut();
    clearGuestAccess();
    setSession(null);
    setOpen(false);
    router.push('/login');
  };

  if (!email) {
    return (
      <button type="button" className="account-signin" onClick={() => router.push('/login')}>
        Sign in
        <ArrowRight size={14} className="account-signin-arrow" />
        <style jsx>{`
          /* A real call to action rather than a muted ghost pill: signing in is
             what raises the document limit, so it should look worth clicking and
             should match the action button on /login exactly. */
          .account-signin {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            padding: 9px 16px;
            border: none;
            border-radius: 7px;
            background: #6d5de8;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            white-space: nowrap;
            cursor: pointer;
            transition: background 0.2s ease;
          }
          .account-signin:hover {
            background: #7b6cf0;
          }
          .account-signin :global(.account-signin-arrow) {
            transition: transform 0.22s ease;
          }
          .account-signin:hover :global(.account-signin-arrow) {
            transform: translateX(3px);
          }
        `}</style>
      </button>
    );
  }

  return (
    <div className="account-wrap" ref={wrapRef}>
      <button
        type="button"
        className="account-avatar"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={email}
      >
        {email.charAt(0).toUpperCase()}
      </button>

      {open && (
        <div className="account-pop" role="menu">
          <div className="account-pop-head">
            <span className="account-pop-label">Signed in as</span>
            <strong>{email}</strong>
            {session?.role === 'admin' && <span className="account-pop-role">Admin</span>}
          </div>
          <button type="button" className="account-pop-item" onClick={handleSignOut} role="menuitem">
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}

      <style jsx>{`
        .account-wrap {
          position: relative;
          flex-shrink: 0;
        }
        .account-avatar {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: linear-gradient(135deg, #6366f1, #a855f7);
          color: #fff;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .account-avatar:hover {
          transform: scale(1.05);
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.16);
        }
        .account-pop {
          position: absolute;
          top: calc(100% + 10px);
          right: 0;
          min-width: 216px;
          padding: 6px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(14, 14, 20, 0.97);
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(12px);
          z-index: 60;
        }
        .account-pop-head {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 10px 11px 11px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          margin-bottom: 5px;
        }
        .account-pop-label {
          color: rgba(255, 255, 255, 0.38);
          font-size: 11px;
        }
        .account-pop-head strong {
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          word-break: break-all;
        }
        .account-pop-role {
          align-self: flex-start;
          margin-top: 3px;
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(129, 140, 248, 0.16);
          color: #a5b4fc;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .account-pop-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 9px 11px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: rgba(255, 255, 255, 0.72);
          font-size: 13px;
          font-weight: 500;
          text-align: left;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .account-pop-item:hover {
          background: rgba(255, 255, 255, 0.07);
          color: #fff;
        }
      `}</style>
    </div>
  );
}
