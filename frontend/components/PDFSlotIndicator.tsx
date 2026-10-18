'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

interface PDFSlotIndicatorProps {
  used: number;
  limit: number;
  canUpload: boolean;
  questionsUsed?: number;
  questionsLimit?: number;
  // Tier context from the backend. When a guest runs out of slots, signing in
  // raises the cap, which is a better answer than "delete something".
  signedIn?: boolean;
  signedInLimit?: number | null;
}

// Shows current PDF slot consumption using fixed-size animated bars.
export default function PDFSlotIndicator({
  used,
  limit,
  canUpload,
  questionsUsed,
  questionsLimit,
  signedIn,
  signedInLimit,
}: PDFSlotIndicatorProps) {
  const router = useRouter();
  const slots = Array.from({ length: limit }, (_, index) => index < used);
  const remaining = Math.max(0, limit - used);
  const upgradeLimit = signedInLimit ?? 0;
  const canUpgrade = signedIn === false && upgradeLimit > limit;

  return (
    <div className="pdf-slot-indicator" aria-live="polite">
      <div className="pdf-slot-row">
        <span>PDF Documents</span>
        <strong>
          {used}/{limit} used
        </strong>
      </div>
      <div
        className="pdf-slot-bars"
        style={{ '--slot-count': limit } as CSSProperties}
        aria-hidden="true"
      >
        {slots.map((isUsed, index) => (
          <motion.span
            key={index}
            initial={{ scaleX: 0.75, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ delay: index * 0.08, duration: 0.2 }}
            className={isUsed ? 'pdf-slot-bar pdf-slot-bar-used' : 'pdf-slot-bar'}
          />
        ))}
      </div>
      <p className={canUpload ? 'pdf-slot-note' : 'pdf-slot-note pdf-slot-note-warning'}>
        {canUpload
          ? `${remaining} slot${remaining === 1 ? '' : 's'} remaining`
          : canUpgrade
            ? `Guest limit reached — an account raises it to ${upgradeLimit}`
            : 'Delete a PDF to upload a new one'}
      </p>
      {canUpgrade && (
        <button type="button" className="pdf-slot-upgrade" onClick={() => router.push('/login')}>
          Sign in for {upgradeLimit} slots
        </button>
      )}
      {typeof questionsUsed === 'number' && typeof questionsLimit === 'number' && (
        <p className="pdf-slot-note">
          {questionsLimit <= 0
            ? `Questions: ${questionsUsed} asked · Unlimited`
            : `Questions: ${questionsUsed}/${questionsLimit} used`}
        </p>
      )}
      <style>{`
        .pdf-slot-indicator {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 18px;
          padding: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.04);
        }
        .pdf-slot-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: rgba(255, 255, 255, 0.72);
          font-size: 13px;
          font-weight: 600;
        }
        .pdf-slot-row strong {
          color: rgba(255, 255, 255, 0.42);
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }
        .pdf-slot-bars {
          display: grid;
          grid-template-columns: repeat(var(--slot-count, 2), minmax(0, 1fr));
          gap: 8px;
        }
        .pdf-slot-bar {
          display: block;
          height: 8px;
          min-width: 0;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.1);
          transform-origin: left;
        }
        .pdf-slot-bar-used {
          background: linear-gradient(90deg, #6366f1, #ec4899);
        }
        .pdf-slot-note {
          margin: 0;
          color: rgba(255, 255, 255, 0.34);
          font-size: 12px;
          line-height: 1.4;
        }
        .pdf-slot-note-warning {
          color: #fbbf24;
        }
        .pdf-slot-upgrade {
          align-self: flex-start;
          padding: 7px 14px;
          border: 1px solid rgba(129, 140, 248, 0.3);
          border-radius: 999px;
          background: rgba(129, 140, 248, 0.12);
          color: #c7d2fe;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s ease, border-color 0.2s ease;
        }
        .pdf-slot-upgrade:hover {
          background: rgba(129, 140, 248, 0.2);
          border-color: rgba(129, 140, 248, 0.5);
        }
      `}</style>
    </div>
  );
}
