'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, BookOpen, LockKeyhole, LogOut, RefreshCw, ShieldCheck, Siren, Users } from 'lucide-react';
import { getSessionInfo, loginAdmin, SESSION_CHANGED_EVENT, signOut } from '@/lib/api';
import { AdminApiError, executeSelfHealing, getAdminOverview, getAdminTelemetry, getNodeTelemetry } from '@/lib/admin-api';
import type { HealingReport, NodeTelemetry, Overview, Telemetry } from '@/lib/admin-types';
import OverviewPanel from './admin/overview-panel';
import UserRoster from './admin/user-roster';
import IncidentPanel from './admin/incident-panel';
import PortfolioPanel from './admin/portfolio-panel';
import { ExecutionReport, timestamp } from './admin/shared';
import styles from './admin/admin.module.css';

const TABS = [
  { id: 'overview', label: 'Live telemetry & overview', Icon: Activity },
  { id: 'users', label: 'User roster & activity', Icon: Users },
  { id: 'incidents', label: 'Incidents & self-healing', Icon: Siren },
  { id: 'portfolio', label: 'Architecture & portfolio', Icon: BookOpen },
] as const;
type Tab = typeof TABS[number]['id'];
interface DashboardData { overview: Overview; telemetry: Telemetry; node: NodeTelemetry | null; nodeError: string }

