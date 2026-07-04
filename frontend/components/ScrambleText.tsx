'use client';
import { useEffect, useRef, useState } from 'react';

const GLYPHS = '!<>-_\\/[]{}—=+*^?#________ABCDEFGHJKLMNPQRSTUVWXYZ01';

type ScrambleTextProps = {
  phrases: string[];
  className?: string;
  // ms each fully-resolved phrase is held before scrambling to the next.
  holdMs?: number;
};

// Cycles through phrases with a "decrypt" reveal: each character flickers
// through random glyphs before settling into the target letter, left to right.
// Pure rAF, no per-frame React state churn beyond the displayed string.
export default function ScrambleText({ phrases, className, holdMs = 2200 }: ScrambleTextProps) {
  const [output, setOutput] = useState(phrases[0] ?? '');
  const frame = useRef(0);
  const rafId = useRef(0);
  const phraseIndex = useRef(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || phrases.length === 0) {
      // Initial state already shows phrases[0]; nothing to animate.
      return;
    }

    let holdTimer = 0;

    type Slot = { from: string; to: string; start: number; end: number; current: string };

    const scrambleTo = (next: string) => {
      const current = output;
      const length = Math.max(current.length, next.length);
      const slots: Slot[] = [];
      for (let i = 0; i < length; i++) {
        const from = current[i] || '';
        const to = next[i] || '';
        const start = Math.floor(Math.random() * 28);
        const end = start + 18 + Math.floor(Math.random() * 28);
        slots.push({ from, to, start, end, current: from });
      }

      frame.current = 0;

      const tick = () => {
        let done = 0;
        let out = '';
        for (const slot of slots) {
          if (frame.current >= slot.end) {
            done++;
            out += slot.to;
          } else if (frame.current >= slot.start) {
            // 28% chance to roll a new random glyph this frame -> flicker.
            if (!slot.current || Math.random() < 0.28) {
              slot.current = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
            }
            out += `<span class="scramble-ghost">${slot.current}</span>`;
          } else {
            out += slot.from;
          }
        }
        setOutput(out);
        if (done < slots.length) {
          frame.current++;
          rafId.current = requestAnimationFrame(tick);
        } else {
          setOutput(next);
          // Hold the resolved phrase, then advance to the next one.
          holdTimer = window.setTimeout(() => {
            phraseIndex.current = (phraseIndex.current + 1) % phrases.length;
            scrambleTo(phrases[phraseIndex.current]);
          }, holdMs);
        }
      };

      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(tick);
    };

    // Kick off after a short beat so the resolved first phrase is readable.
    holdTimer = window.setTimeout(() => {
      phraseIndex.current = (phraseIndex.current + 1) % phrases.length;
      scrambleTo(phrases[phraseIndex.current]);
    }, holdMs);

    return () => {
      cancelAnimationFrame(rafId.current);
      clearTimeout(holdTimer);
    };
    // Intentionally run once: the loop is self-perpetuating via timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span
      className={className}
      aria-label={phrases[0]}
      // Output contains <span> wrappers for flickering glyphs.
      dangerouslySetInnerHTML={{ __html: output }}
    />
  );
}
