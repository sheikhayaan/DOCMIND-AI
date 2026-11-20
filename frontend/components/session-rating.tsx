'use client';

import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { finishSession, getSessionFeedback } from '@/lib/admin-api';

// Collects an explicit session review or completes without a rating; no star is preselected.
export default function SessionRating({ sessionId, onCompleted }: { sessionId: string; onCompleted: (id: string) => void }) {
  const [stars, setStars] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Not rated yet');
  const busyRef = useRef(false);
  const selectionTouched = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    getSessionFeedback(sessionId, controller.signal).then((feedback) => {
      if (controller.signal.aborted) return;
      if (!selectionTouched.current && feedback.verified && feedback.stars !== null) { setStars(feedback.stars); setMessage(`Your verified rating: ${feedback.stars} / 5`); }
    }).catch(() => { /* Reading optional feedback never blocks the conversation. */ });
    return () => controller.abort();
  }, [sessionId]);

  // Completes only this session, protecting a newer chat from a delayed review response.
  const finish = async (rating: number | null) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await finishSession(sessionId, rating); onCompleted(sessionId); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Feedback could not be saved. You can still choose Next / Skip below.'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return <section aria-label="Rate this document session" style={{ padding: 18, borderRadius: 16, border: '1px solid #788cff33', background: '#788cff0b', margin: '18px 0' }}>
    <h3 style={{ color: '#e4eafa', fontSize: 14, fontWeight: 600 }}>Finished this session? Leave an honest rating.</h3>
    <p role="status" style={{ color: '#a5b4d4', fontSize: 12, margin: '8px 0' }}>{message}</p>
    <div role="group" aria-label="Choose a star rating" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={`Rate ${value} out of 5 stars`} aria-pressed={stars === value} onClick={() => { selectionTouched.current = true; setStars(value); setMessage(`${value} / 5 selected — submit to save`); }} disabled={busy} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', border: '1px solid #c2a35b55', borderRadius: 10, color: '#efce8a', background: '#efce8a0b', cursor: 'pointer' }}><Star size={20} fill={stars !== null && value <= stars ? 'currentColor' : 'none'} /></button>)}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <button type="button" disabled={busy || stars === null} onClick={() => void finish(stars)} style={{ minHeight: 44, padding: '9px 13px', borderRadius: 10, border: '1px solid #91a6ff55', background: '#788cff22', color: '#d4ddff', opacity: busy || stars === null ? 0.5 : 1, cursor: 'pointer' }}>{busy ? 'Saving…' : 'Submit rating & finish'}</button>
      <button type="button" disabled={busy} onClick={() => void finish(null)} style={{ minHeight: 44, padding: '9px 13px', borderRadius: 10, border: '1px solid #91a6ff33', background: 'transparent', color: '#b2bfda', cursor: 'pointer' }}>Finish / Skip rating</button>
    </div>
    <p style={{ color: '#8192b5', fontSize: 11, marginTop: 10 }}>One verified review per answered session. Skipping does not create a default rating.</p>
  </section>;
}
