'use client';

import { useState, useEffect } from 'react';
import { Shield, Activity, FileText, Users, Ban, Gauge, ArrowLeft, RefreshCw, Lock, CheckCircle2, XCircle, Globe, MonitorSmartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { getAdminMetrics, loginAdmin, type AdminMetricsResponse } from '@/lib/api';

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? '';

type MetricCard = {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
};

// Formats epoch seconds into a compact local timestamp.
function formatTime(value: unknown): string {
  if (typeof value !== 'number' || value <= 0) return 'Never';
  return new Date(value * 1000).toLocaleString();
}

// Condenses a user agent into something readable in a table cell. Order matters:
// Chrome advertises Safari and Edge advertises Chrome, so the most specific
// token has to be tested first.
function deviceLabel(agent: unknown): string {
  const ua = typeof agent === 'string' ? agent : '';
  if (!ua) return 'Not recorded';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|python|httpx|node|bot/i.test(ua)
              ? 'Script or bot'
              : 'Browser';
  const platform = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unknown platform';
  return `${browser} on ${platform}`;
}

// Renders one compact admin KPI tile with hover effects and glass design.
function StatCard({ label, value, icon }: MetricCard) {
  return (
    <motion.div 
      whileHover={{ y: -4, scale: 1.02, borderColor: 'rgba(99,102,241,0.3)' }}
      className="glass stat-card"
    >
      <div className="stat-header">
        <span>{label}</span>
        {icon}
      </div>
      <strong className="gradient-text count-up">{value}</strong>
    </motion.div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [adminToken, setAdminToken] = useState('');
  const [metrics, setMetrics] = useState<AdminMetricsResponse['data'] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Signs in the configured owner and loads the protected dashboard payload.
  const signIn = async () => {
    setLoading(true);
    setError('');
    try {
      await loginAdmin(ADMIN_EMAIL, adminToken);
      const result = await getAdminMetrics();
      setMetrics(result.data);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Admin access denied');
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  };

  // Reloads protected admin metrics using the saved signed session token.
  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getAdminMetrics();
      setMetrics(result.data);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not load admin metrics');
    } finally {
      setLoading(false);
    }
  };

  // Attempt to load metrics on mount if already signed in
  useEffect(() => {
    getAdminMetrics()
      .then((result) => setMetrics(result.data))
      .catch(() => {});
  }, []);

  const totals = metrics?.totals ?? {};
  const devices = metrics?.devices ?? [];

  return (
    <main className="admin-page noise">
      {/* Background ambient glows */}
      <div className="admin-ambient glow-1" aria-hidden />
      <div className="admin-ambient glow-2" aria-hidden />

      <section className="admin-shell">
        <div className="admin-header-row">
          <motion.button 
            whileHover={{ x: -3 }}
            onClick={() => router.push('/')}
            className="back-btn"
          >
            <ArrowLeft size={16} /> Back to Home
          </motion.button>
          
          <div className="header-title-section">
            <div className="title-left">
              <Shield className="shield-icon" size={32} />
              <div>
                <span className="kicker">Security & Performance Console</span>
                <h1>DocMind AI Control Center</h1>
              </div>
            </div>
            {metrics && (
              <span className="status-badge">
                <span className="status-dot" /> Authenticated
              </span>
            )}
          </div>
        </div>

        {!metrics ? (
          <motion.div 
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass login-panel"
          >
            <div className="login-header">
              <div className="lock-circle">
                <Lock size={22} color="#818cf8" />
              </div>
              <h2>Console Locked</h2>
              <p>Enter the security token configured for {ADMIN_EMAIL}</p>
            </div>
            
            <div className="form-group">
              <label htmlFor="admin-token">Access Token</label>
              <input
                id="admin-token"
                type="password"
                value={adminToken}
                onChange={(event) => setAdminToken(event.target.value)}
                placeholder="Enter ADMIN_ACCESS_TOKEN"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && adminToken.trim()) signIn();
                }}
              />
            </div>
            
            <button 
              type="button" 
              onClick={signIn} 
              className="glow-btn login-btn"
              disabled={loading || !adminToken.trim()}
            >
              {loading ? 'Decrypting...' : 'Unlock Dashboard'}
            </button>
            {error && <p className="error-text"><Ban size={14} /> {error}</p>}
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="dashboard-content"
          >
            <div className="toolbar glass">
              <div className="admin-user-info">
                <span className="avatar">A</span>
                <div>
                  <p className="admin-email">{ADMIN_EMAIL}</p>
                  <p className="admin-role">Super Administrator</p>
                </div>
              </div>
              <button type="button" onClick={refresh} className="refresh-btn" disabled={loading}>
                <RefreshCw size={14} className={loading ? 'spin' : ''} /> {loading ? 'Syncing...' : 'Refresh Logs'}
              </button>
            </div>

            <div className="stats-grid">
              <StatCard label="Total Users" value={totals.users ?? 0} icon={<Users size={16} color="#a5b4fc" />} />
              <StatCard label="Guest Sessions" value={totals.guest_users ?? 0} icon={<Users size={16} color="#7dd3fc" />} />
              <StatCard label="Distinct IPs" value={totals.distinct_ips ?? 0} icon={<Globe size={16} color="#67e8f9" />} />
              <StatCard label="Blocked Users" value={totals.blocked_users ?? 0} icon={<Ban size={16} color="#f87171" />} />
              <StatCard label="Blocked IPs" value={totals.blocked_ips ?? 0} icon={<Shield size={16} color="#fca5a5" />} />
              <StatCard label="Active Documents" value={totals.active_documents ?? 0} icon={<FileText size={16} color="#a855f7" />} />
              <StatCard label="Total Uploads" value={totals.all_documents ?? 0} icon={<FileText size={16} color="#c084fc" />} />
              <StatCard label="Questions Asked" value={totals.total_questions ?? 0} icon={<Gauge size={16} color="#ec4899" />} />
            </div>

            <div className="layout-grid">
              <div className="main-cards">
                <section className="glass table-card">
                  <h2>
                    <Users size={18} color="#6366f1" /> Enrolled Identities
                  </h2>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>User ID</th>
                          <th>Email</th>
                          <th>IP Address</th>
                          <th>Device</th>
                          <th>Role</th>
                          <th>Active PDFs</th>
                          <th>Questions</th>
                          <th>Status</th>
                          <th>Last Activity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.users.map((user) => (
                          <tr key={String(user.user_id)}>
                            <td className="mono">{String(user.user_id).substring(0, 12)}...</td>
                            <td>{user.email ? String(user.email) : <span className="guest-tag">Guest</span>}</td>
                            <td className="mono ip-cell">
                              {user.last_ip ? String(user.last_ip) : '—'}
                              {Number(user.ip_count ?? 0) > 1 && (
                                <span className="ip-more" title={`Seen from ${user.ip_count} addresses`}>
                                  +{Number(user.ip_count) - 1}
                                </span>
                              )}
                            </td>
                            <td className="muted device-cell" title={String(user.last_user_agent ?? '')}>
                              {deviceLabel(user.last_user_agent)}
                            </td>
                            <td>
                              <span className={`role-tag ${String(user.role)}`}>
                                {String(user.role)}
                              </span>
                            </td>
                            <td>{String(user.active_documents ?? 0)}</td>
                            <td>{String(user.question_count ?? 0)}</td>
                            <td>
                              {Number(user.is_blocked) ? (
                                <span className="status-tag blocked" title={String(user.block_reason)}>
                                  <XCircle size={12} /> Blocked
                                </span>
                              ) : (
                                <span className="status-tag active">
                                  <CheckCircle2 size={12} /> Active
                                </span>
                              )}
                            </td>
                            <td className="muted">{formatTime(user.last_seen_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="glass table-card">
                  <h2>
                    <Globe size={18} color="#22d3ee" /> Visitor Addresses
                  </h2>
                  <p className="section-note">
                    A browser never sends its MAC address to a server — it is link-layer data that
                    stays on the visitor&apos;s own network. The IP address and the device below are
                    the identifying pair a web deployment can actually record.
                  </p>
                  {devices.length === 0 ? (
                    <p className="empty-note">
                      No visits recorded yet. Open the app in another browser and this fills in.
                    </p>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>IP Address</th>
                            <th>Visitor</th>
                            <th>Device</th>
                            <th>Requests</th>
                            <th>First Seen</th>
                            <th>Last Seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {devices.map((device) => (
                            <tr key={`${device.user_id}-${device.ip_address}-${device.user_agent ?? ''}`}>
                              <td className="mono ip-cell">
                                {device.ip_address}
                                {device.is_blocked_ip ? (
                                  <span className="ip-blocked" title="This address is blocked">
                                    blocked
                                  </span>
                                ) : null}
                              </td>
                              <td>
                                {device.email ? (
                                  String(device.email)
                                ) : (
                                  <span className="guest-tag">Guest</span>
                                )}
                                <span className="visitor-id mono">
                                  {device.user_id.substring(0, 10)}...
                                </span>
                              </td>
                              <td className="muted device-cell" title={device.user_agent ?? ''}>
                                <MonitorSmartphone size={13} /> {deviceLabel(device.user_agent)}
                              </td>
                              <td>{device.hits}</td>
                              <td className="muted">{formatTime(device.first_seen_at)}</td>
                              <td className="muted">{formatTime(device.last_seen_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="glass table-card">
                  <h2>
                    <Activity size={18} color="#ec4899" /> Security Audit Log
                  </h2>
                  <div className="event-list">
                    {metrics.audit_events.map((event, index) => (
                      <div key={`${String(event.created_at)}-${index}`} className="audit-item">
                        <div className="audit-meta">
                          <span className={`severity-badge ${String(event.severity)}`}>
                            {String(event.severity)}
                          </span>
                          <strong className="event-type">{String(event.event_type)}</strong>
                          <span className="event-time">{formatTime(event.created_at)}</span>
                        </div>
                        <div className="audit-details">
                          <span className="mono">IP: {String(event.ip_address)}</span>
                          {event.user_id ? <span className="mono">User: {String(event.user_id).substring(0, 10)}...</span> : null}
                          <code>{JSON.stringify(event.details)}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="sidebar-cards">
                <section className="glass info-card">
                  <h2>
                    <Gauge size={18} color="#a855f7" /> Enforcement Rules
                  </h2>
                  <div className="limit-rows">
                    <div className="limit-row">
                      <span>Max PDFs / Guest</span>
                      <strong>{metrics.limits.pdfs_per_guest ?? metrics.limits.pdfs_per_user} Slots</strong>
                    </div>
                    <div className="limit-row">
                      <span>Max PDFs / Account</span>
                      <strong>{metrics.limits.pdfs_per_account ?? metrics.limits.pdfs_per_user} Slots</strong>
                    </div>
                    <div className="limit-row">
                      <span>Max Questions / User</span>
                      <strong>
                        {metrics.limits.questions_per_user === 0
                          ? 'Unlimited'
                          : `${metrics.limits.questions_per_user} Queries`}
                      </strong>
                    </div>
                    <div className="limit-row">
                      <span>Payload Limit</span>
                      <strong>10 MB</strong>
                    </div>
                  </div>
                  <p className="limit-notice">
                    All rate limits and document slot sizes are enforced cryptographically via signed session headers.
                  </p>
                </section>

                <section className="glass info-card">
                  <h2>
                    <Activity size={18} color="#a855f7" /> Client Telemetry
                  </h2>
                  <div className="vitals-list">
                    {metrics.web_vitals.map((vital) => (
                      <div key={String(vital.metric_name)} className="vital-item">
                        <div className="vital-header">
                          <span className="vital-name">{String(vital.metric_name)}</span>
                          <span className="vital-samples">{String(vital.samples)} samples</span>
                        </div>
                        <div className="vital-stats">
                          <div className="vital-stat">
                            <span>AVG</span>
                            <strong>{Number(vital.average_value ?? 0).toFixed(0)}ms</strong>
                          </div>
                          <div className="vital-stat">
                            <span>WORST</span>
                            <strong>{Number(vital.worst_value ?? 0).toFixed(0)}ms</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </motion.div>
        )}
      </section>

      <style>{`
        .admin-page {
          min-height: 100vh;
          padding: 64px 24px;
          background: #000000;
          color: #ffffff;
          position: relative;
          overflow-x: hidden;
          font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .admin-ambient {
          position: absolute;
          width: 500px;
          height: 500px;
          border-radius: 50%;
          filter: blur(120px);
          pointer-events: none;
          z-index: 0;
          opacity: 0.15;
        }
        .glow-1 {
          background: #6366f1;
          top: -10%;
          left: -10%;
        }
        .glow-2 {
          background: #ec4899;
          bottom: 10%;
          right: -10%;
        }
        .admin-shell {
          width: min(1200px, 100%);
          margin: 0 auto;
          position: relative;
          z-index: 1;
        }
        .admin-header-row {
          margin-bottom: 40px;
        }
        .back-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.45);
          font-size: 14px;
          cursor: pointer;
          margin-bottom: 24px;
          font-weight: 500;
          transition: color 0.2s ease;
        }
        .back-btn:hover {
          color: #ffffff;
        }
        .header-title-section {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
        }
        .title-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .shield-icon {
          color: #6366f1;
          filter: drop-shadow(0 0 10px rgba(99, 102, 241, 0.5));
        }
        .kicker {
          display: block;
          color: #818cf8;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.15em;
          text-transform: uppercase;
        }
        h1 {
          font-size: clamp(24px, 4vw, 36px);
          font-weight: 800;
          letter-spacing: -0.03em;
          margin-top: 4px;
        }
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: rgba(34, 197, 94, 0.08);
          border: 1px solid rgba(34, 197, 94, 0.25);
          color: #4ade80;
          font-size: 13px;
          font-weight: 600;
          border-radius: 99px;
        }
        .status-dot {
          width: 7px;
          height: 7px;
          background: #4ade80;
          border-radius: 50%;
          box-shadow: 0 0 8px #4ade80;
        }
        
        /* Login panel */
        .login-panel {
          max-width: 460px;
          margin: 100px auto 0;
          border-radius: 24px;
          padding: 40px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .login-header {
          text-align: center;
          margin-bottom: 32px;
        }
        .lock-circle {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
        }
        .login-header h2 {
          font-size: 22px;
          font-weight: 800;
          margin-bottom: 8px;
        }
        .login-header p {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.45);
        }
        .form-group {
          margin-bottom: 24px;
        }
        .form-group label {
          display: block;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.5);
          letter-spacing: 0.05em;
          margin-bottom: 8px;
        }
        .form-group input {
          width: 100%;
          padding: 14px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #ffffff;
          border-radius: 12px;
          font-size: 15px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .form-group input:focus {
          outline: none;
          border-color: rgba(99, 102, 241, 0.5);
          box-shadow: 0 0 15px rgba(99, 102, 241, 0.15);
        }
        .login-btn {
          width: 100%;
          padding: 16px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 700;
        }
        .error-text {
          color: #f87171;
          font-size: 13px;
          margin-top: 16px;
          display: flex;
          align-items: center;
          gap: 6px;
          justify-content: center;
        }

        /* Dashboard content */
        .dashboard-content {
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 28px;
          border-radius: 20px;
          flex-wrap: wrap;
          gap: 16px;
        }
        .admin-user-info {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 16px;
        }
        .admin-email {
          font-size: 14px;
          font-weight: 600;
        }
        .admin-role {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.4);
        }
        .refresh-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff;
          padding: 10px 20px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }
        .refresh-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
        }
        .spin {
          animation: spinning 1s linear infinite;
        }
        @keyframes spinning {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 16px;
        }
        :global(.stat-card) {
          border-radius: 20px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .stat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: rgba(255, 255, 255, 0.4);
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }
        :global(.stat-card strong) {
          font-size: 38px;
          font-weight: 800;
          line-height: 1;
        }

        .layout-grid {
          display: grid;
          grid-template-columns: 2.3fr 1fr;
          gap: 24px;
        }
        @media (max-width: 960px) {
          .layout-grid {
            grid-template-columns: 1fr;
          }
        }
        .main-cards {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .sidebar-cards {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* Generic dashboard sections */
        .table-card {
          border-radius: 24px;
          padding: 28px;
        }
        h2 {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 24px;
        }
        .table-wrap {
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13.5px;
          text-align: left;
        }
        th {
          padding: 12px 16px;
          color: rgba(255, 255, 255, 0.4);
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        td {
          padding: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.85);
        }
        tr:hover td {
          background: rgba(255, 255, 255, 0.015);
        }
        .mono {
          font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
          font-size: 12.5px;
        }
        .muted {
          color: rgba(255, 255, 255, 0.35);
        }
        .section-note {
          margin: -12px 0 20px;
          color: rgba(255, 255, 255, 0.4);
          font-size: 12.5px;
          line-height: 1.6;
          max-width: 74ch;
        }
        .empty-note {
          color: rgba(255, 255, 255, 0.35);
          font-size: 13px;
        }
        .ip-cell {
          white-space: nowrap;
        }
        .ip-more {
          margin-left: 7px;
          padding: 2px 6px;
          border-radius: 5px;
          background: rgba(34, 211, 238, 0.12);
          color: #67e8f9;
          font-size: 10.5px;
          font-weight: 700;
          cursor: help;
        }
        .ip-blocked {
          margin-left: 7px;
          padding: 2px 6px;
          border-radius: 5px;
          background: rgba(239, 68, 68, 0.14);
          color: #f87171;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .device-cell {
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }
        .guest-tag {
          padding: 3px 9px;
          border-radius: 99px;
          border: 1px solid rgba(125, 211, 252, 0.25);
          background: rgba(125, 211, 252, 0.1);
          color: #7dd3fc;
          font-size: 11px;
          font-weight: 700;
        }
        .visitor-id {
          display: block;
          margin-top: 4px;
          color: rgba(255, 255, 255, 0.28);
          font-size: 11px;
        }

        .role-tag {
          padding: 4px 10px;
          border-radius: 99px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .role-tag.admin {
          background: rgba(168, 85, 247, 0.12);
          border: 1px solid rgba(168, 85, 247, 0.3);
          color: #c084fc;
        }
        .role-tag.user {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.7);
        }
        
        .status-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 500;
        }
        .status-tag.active {
          color: #4ade80;
        }
        .status-tag.blocked {
          color: #f87171;
          cursor: help;
        }

        /* Audit logs */
        .event-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-height: 500px;
          overflow-y: auto;
          padding-right: 6px;
        }
        .audit-item {
          padding: 16px;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .audit-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .severity-badge {
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .severity-badge.info {
          background: rgba(59, 130, 246, 0.1);
          color: #60a5fa;
        }
        .severity-badge.warning {
          background: rgba(245, 158, 11, 0.1);
          color: #fbbf24;
        }
        .severity-badge.high {
          background: rgba(239, 68, 68, 0.12);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.25);
          box-shadow: 0 0 10px rgba(239, 68, 68, 0.1);
        }
        .event-type {
          font-size: 14px;
          color: #fff;
        }
        .event-time {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.35);
          margin-left: auto;
        }
        .audit-details {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding-top: 6px;
          border-top: 1px solid rgba(255, 255, 255, 0.04);
        }
        .audit-details span {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
        }
        .audit-details code {
          background: rgba(0, 0, 0, 0.4);
          padding: 8px 12px;
          border-radius: 8px;
          font-family: monospace;
          font-size: 12px;
          color: #a5b4fc;
          overflow-x: auto;
          white-space: pre-wrap;
        }

        /* Sidebar Info Card */
        .info-card {
          border-radius: 24px;
          padding: 28px;
        }
        .limit-rows {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 20px;
        }
        .limit-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 13.5px;
        }
        .limit-row span {
          color: rgba(255, 255, 255, 0.5);
        }
        .limit-row strong {
          color: #fff;
          font-weight: 700;
        }
        .limit-notice {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.3);
          line-height: 1.5;
        }

        /* Vitals telemetry */
        .vitals-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .vital-item {
          padding-bottom: 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .vital-item:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .vital-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .vital-name {
          font-weight: 700;
          color: #a855f7;
          font-size: 14px;
        }
        .vital-samples {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.35);
        }
        .vital-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .vital-stat {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .vital-stat span {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.4);
          font-weight: 600;
        }
        .vital-stat strong {
          font-size: 14px;
          color: #fff;
        }
      `}</style>
    </main>
  );
}
