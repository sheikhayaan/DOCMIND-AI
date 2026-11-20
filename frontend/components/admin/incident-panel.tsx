'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Zap } from 'lucide-react';
import { getAdminIncidents, resolveAdminIncident } from '@/lib/admin-api';
import type { Incident, IncidentPage } from '@/lib/admin-types';
import { measurement, Modal, timestamp } from './shared';
import styles from './admin.module.css';

const REMEDIABLE = new Set(['DB_POOL_EXHAUSTION', 'TRANSIENT_CACHE_CORRUPTION', 'MEMORY_PRESSURE', 'LLM_TIMEOUT', 'LLM_UPSTREAM_FAILURE', 'LLM_RATE_LIMIT']);
interface Props { revision: number; healing: boolean; onHeal: (id?: string) => void; onError: (error: unknown) => void; onChanged: () => void }

// Requires a real resolution note and labels human intervention separately from autonomous healing.
function ResolutionDialog({ incident, onClose, onError, onChanged }: { incident: Incident; onClose: () => void; onError: Props['onError']; onChanged: () => void }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Writes an auditable human resolution without executing arbitrary remediation commands.
  const resolve = async () => {
    if (busy || (notes || '').trim().length < 3) return;
    setBusy(true);
    try { await resolveAdminIncident(incident.id, notes.trim()); onChanged(); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Resolution failed.'); onError(failure); }
    finally { setBusy(false); }
  };
  return <Modal title="Resolve incident manually" onClose={onClose}><div className={styles.stack}>
    <p className={styles.muted}>{incident.category} · {incident.endpoint}</p>
    <label className={styles.label}>What did you verify or repair?<textarea className={styles.textarea} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Describe the remedy and how recovery was checked." /></label>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button type="button" className={styles.primary} disabled={busy || (notes || '').trim().length < 3} onClick={resolve}><ClipboardCheck size={16} />{busy ? 'Recording…' : 'Confirm manual resolution'}</button>
  </div></Modal>;
}

// Displays a live filtered incident feed and the actual durable self-healing audit trail.
export default function IncidentPanel({ revision, healing, onHeal, onError, onChanged }: Props) {
  const [severity, setSeverity] = useState('');
  const [mitigated, setMitigated] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<IncidentPage | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Incident | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    // Schedules the next poll after completion so slow servers cannot accumulate overlapping fetches.
    const poll = async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (severity) params.set('severity', severity);
      if (mitigated) params.set('autoMitigated', mitigated);
      if (state) params.set('unresolved', state);
      if (document.visibilityState !== 'hidden') {
        try { const result = await getAdminIncidents(params, controller.signal); if (!controller.signal.aborted) { setData(result); setError(''); } }
        catch (failure) { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Incident refresh failed.'); onError(failure); } }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [page, severity, mitigated, state, revision, onError]);

  return <div className={styles.stack}>
    <section className={styles.glass}>
      <div className={styles.sectionHead}><div><h2 className={styles.heading}>Incidents & autonomous remediation</h2><p className={styles.muted}>Latest 200 incidents per worker. Critical incidents and repair reports are persisted with bounded retention.</p></div><span className={styles.badge}>{data ? `${data.total} matching` : 'Loading…'}</span></div>
      <div className={styles.filters}>
        <label className={styles.label}>Severity<select className={styles.select} value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1); }}><option value="">All severities</option>{['critical', 'high', 'medium', 'low'].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <label className={styles.label}>Mitigation<select className={styles.select} value={mitigated} onChange={(event) => { setMitigated(event.target.value); setPage(1); }}><option value="">All mitigation states</option><option value="true">Auto-mitigated</option><option value="false">Not auto-mitigated</option></select></label>
        <label className={styles.label}>Resolution<select className={styles.select} value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}><option value="">All incidents</option><option value="true">Unresolved</option><option value="false">Resolved</option></select></label>
      </div>
      {error && <p className={styles.error} role="alert">Refresh failed; displayed incidents may be stale. {error}</p>}
      {data && (!data.persistenceHealthy || data.droppedCriticalWrites > 0) && <p className={styles.error}>Critical audit persistence needs attention: {data.pendingCriticalWrites} writes pending, {data.droppedCriticalWrites} overflowed. Memory retention alone is not durable.</p>}
      <div className={styles.stack}>{data?.incidents.map((incident) => <article className={`${styles.glass} ${styles.incident}`} data-severity={incident.severity} key={incident.id}>
        <div className={styles.row}><strong className={styles.incidentTitle}>{incident.category}</strong><span className={`${styles.badge} ${styles[incident.severity]}`}>{incident.severity}</span></div>
        <p className={styles.muted}>{timestamp(incident.timestamp)} · {incident.endpoint} {incident.statusCode !== null ? `· HTTP ${incident.statusCode}` : ''} · {incident.occurrences} occurrence{incident.occurrences === 1 ? '' : 's'}</p>
        <p className={styles.subtitle}>{incident.errorDetails}</p>
        <div className={styles.row}><span className={incident.autoMitigated ? styles.status : styles.muted}>{incident.autoMitigated ? <><CheckCircle2 size={14} /> Auto-Mitigated by Autonomous Self-Healing</> : incident.resolvedAt ? 'Manually resolved' : 'Requires intervention or verified self-healing'}</span></div>
        {incident.mitigationNotes && <p className={styles.success}>{incident.mitigationNotes}</p>}
        {incident.resolvedAt ? <p className={styles.muted}>Resolved {timestamp(incident.resolvedAt)}</p> : <div className={styles.row}>
          <button type="button" className={styles.primary} onClick={() => onHeal(incident.id)} disabled={healing || !REMEDIABLE.has(incident.category)} title={!REMEDIABLE.has(incident.category) ? 'No safe automatic remedy exists for this category. Investigate before resolving.' : undefined}><Zap size={14} /> Apply Self-Healing Remedy</button>
          <button type="button" className={styles.button} onClick={() => setSelected(incident)}><ClipboardCheck size={14} /> Resolve manually</button>
        </div>}
      </article>)}</div>
      {data?.incidents.length === 0 && <p className={styles.empty}>No incidents match these filters.</p>}
      {!data && !error && <p className={styles.empty}>Loading incident log…</p>}
      <div className={styles.pagination}><span>Page {page} of {Math.max(1, Math.ceil((data?.total ?? 0) / 20))}</span><div><button type="button" className={styles.button} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14} /> Previous</button><button type="button" className={styles.button} disabled={!data || page * 20 >= data.total} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={14} /></button></div></div>
    </section>
    <section className={styles.glass}>
      <div className={styles.sectionHead}><h2 className={styles.heading}>Self-healing audit trail</h2><span className={styles.muted}>Execution latency ≠ detection-to-resolution MTTR</span></div>
      {data?.auditTrail.length === 0 && <p className={styles.empty}>No diagnostics runs have been recorded. Nothing is pre-populated.</p>}
      {data?.auditTrail.map((run) => <details className={styles.audit} key={run.id}><summary>{timestamp(run.startedAt)} · {run.trigger} · {run.status} · {measurement(run.durationMs, ' ms')} · {run.verifiedNominal ? 'Nominal verified' : 'Nominal not fully verified'}</summary><ul>{run.actionsExecuted.map((action) => <li key={action.action}>{action.action}: {action.status} ({measurement(action.durationMs, ' ms')}). {action.notes}</li>)}</ul><p className={styles.muted}>Savings: {measurement(run.latencySavingsMs, ' ms')} — {run.latencySavingsBasis}</p><p className={styles.muted}>Run ID {run.id} · {run.actionsExecuted.length === 0 ? 'Diagnostics only; no remedy was applicable.' : 'Only verified, relevant remedies may resolve an incident.'}</p></details>)}
    </section>
    {selected && <ResolutionDialog incident={selected} onClose={() => setSelected(null)} onError={onError} onChanged={onChanged} />}
  </div>;
}
