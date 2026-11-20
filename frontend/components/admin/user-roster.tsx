'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Search, ShieldAlert, UserCheck } from 'lucide-react';
import { getAdminUser, getAdminUsers, setUserSuspension } from '@/lib/admin-api';
import type { UserDetail, UserPage } from '@/lib/admin-types';
import { measurement, Modal, rating, timestamp } from './shared';
import styles from './admin.module.css';

interface Props { revision: number; onError: (error: unknown) => void; onChanged: () => void }

// Inspects and moderates an account using a safe detail projection and an explicit audit reason.
function UserInspector({ id, onClose, onChanged, onError }: { id: string; onClose: () => void; onChanged: () => void; onError: Props['onError'] }) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    getAdminUser(id, controller.signal).then((result) => { if (!controller.signal.aborted) setDetail(result); }).catch((failure: unknown) => {
      if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Could not load this account.'); onError(failure); }
    });
    return () => controller.abort();
  }, [id, onError]);

  // Applies account enforcement only after a reason is entered; admins are protected on both sides.
  const changeSuspension = async () => {
    if (busy || !detail || (notes || '').trim().length < 3) return;
    setBusy(true); setError('');
    try {
      const result = await setUserSuspension(id, !detail.user.suspended, notes.trim());
      setDetail(result); setNotes(''); onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Account change failed.'); onError(failure); }
    finally { setBusy(false); }
  };

  return <Modal title="Account inspection" onClose={onClose}>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!detail ? <p className={styles.empty}>Loading account details…</p> : <div className={styles.stack}>
      <div><strong className={styles.name}>{detail.user.name}</strong><p className={styles.muted}>{detail.user.email || 'Guest identity'} · {detail.user.id}</p></div>
      <dl className={styles.detailGrid}>
        <div><dt>Role / state</dt><dd>{detail.user.role} · {detail.user.suspended ? 'Suspended' : 'Active'}</dd></div><div><dt>Real star rating</dt><dd>{rating(detail.user.averageRating, detail.user.reviewCount)}</dd></div>
        <div><dt>Sessions / completed</dt><dd>{detail.user.totalSessions} / {detail.user.completedSessions}</dd></div><div><dt>Diagnostic score</dt><dd>{measurement(detail.user.averageDiagnosticScore)}</dd></div>
        <div><dt>Questions / active documents</dt><dd>{detail.user.questions} / {detail.user.activeDocuments}</dd></div><div><dt>Last activity</dt><dd>{timestamp(detail.user.lastActiveAt)}</dd></div>
      </dl>
      {detail.user.suspensionReason && <p className={styles.notice}>Suspension reason: {detail.user.suspensionReason}</p>}
      <h3 className={styles.heading}>Recent document sessions</h3>
      {detail.sessions.length === 0 ? <p className={styles.muted}>No answered sessions recorded yet.</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Started</th><th>Answers</th><th>State</th><th>Stars</th></tr></thead><tbody>{detail.sessions.map((session) => <tr key={session.id}><td>{timestamp(session.startedAt)}</td><td>{session.answers}</td><td>{session.completedAt ? 'Completed' : 'Active'}</td><td>{session.stars === null ? 'Not rated yet' : `${session.stars} / 5`}</td></tr>)}</tbody></table></div>}
      {detail.user.role === 'admin' ? <p className={styles.notice}>Administrator accounts cannot be suspended from this console.</p> : <div className={styles.stack}>
        <label className={styles.label}>Reason for {detail.user.suspended ? 'restoring' : 'suspending'} access<textarea className={styles.textarea} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Required audit explanation (at least 3 characters)" /></label>
        <button type="button" className={detail.user.suspended ? styles.primary : styles.danger} disabled={busy || (notes || '').trim().length < 3} onClick={changeSuspension}>{detail.user.suspended ? <UserCheck size={16} /> : <ShieldAlert size={16} />}{busy ? 'Saving…' : detail.user.suspended ? 'Restore account access' : 'Suspend account'}</button>
        <p className={styles.muted}>Suspension takes effect on the next authenticated request, including existing tokens.</p>
      </div>}
    </div>}
  </Modal>;
}

// Renders searchable, filterable, paginated real users without inventing candidate scores.
export default function UserRoster({ revision, onError, onChanged }: Props) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [rated, setRated] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search.trim()) params.set('search', search.trim());
      if (role) params.set('role', role);
      if (status) params.set('status', status);
      if (rated) params.set('rated', rated);
      try { const result = await getAdminUsers(params, controller.signal); if (!controller.signal.aborted) setData(result); }
      catch (failure) { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Could not load users.'); onError(failure); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, role, status, rated, page, revision, onError]);

  return <section className={`${styles.glass} ${styles.stack}`}>
    <div className={styles.row}><div><h2 className={styles.heading}>Candidate / user roster</h2><p className={styles.muted}>Document-chat activity is real. Interview and exam scores remain N/A until those features exist.</p></div><span className={styles.badge}>{data ? `${data.total} identities` : 'Loading…'}</span></div>
    <div className={styles.filters}>
      <label className={styles.label}><span><Search size={12} /> Search name, email, or ID</span><input className={styles.input} value={search} maxLength={100} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search users…" type="search" /></label>
      <label className={styles.label}>Role<select className={styles.select} value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}><option value="">All roles</option><option value="user">User</option><option value="admin">Admin</option></select></label>
      <label className={styles.label}>Account<select className={styles.select} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All states</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
      <label className={styles.label}>Reviews<select className={styles.select} value={rated} onChange={(event) => { setRated(event.target.value); setPage(1); }}><option value="">All reviews</option><option value="rated">Rated</option><option value="unrated">Not rated yet</option></select></label>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.tableWrap} aria-busy={loading}><table className={styles.table}><caption className={styles.srOnly}>Verified user activity and account actions</caption><thead><tr><th>User name / email</th><th>Role / state</th><th>Sessions</th><th>Avg. diagnostic score</th><th>Real star rating</th><th>Joined</th><th>Actions</th></tr></thead><tbody>
      {data?.users.map((user) => <tr key={user.id}><td><strong className={styles.name}>{user.name}</strong><span className={styles.muted}>{user.email || 'Guest · no verified email'}</span></td><td><span className={styles.badge}>{user.role}</span><span className={styles.muted}>{user.suspended ? 'Suspended' : 'Active'}</span></td><td>{user.totalSessions}<span className={styles.muted}>{user.completedSessions} complete</span></td><td>{measurement(user.averageDiagnosticScore)}</td><td className={styles.nowrap}>{rating(user.averageRating, user.reviewCount)}{user.reviewCount > 0 && <span className={styles.muted}>{user.reviewCount} verified reviews</span>}</td><td>{timestamp(user.joinedAt)}</td><td><button type="button" className={styles.button} onClick={() => setSelected(user.id)} aria-label={`Inspect ${user.name}`}><Eye size={14} /> Inspect</button></td></tr>)}
      {(!data || data.users.length === 0) && <tr><td colSpan={7} className={styles.empty}>{loading ? 'Loading users…' : 'No users match these filters.'}</td></tr>}
    </tbody></table></div>
    <div className={styles.pagination}><span>{loading ? 'Updating…' : `Page ${page} of ${Math.max(1, Math.ceil((data?.total ?? 0) / 20))}`}</span><div><button type="button" className={styles.button} disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14} /> Previous</button><button type="button" className={styles.button} disabled={!data || page * 20 >= data.total || loading} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={14} /></button></div></div>
    {selected && <UserInspector key={selected} id={selected} onClose={() => setSelected(null)} onChanged={onChanged} onError={onError} />}
  </section>;
}