// Runs a protected, cancellation-safe command center with polling and truthful operational states.
export default function AdminDashboardPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<'checking' | 'locked' | 'ready'>('checking');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [authRevision, setAuthRevision] = useState(0);
  const [email, setEmail] = useState(process.env.NEXT_PUBLIC_ADMIN_EMAIL || '');
  const [token, setToken] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [healing, setHealing] = useState(false);
  const [report, setReport] = useState<HealingReport | null>(null);
  const [history, setHistory] = useState<{ timestamp: string; p95: number | null }[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const busyRef = useRef(false);
  const loginRef = useRef(false);
  const identityVersion = useRef(0);
  const instanceRef = useRef('');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Locks and discards privileged data immediately after any backend authorization rejection.
  const handleError = useCallback((failure: unknown) => {
    if (failure instanceof AdminApiError && [401, 403].includes(failure.status)) {
      identityVersion.current += 1;
      setData(null); setReport(null); setHistory([]); setStatus('locked');
      setError('Administrator access expired or was denied. Sign in with an authorized account.');
    }
  }, []);

  // Triggers a fresh read after a mutation without retrying the mutation itself.
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    // Clears sensitive state before another account or browser tab replaces the stored token.
    const changed = () => {
      identityVersion.current += 1;
      setData(null); setReport(null); setHistory([]); setStatus('checking'); setError('');
      setAuthRevision((value) => value + 1);
    };
    // Reacts only to authentication storage keys, not to chat transcript writes.
    const storageChanged = (event: StorageEvent) => { if (event.key === 'token' || event.key === 'docmind_access_token' || event.key === null) changed(); };
    window.addEventListener(SESSION_CHANGED_EVENT, changed);
    window.addEventListener('storage', storageChanged);
    return () => { window.removeEventListener(SESSION_CHANGED_EVENT, changed); window.removeEventListener('storage', storageChanged); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const version = identityVersion.current;
    let timer: ReturnType<typeof setTimeout>;
    // Polls after each completed read and pauses hidden tabs to avoid overlapping requests.
    const poll = async () => {
      // This display-only hint avoids treating an ordinary visit as an admin probe;
      // every actual API call still independently verifies authorization server-side.
      if (getSessionInfo()?.role !== 'admin') { setData(null); setStatus('locked'); return; }
      if (document.visibilityState === 'hidden') { timer = setTimeout(poll, 5000); return; }
      let authorized = true;
      try {
        const [overview, telemetry] = await Promise.all([getAdminOverview(controller.signal), getAdminTelemetry(controller.signal)]);
        let node: NodeTelemetry | null = null;
        let nodeError = '';
        try { node = await getNodeTelemetry(controller.signal); }
        catch (failure) {
          if (failure instanceof AdminApiError && [401, 403].includes(failure.status)) throw failure;
          nodeError = 'Next.js runtime telemetry is unavailable. API-worker measurements remain separate; no Node values are fabricated.';
        }
        if (controller.signal.aborted || version !== identityVersion.current) return;
        if (instanceRef.current !== telemetry.instanceId) { instanceRef.current = telemetry.instanceId; setHistory([{ timestamp: telemetry.timestamp, p95: telemetry.latencyMs.p95 }]); }
        else setHistory((current) => [...current, { timestamp: telemetry.timestamp, p95: telemetry.latencyMs.p95 }].slice(-60));
        setData({ overview, telemetry, node, nodeError }); setStatus('ready'); setError(''); setUpdatedAt(new Date().toISOString());
      } catch (failure) {
        if (controller.signal.aborted || version !== identityVersion.current) return;
        if (failure instanceof AdminApiError && [401, 403].includes(failure.status)) {
          authorized = false; handleError(failure);
        } else {
          setError(failure instanceof Error ? failure.message : 'Could not reach the command center.');
          setStatus((current) => current === 'ready' ? current : 'locked');
        }
      }
      if (authorized && !controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [authRevision, revision, handleError]);

  // Exchanges the operator's secret for a signed session, keeping the secret out of saved storage.
  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginRef.current || !(email || '').trim() || !(token || '').trim()) return;
    loginRef.current = true; setSigningIn(true); setError('');
    try {
      const session = await loginAdmin(email.trim(), token);
      if (session.data.role !== 'admin') throw new Error('This email is not the configured administrator.');
      setToken('');
      refresh();
    } catch (failure) { setStatus('locked'); setError(failure instanceof Error ? failure.message : 'Admin sign-in failed.'); }
    finally { loginRef.current = false; setSigningIn(false); }
  };

  // Executes at most one manual repair at a time and ignores results after an account change.
  const runHealing = useCallback(async (incidentId?: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setHealing(true); setError('');
    const version = identityVersion.current;
    try {
      const result = await executeSelfHealing(incidentId);
      if (version !== identityVersion.current) return;
      setReport(result); refresh();
    } catch (failure) {
      if (version !== identityVersion.current) return;
      setError(failure instanceof Error ? failure.message : 'Self-healing request failed.'); handleError(failure);
    } finally { busyRef.current = false; setHealing(false); }
  }, [handleError, refresh]);

  // Implements keyboard roving focus for the four dashboard tabs.
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault(); setTab(TABS[next].id); tabRefs.current[next]?.focus();
  };

  return <main className={styles.page}><div className={styles.shell}>
    <Link href="/" className={styles.back}><ArrowLeft size={14} /> Back to DocMind</Link>
    <header className={styles.header}><div className={styles.brand}><div className={styles.logo}><ShieldCheck size={26} /></div><div><span className={styles.eyebrow}>DocMind AI / Operations control plane</span><h1 className={styles.title}>Admin Command Center</h1><p className={styles.subtitle}>Live telemetry. Account intelligence. Verified recovery.</p></div></div>
      {status === 'ready' && <div className={styles.row}><span className={styles.status}><span className={styles.dot} /> Role verified</span><button type="button" className={styles.button} onClick={signOut}><LogOut size={14} /> Lock console</button></div>}
    </header>
    {error && <div className={styles.error} role="alert">{data ? 'Refresh or action failed. Existing measurements may be stale. ' : ''}{error} <button type="button" className={styles.button} onClick={refresh}>Retry read</button></div>}
    {status !== 'ready' || !data ? <section className={`${styles.glass} ${styles.login}`}>
      <LockKeyhole size={26} color="#a5b4fc" /><h2 className={styles.title}>{status === 'checking' ? 'Verifying access…' : 'Authorized operators only'}</h2><p className={styles.subtitle}>The backend validates your signed session, current admin role, and suspension state on every request.</p>
      <form onSubmit={signIn}>
        <label className={styles.label}>Administrator email<input type="email" className={styles.input} required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} placeholder="Configured ADMIN_EMAIL" /></label>
        <label className={styles.label}>Admin access token<input type="password" className={styles.input} required autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} maxLength={500} placeholder="ADMIN_ACCESS_TOKEN" /></label>
        <button type="submit" className={styles.primary} disabled={signingIn || !(token || '').trim() || !(email || '').trim()}>{signingIn ? 'Verifying…' : 'Unlock command center'}</button>
      </form>
    </section> : <div className={styles.stack}>
      <div className={styles.toolbar}><p className={styles.muted}>{getSessionInfo()?.email || 'Administrator'} · Last synchronized {timestamp(updatedAt)} · 5-second polling while visible</p><button type="button" className={styles.button} onClick={refresh}><RefreshCw size={14} /> Refresh telemetry</button></div>
      <nav className={styles.tabs} role="tablist" aria-label="Admin command center tabs">{TABS.map(({ id, label, Icon }, index) => <button key={id} ref={(element) => { tabRefs.current[index] = element; }} id={`tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1} className={styles.tab} onClick={() => setTab(id)} onKeyDown={(event) => navigateTabs(event, index)}><Icon size={15} />{label}</button>)}</nav>
      {report && <details open className={styles.audit}><summary>Latest diagnostics result · {report.status}</summary><ExecutionReport report={report} /></details>}
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {tab === 'overview' && <OverviewPanel {...data} history={history} healing={healing} onHeal={() => void runHealing()} />}
        {tab === 'users' && <UserRoster revision={revision} onError={handleError} onChanged={refresh} />}
        {tab === 'incidents' && <IncidentPanel revision={revision} healing={healing} onHeal={(id) => void runHealing(id)} onError={handleError} onChanged={refresh} />}
        {tab === 'portfolio' && <PortfolioPanel overview={data.overview} telemetry={data.telemetry} />}
      </section>
    </div>}
  </div></main>;
}
