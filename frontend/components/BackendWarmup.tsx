'use client';

import { useEffect, useState } from 'react';
import { Sparkles, CheckCircle2, RefreshCw } from 'lucide-react';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'https://ayaandevloper408-docmind-ai-backend.hf.space';

type BackendState = 'idle' | 'warming' | 'connected' | 'error';

// Periodically warms up the Hugging Face backend and displays non-intrusive status during cold boots.
export default function BackendWarmup() {
  const [state, setState] = useState<BackendState>('idle');
  const [visible, setVisible] = useState(false);

  // Performs a single health probe to wake the remote container and record responsiveness.
  const pingBackend = async (isInitial = false) => {
    const timer = isInitial
      ? setTimeout(() => {
          setState('warming');
          setVisible(true);
        }, 1800)
      : null;

    try {
      const res = await fetch(`${API_BASE.replace(/\/+$/, '')}/health`, {
        method: 'GET',
        cache: 'no-store',
      });

      if (timer) clearTimeout(timer);

      if (res.ok) {
        setState('connected');
        if (visible || isInitial) {
          setVisible(true);
          // Dismiss banner smoothly after 3.5 seconds
          const hideTimer = setTimeout(() => {
            setVisible(false);
          }, 3500);
          return () => clearTimeout(hideTimer);
        }
      } else {
        setState('error');
      }
    } catch {
      if (timer) clearTimeout(timer);
      setState('warming');
      setVisible(true);
    }
  };

  useEffect(() => {
    // Initial warmup probe
    pingBackend(true);

    // Continuous 4-minute heartbeat while user tab remains active
    const interval = setInterval(() => {
      pingBackend(false);
    }, 4 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  if (!visible && state !== 'warming') {
    return null;
  }

  return (
    <aside
      aria-label="Cloud Backend Status"
      className="backend-warmup-toast"
      role="status"
    >
      <div className="warmup-card">
        {state === 'warming' ? (
          <>
            <div className="warmup-spinner">
              <RefreshCw size={14} className="spin-icon" />
            </div>
            <div className="warmup-text">
              <strong>Waking Hugging Face Backend</strong>
              <span>Cloud container is warming up for 24/7 speed...</span>
            </div>
          </>
        ) : state === 'connected' ? (
          <>
            <div className="warmup-icon success">
              <CheckCircle2 size={14} />
            </div>
            <div className="warmup-text">
              <strong>DocMind AI Online</strong>
              <span>Hugging Face Space backend is awake and ready.</span>
            </div>
          </>
        ) : (
          <>
            <div className="warmup-icon">
              <Sparkles size={14} />
            </div>
            <div className="warmup-text">
              <strong>Connecting Engine</strong>
              <span>Checking cloud service status...</span>
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .backend-warmup-toast {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
          max-width: 380px;
          animation: slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .warmup-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          background: rgba(10, 16, 30, 0.92);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(59, 130, 246, 0.28);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(37, 99, 235, 0.15);
          border-radius: 12px;
          color: #f1f5f9;
        }

        .warmup-spinner {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
          flex-shrink: 0;
        }

        :global(.spin-icon) {
          animation: spin 1.2s linear infinite;
        }

        .warmup-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: rgba(148, 163, 184, 0.15);
          color: #94a3b8;
          flex-shrink: 0;
        }

        .warmup-icon.success {
          background: rgba(34, 197, 94, 0.15);
          color: #4ade80;
        }

        .warmup-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 12px;
          line-height: 1.35;
        }

        .warmup-text strong {
          font-weight: 600;
          color: #fff;
          font-size: 12.5px;
        }

        .warmup-text span {
          color: rgba(255, 255, 255, 0.6);
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 640px) {
          .backend-warmup-toast {
            left: 16px;
            right: 16px;
            bottom: 16px;
            max-width: none;
          }
        }
      `}</style>
    </aside>
  );
}
