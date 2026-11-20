'use client';

import { Activity, AlertTriangle, Clock3, Cpu, Database, Layers, ShieldCheck, Star, Users, Zap } from 'lucide-react';
import type { NodeTelemetry, Overview, Telemetry } from '@/lib/admin-types';
import { Gauge, measurement, memory, MetricCard, timestamp } from './shared';
import styles from './admin.module.css';

interface Props {
  overview: Overview;
  telemetry: Telemetry;
  node: NodeTelemetry | null;
  nodeError: string;
  history: { timestamp: string; p95: number | null }[];
  healing: boolean;
  onHeal: () => void;
}

// Plots only real poll samples; a fresh session gets an empty state rather than demo data.
function LatencyChart({ history }: { history: Props['history'] }) {
  const samples = history.filter((sample): sample is { timestamp: string; p95: number } => sample.p95 !== null);
  if (samples.length < 2) return <div className={styles.empty}>Collecting live P95 samples. The chart appears after two polls.</div>;
  const ceiling = Math.max(1, ...samples.map((sample) => sample.p95));
  const points = samples.map((sample, index) => `${(index / Math.max(1, samples.length - 1)) * 580 + 10},${125 - sample.p95 / ceiling * 105}`).join(' ');
  return <><svg className={styles.chart} viewBox="0 0 600 140" preserveAspectRatio="none" role="img" aria-label="Live rolling P95 latency samples">
    <path d="M0 25H600 M0 75H600 M0 125H600" stroke="#8294be22" strokeDasharray="4 6" />
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
  </svg><div className={styles.chartCaption}><span>{samples.length} observed polls · 0–{measurement(ceiling, ' ms', 0)}</span><span>Newest →</span></div></>;
}

