'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Copy, FileCode2, GitBranch, RefreshCw } from 'lucide-react';
import type { Overview, Telemetry } from '@/lib/admin-types';
import { advanceStep, splitPrompt } from '@/lib/text-safety';
import ReadAloudButton from '@/components/read-aloud-button';
import { measurement } from './shared';
import styles from './admin.module.css';

const QUESTIONS = [
  'How does your gateway recover when an upstream model times out?\nRubric: Explain per-model circuit state, cooldowns, a single half-open probe, verified fallbacks, and grounded local extracts.',
  'Why preserve active jobs during memory recovery?\nRubric: Distinguish unreachable objects and finished task handles from durable queued jobs, active requests, source documents, and authorization state.',
  'How do you prove telemetry and user ratings are real?\nRubric: Discuss bounded sliding windows, explicit sampling limits, real database counters, server-verified session ownership, and nullable unrated users.',
  'How do you prevent auth leakage and mobile dead ends?\nRubric: Describe backend authorization, explicit fetch credentials, cancellation-safe polling, gesture-initiated speech, and always-available Next / Skip controls.',
];

// Generates truthful engineering bullets from implemented features and optional measured evidence.
function buildBullets(overview: Overview, telemetry: Telemetry): string {
  const recovery = overview.measuredMttrMs !== null && overview.autoMitigatedCount > 0
    ? `Measured ${measurement(overview.measuredMttrMs, ' ms')} mean detection-to-resolution time across ${overview.autoMitigatedCount} retained verified mitigations; separated MTTR from action execution latency.`
    : 'Designed for a sub-120 ms recovery-action target where feasible; instrumented end-to-end MTTR separately and avoided unverified performance claims.';
  return [
    'Built a FastAPI + Next.js operations command center with role-based authorization, real session analytics, and server-verified one-per-session reviews.',
    `Implemented a dependency-free, 15-minute APM window with P50/P95/P99 latency, HTTP status counters, native CPU/RSS, and instrumented SQLite WAL connection pools (${telemetry.latencyMs.sampleCount} request samples in the current worker snapshot).`,
    'Engineered timeout-bounded LLM gateway routing, per-model circuit breakers, half-open recovery probes, and grounded document-extract fallback without bypassing authentication or throttling.',
    'Automated allowlisted recovery with concurrency guards, per-action cooldowns, postcondition verification, and durable critical-incident and self-healing audit trails.',
    recovery,
  ].map((bullet) => `• ${bullet}`).join('\n\n');
}

// Provides an always-skippable rehearsal without presenting practice notes as exam scores.
function InterviewPractice() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState(0);
  const prompt = splitPrompt(QUESTIONS[step]);
  // Advances from either button independently of microphone availability or answer length.
  const next = () => { setStep((current) => advanceStep(current, QUESTIONS.length)); setDraft(''); };
  // Counts only explicitly submitted practice notes and never fabricates a diagnostic grade.
  const submit = () => { if (!(draft || '').trim()) return; setSubmitted((value) => value + 1); next(); };
  return <section className={`${styles.glass} ${styles.stack}`}>
    <div className={styles.row}><h2 className={styles.heading}>Engineering interview rehearsal</h2><span className={styles.badge}>{Math.min(step + 1, QUESTIONS.length)} / {QUESTIONS.length}</span></div>
    <p className={styles.muted}>Practice only. Notes are local and temporary; this is not a diagnostic test or a scored interview.</p>
    {step >= QUESTIONS.length ? <><p className={styles.success}>Rehearsal complete. {submitted} responses submitted; the remaining questions were skipped.</p><button type="button" className={styles.button} onClick={() => { setStep(0); setSubmitted(0); setDraft(''); }}><RefreshCw size={14} /> Practice again</button></> : <>
      <h3 className={styles.heading}>{prompt.core}</h3>
      <ReadAloudButton key={step} text={prompt.core} />
      <details className={styles.audit}><summary>Engineering talking points / rubric</summary><p className={styles.muted}>{prompt.rubric}</p></details>
      <label className={styles.label}>Your response<textarea className={styles.textarea} maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Explain your tradeoffs, failure modes, and verification strategy…" /></label>
      <div className={styles.row}><button type="button" className={styles.primary} onClick={submit} disabled={!(draft || '').trim()}>Submit response</button><button type="button" className={styles.button} onClick={next}>Next / Skip <ArrowRight size={15} /></button></div>
    </>}
  </section>;
}

