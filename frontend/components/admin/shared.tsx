'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { HealingReport } from '@/lib/admin-types';
import styles from './admin.module.css';

// Displays finite measurements without converting missing data to a fake zero.
export function measurement(value: number | null | undefined, unit = '', digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : 'N/A';
}

// Formats actual resident or heap bytes using mebibytes.
export function memory(value: number | null | undefined): string {
  return typeof value === 'number' ? measurement(value / 1024 / 1024, ' MiB') : 'N/A';
}

// Formats ISO timestamps defensively for current browser locale.
export function timestamp(value: string | null | undefined): string {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

// Uses verified review counts rather than optimistic star-rating defaults.
export function rating(value: number | null, count: number): string {
  return count > 0 && value !== null ? `${measurement(value)} / 5` : 'Not rated yet';
}

// Renders one durable platform metric with a contextual explanation.
export function MetricCard({ label, value, note, icon }: { label: string; value: string | number; note: string; icon: ReactNode }) {
  return <section className={`${styles.glass} ${styles.metric}`}><div className={styles.metricLabel}>{label}{icon}</div><strong className={styles.metricValue}>{value}</strong><span className={styles.muted}>{note}</span></section>;
}

// Shows a bounded visual gauge while explicitly labeling unavailable measurements.
export function Gauge({ label, value, percent, unit, note }: { label: string; value: number | null; percent: number | null; unit: string; note: string }) {
  const amount = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const color = amount >= 90 ? '#f4869c' : amount >= 70 ? '#e6b773' : '#8ca5ff';
  return <section className={`${styles.glass} ${styles.gauge}`}>
    <div className={styles.ring} role="img" aria-label={`${label}: ${measurement(value, unit)}`} style={{ background: `conic-gradient(${color} ${amount * 3.6}deg, #6475a01c 0)` }}>
      <div className={styles.ringInside}>{measurement(value, '', value !== null && value >= 100 ? 0 : 1)}<small>{value !== null ? unit : 'unavailable'}</small></div>
    </div>
    <div><h3 className={styles.heading}>{label}</h3><p className={styles.muted}>{note}</p></div>
  </section>;
}

// Uses a native modal dialog for focus trapping, Escape, and focus restoration.
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.modal} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className={styles.sectionHead}><h2 className={styles.heading}>{title}</h2><button type="button" onClick={onClose} className={styles.button} aria-label="Close dialog"><X size={16} /></button></div>
    {children}
  </dialog>;
}

// Renders actual action results without claiming every attempted repair succeeded.
export function ExecutionReport({ report }: { report: HealingReport }) {
  return <section className={`${styles.glass} ${styles.stack}`} aria-label="Self-healing execution report">
    <div className={styles.row}><h3 className={styles.heading}>Diagnostics report</h3><span className={`${styles.badge} ${report.verifiedNominal ? styles.verified : styles.medium}`}>{report.status}</span></div>
    <p className={styles.muted}>{timestamp(report.startedAt)} · {measurement(report.durationMs, ' ms')} execution · {report.trigger} trigger</p>
    <p className={report.verifiedNominal ? styles.success : styles.notice}>{report.verifiedNominal ? 'All current infrastructure checks verified nominal.' : 'Nominal health is not verified for every service. Review the checks below.'}</p>
    <div className={styles.legend}>{Object.entries(report.checks).map(([key, value]) => <span key={key}>{key}: {value === true ? 'verified' : value === false ? 'needs attention' : 'unavailable'}</span>)}</div>
    {report.actionsExecuted.length === 0 ? <p className={styles.muted}>No applicable safe remedy was executed. Rate limits, auth anomalies, and slow SQL require investigation, not blind resets.</p> : report.actionsExecuted.map((action) => <div key={action.action} className={styles.service}>
      <div className={styles.row}><strong className={styles.incidentTitle}>{action.action.replaceAll('_', ' ')}</strong><span className={styles.badge}>{action.status}</span></div><p className={styles.muted}>{action.notes}</p><small className={styles.muted}>{measurement(action.durationMs, ' ms')} · {action.verified ? 'Postcondition verified' : 'Recovery not verified'}</small>
    </div>)}
    <p className={styles.muted}>Latency savings: {measurement(report.latencySavingsMs, ' ms')}. {report.latencySavingsBasis}.</p>
  </section>;
}