// Presents durable usage, measured resources, live latency, and dependency health.
export default function OverviewPanel({ overview, telemetry, node, nodeError, history, healing, onHeal }: Props) {
  const resource = telemetry.resources;
  const statuses = telemetry.http.statusCounts;
  const colors: Record<string, string> = { '2xx': '#69d8b2', '3xx': '#91acff', '4xx': '#e6b773', '5xx': '#f4869c', other: '#8997b4' };
  const memoryPercent = resource.rssBytes === null ? null : resource.rssBytes / resource.memoryLimitBytes * 100;
  const gateway = telemetry.gateway;
  const attention = overview.systemAlerts.length > 0 || telemetry.database.pools.some((pool) => pool.status !== 'healthy');
  return <div className={styles.stack}>
    <div className={styles.metrics}>
      <MetricCard label="Total users" value={overview.totalUsers.toLocaleString()} note="Registered identities + guests" icon={<Users size={16} />} />
      <MetricCard label="Active · 24h" value={overview.active24h.toLocaleString()} note="Authenticated activity" icon={<Activity size={16} />} />
      <MetricCard label="Completed sessions" value={overview.completedSessions.toLocaleString()} note={`${overview.totalSessions.toLocaleString()} answered sessions total`} icon={<Layers size={16} />} />
      <MetricCard label="Verified star rating" value={overview.reviewCount > 0 ? overview.averageRating.toFixed(1) : '0.0'} note={`${overview.reviewCount} verified reviews · no seeded ratings`} icon={<Star size={16} />} />
      <MetricCard label="Active incidents" value={overview.activeIncidents} note={`${overview.autoMitigatedCount} verified auto-mitigations retained`} icon={<AlertTriangle size={16} />} />
    </div>

    <section className={`${styles.glass} ${styles.health}`}>
      <div className={styles.healthText}><ShieldCheck size={28} color={attention ? '#e6b773' : '#85e7c5'} /><div><h2 className={styles.heading}>Live infrastructure health</h2><p className={styles.muted}>{attention ? 'Some signals need attention. Safe remedies are available below.' : 'No current alerts in this worker. Diagnostics verify readiness separately.'}</p><span className={styles.eyebrow}>{overview.autoHealingEnabled ? 'Autonomous monitoring enabled' : 'Operator kill switch active'}</span></div></div>
      <button type="button" className={styles.primary} disabled={healing} onClick={onHeal}><Zap size={16} />{healing ? 'Verifying and repairing…' : 'Run Autonomous Diagnostics & Self-Healing'}</button>
    </section>

    <div className={styles.gauges}>
      <Gauge label="API process CPU" value={resource.cpuPercent} percent={resource.cpuPercent} unit="%" note={`Normalized across cores · host ${measurement(resource.systemCpuPercent, '%')}`} />
      <Gauge label="API resident memory" value={resource.rssBytes === null ? null : resource.rssBytes / 1024 / 1024} percent={memoryPercent} unit="MiB" note={`Budget ${memory(resource.memoryLimitBytes)} · Python worker`} />
      <Gauge label="Rolling P95 latency" value={telemetry.latencyMs.p95} percent={telemetry.latencyMs.p95 === null ? null : telemetry.latencyMs.p95 / 50} unit="ms" note="15-minute window · gauge scale 5,000 ms" />
    </div>

    <div className={styles.columns}>
      <section className={styles.glass}>
        <div className={styles.sectionHead}><h2 className={styles.heading}><Clock3 size={17} /> Request latency</h2><span className={styles.badge}>{telemetry.latencyMs.sampleCount.toLocaleString()} samples</span></div>
        <div className={styles.triple}>{(['p50', 'p95', 'p99'] as const).map((key) => <div key={key}><span className={styles.eyebrow}>{key}</span><strong className={styles.metricValue}>{measurement(telemetry.latencyMs[key], ' ms')}</strong></div>)}</div>
        <LatencyChart history={history} />
        {telemetry.latencyMs.samplesTruncated && <p className={styles.notice}>The bounded latency buffer filled. Percentiles reflect the most recent retained samples, not every request in the window.</p>}
        <hr className={styles.divider} />
        <div className={styles.row}><h3 className={styles.heading}>HTTP volume & throughput</h3><span className={styles.badge}>{measurement(telemetry.http.requestsPerSecond, ' req/s', 2)}</span></div>
        <div className={styles.statusBars} aria-hidden>{Object.entries(statuses).filter(([, count]) => count > 0).map(([group, count]) => <span key={group} style={{ flex: count, background: colors[group] }} />)}</div>
        <div className={styles.legend}>{Object.entries(statuses).map(([group, count]) => <span key={group} style={{ color: colors[group] }}>{group}: {count.toLocaleString()}</span>)}</div>
        <p className={styles.muted}>{telemetry.http.windowRequests.toLocaleString()} rolling requests · {telemetry.http.totalRequests.toLocaleString()} since worker start · {telemetry.http.inFlight} in flight. One-second count buckets.</p>
      </section>

      <section className={styles.glass}>
        <div className={styles.sectionHead}><h2 className={styles.heading}><Database size={17} /> Database & gateway</h2><span className={styles.badge}>SQLite WAL</span></div>
        <dl className={styles.detailGrid}><div><dt>Active SQL operations</dt><dd>{telemetry.database.activeQueries}</dd></div><div><dt>Average SQL execution</dt><dd>{measurement(telemetry.database.averageQueryLatencyMs, ' ms', 2)}</dd></div></dl>
        {telemetry.database.pools.map((pool) => <div className={styles.service} key={pool.name}><div className={styles.row}><strong className={styles.incidentTitle}>{pool.name}</strong><span className={`${styles.badge} ${pool.status === 'healthy' ? styles.verified : styles.high}`}>{pool.status}</span></div><p className={styles.muted}>{pool.active}/{pool.capacity} leased · {pool.idle} idle · {pool.waiting} waiting · generation {pool.generation}</p></div>)}
        <hr className={styles.divider} />
        <div className={styles.row}><h3 className={styles.heading}>Generation route</h3><span className={styles.badge}>{gateway?.route || 'unavailable'}</span></div>
        <p className={styles.muted}>{gateway?.activeModel || 'Grounded local extracts only'} · {gateway?.verified ? 'Recently verified by a real response' : 'Not recently verified'}</p>
        {gateway?.breakers.map((breaker) => <div className={styles.service} key={breaker.model}><div className={styles.row}><span className={styles.muted}>{breaker.model}</span><span className={`${styles.badge} ${breaker.failures ? styles.medium : ''}`}>{breaker.state}</span></div>{breaker.failures > 0 && <p className={styles.muted}>{breaker.failures} failures · backoff {measurement(breaker.retryAfterSeconds, 's', 0)}</p>}</div>)}
      </section>
    </div>

    <div className={styles.columns}>
      <section className={styles.glass}>
        <div className={styles.sectionHead}><h2 className={styles.heading}><Cpu size={17} /> Runtime internals</h2><span className={styles.badge}>Measured, not simulated</span></div>
        <dl className={styles.detailGrid}>
          <div><dt>Python event-loop lag</dt><dd>{measurement(resource.eventLoopLagMs, ' ms')}</dd></div><div><dt>Python traced heap (opt-in)</dt><dd>{memory(resource.heapUsedBytes)}</dd></div>
          <div><dt>Next.js Node RSS</dt><dd>{memory(node?.rssBytes)}</dd></div><div><dt>Next.js Node used / allocated heap</dt><dd>{memory(node?.heapUsedBytes)} / {memory(node?.heapTotalBytes)}</dd></div>
          <div><dt>Next.js Node CPU</dt><dd>{measurement(node?.cpuPercent, '%')}</dd></div><div><dt>Next.js Node event-loop lag</dt><dd>{measurement(node?.eventLoopLagMs, ' ms')}</dd></div>
        </dl>
        {nodeError && <p className={styles.notice}>{nodeError}</p>}
        <p className={styles.muted}>{telemetry.scope}. {node?.scope || 'Node telemetry requires the authenticated Next.js runtime route.'}</p>
      </section>
      <section className={styles.glass}>
        <h2 className={styles.heading}><AlertTriangle size={17} /> System alerts</h2>
        {overview.systemAlerts.length === 0 ? <p className={styles.empty}>No active alerts in the retained incident window.</p> : overview.systemAlerts.slice(0, 6).map((alert, index) => <div className={styles.service} key={`${alert.message}-${index}`}><span className={`${styles.badge} ${styles[alert.severity]}`}>{alert.severity}</span><p className={styles.muted}>{alert.message}</p></div>)}
      </section>
    </div>
    <p className={styles.muted}>{overview.sessionDefinition}. API instance {telemetry.instanceId} · resources sampled {timestamp(resource.sampledAt)}. Unsupported sensors show N/A.</p>
  </div>;
}