// Documents the actual architecture and produces evidence-based resume and interview material.
export default function PortfolioPanel({ overview, telemetry }: { overview: Overview; telemetry: Telemetry }) {
  const [bullets, setBullets] = useState(() => buildBullets(overview, telemetry));
  const [feedback, setFeedback] = useState('');
  // Copies the generated bullets only after a user gesture and surfaces clipboard failures.
  const copy = async () => { try { await navigator.clipboard.writeText(bullets || ''); setFeedback('Copied to clipboard.'); } catch { setFeedback('Clipboard unavailable. Select and copy the text manually.'); } };
  return <div className={styles.stack}>
    <div className={styles.columns}>
      <section className={`${styles.glass} ${styles.stack}`}>
        <h2 className={styles.heading}><GitBranch size={17} /> Production architecture</h2>
        <pre className={styles.code}>{'Next.js client + authenticated Node runtime sensor\n  ↓ Bearer token + credentials: include\nFastAPI protect → stored role + suspension check\n  ├─ Request telemetry → bounded 15-minute window\n  ├─ Real chat sessions → verified review aggregates\n  ├─ SQLite WAL → bounded pools + measured queries\n  └─ RAG retrieval → LLM circuit gateway\n       ├─ Primary model\n       ├─ Verified fallback model\n       └─ Grounded local extracts (document-dependent)\n\nIncidents → thresholds → cooldown → safe repair\n  → readiness checks → resolution + durable audit'}</pre>
        <p className={styles.muted}>Live APM and circuits are worker-local, not a distributed control plane. Shared durable usage and audit tables survive restarts. Serverless Node instances may rotate independently.</p>
        <Link href="/admin/security" className={styles.button}><FileCode2 size={15} /> Open preserved security, visitor, and Web Vitals console</Link>
      </section>
      <section className={`${styles.glass} ${styles.stack}`}>
        <h2 className={styles.heading}>Operational tradeoffs worth explaining</h2>
        <ul className={styles.bullets}>
          <li>Why latency percentiles use a sliding window while lifetime request counters do not expire.</li>
          <li>How retention caps are surfaced when sample volume exceeds the buffer, rather than hidden behind attractive charts.</li>
          <li>Why a failed readiness probe must leave an incident unresolved—even after an action ran.</li>
          <li>Why abuse rate limits and account suspensions are never reset as a generic “fix.”</li>
          <li>Why local document-bank availability does not prove recovery for every downstream request.</li>
        </ul>
        <div className={styles.notice}><strong>Sub-120 ms is a target, not a promise.</strong><p>Current measured MTTR: {measurement(overview.measuredMttrMs, ' ms')} across {overview.autoMitigatedCount} retained verified mitigations. Polling, network probes, GC, and graceful draining all contribute real elapsed time.</p></div>
      </section>
    </div>
    <section className={`${styles.glass} ${styles.stack}`}>
      <div className={styles.row}><h2 className={styles.heading}>Production resume bullet generator</h2><button type="button" className={styles.button} onClick={() => { setBullets(buildBullets(overview, telemetry)); setFeedback('Regenerated from current evidence.'); }}><RefreshCw size={14} /> Generate from live evidence</button></div>
      <label className={styles.label}>Editable engineering summary<textarea className={styles.textarea} rows={12} value={bullets} onChange={(event) => setBullets(event.target.value)} /></label>
      <div className={styles.row}><p className={styles.muted} role="status">{feedback || 'Only measured performance evidence is included. Add deployment scale only after verifying it.'}</p><button type="button" className={styles.primary} onClick={copy}><Copy size={15} /> Copy bullets</button></div>
    </section>
    <InterviewPractice />
  </div>;
}
