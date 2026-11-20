'use client';

import { useEffect, useRef, useState } from 'react';
import { spokenPreview } from '@/lib/text-safety';

declare global {
  interface Window { _activeUtterance?: SpeechSynthesisUtterance | null }
}

// Speaks only inside the direct tap handler and holds utterances against Chromium garbage collection.
export default function ReadAloudButton({ text }: { text: unknown }) {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => {
    const utterance = utteranceRef.current;
    if (utterance) { utterance.onend = null; utterance.onerror = null; }
    if (utterance && window._activeUtterance === utterance) {
      window.speechSynthesis?.cancel();
      window._activeUtterance = null;
    }
    utteranceRef.current = null;
  }, []);

  // Starts or stops a short preview synchronously from a user gesture, never from an effect.
  const listen = () => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setError('Read aloud is unavailable in this browser. The full text remains readable below.');
      return;
    }
    if (speaking && window._activeUtterance === utteranceRef.current) {
      window.speechSynthesis.cancel();
      window._activeUtterance = null;
      utteranceRef.current = null;
      setSpeaking(false);
      return;
    }
    const preview = spokenPreview(text);
    if (!preview) { setError('No readable text is available.'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(preview);
    utterance.rate = 1;
    utteranceRef.current = utterance;
    window._activeUtterance = utterance;
    // Releases only this utterance, leaving any newly started preview untouched.
    const finish = () => {
      if (utteranceRef.current === utterance) { utteranceRef.current = null; setSpeaking(false); }
      if (window._activeUtterance === utterance) window._activeUtterance = null;
    };
    utterance.onend = finish;
    utterance.onerror = (event) => { finish(); if (event.error !== 'canceled' && event.error !== 'interrupted') setError('Audio could not start. Tap Listen again or read the text.'); };
    setError('');
    setSpeaking(true);
    // No await, promise callback, or useEffect is allowed between the tap and speak().
    try { window.speechSynthesis.speak(utterance); }
    catch { finish(); setError('Audio playback failed. You can continue using the displayed text.'); }
  };

  return <div style={{ marginTop: 12 }}>
    <button type="button" onClick={listen} aria-pressed={speaking} title="Brief spoken preview, approximately 3–5 seconds" style={{ minHeight: 44, padding: '9px 13px', border: '1px solid #91a6ff55', borderRadius: 10, background: '#788cff18', color: '#cbd5ff', fontSize: 12, cursor: 'pointer' }}>{speaking ? '■ Stop reading' : '🔊 Listen / Read Aloud'}</button>
    <small style={{ display: 'block', color: '#9aa8c4', fontSize: 11, marginTop: 4 }}>Brief preview · full text remains on screen</small>
    {error && <p role="status" style={{ color: '#f4cc8e', fontSize: 12 }}>{error}</p>}
  </div>;
}
