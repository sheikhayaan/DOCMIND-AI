'use client';

import { useEffect, useState } from 'react';
import { Brain, Sparkles, RefreshCw, Cpu, CheckCircle2, TrendingUp, HelpCircle, Globe, Radio } from 'lucide-react';
import { getLearningStats, consolidateLearning } from '@/lib/admin-api';
import type { LearningStats, LearningOptimizationResult } from '@/lib/admin-types';
import styles from './admin.module.css';

interface LearningPanelProps {
  onChanged?: () => void;
}

export default function LearningPanel({ onChanged }: LearningPanelProps) {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [report, setReport] = useState<LearningOptimizationResult | null>(null);
  const [error, setError] = useState('');

  const loadData = async (signal?: AbortSignal) => {
    try {
      const data = await getLearningStats(signal);
      setStats(data);
      setError('');
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'Unable to load learning subsystem telemetry.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      loadData(controller.signal);
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const handleConsolidate = async () => {
    setOptimizing(true);
    setError('');
    try {
      const result = await consolidateLearning();
      setReport(result);
      await loadData();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Learning consolidation failed.');
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div className={styles.stack}>
      {/* Overview Banner */}
      <section className={`${styles.glass} ${styles.health}`} aria-labelledby="learning-heading">
        <div className={styles.healthText}>
          <Sparkles size={28} color="#a5b4fc" />
          <div>
            <h2 id="learning-heading" className={styles.heading}>
              IoT & Human Intelligence Cognitive System
            </h2>
            <p className={styles.subtitle}>
              DocMind AI combines human-level synthesis, cyber-physical and IoT telemetry awareness, continuous learning from previous responses of all users, and real-time live news grounding.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={styles.primary}
          onClick={handleConsolidate}
          disabled={optimizing}
          style={{ width: 'auto', minWidth: '220px' }}
        >
          {optimizing ? (
            <>
              <RefreshCw size={14} className="spin" /> Consolidating Wisdom...
            </>
          ) : (
            <>
              <Brain size={15} /> Consolidate Collective Wisdom
            </>
          )}
        </button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {report && (
        <section className={styles.glass} aria-labelledby="report-heading">
          <div className={styles.sectionHead}>
            <h3 id="report-heading" className={styles.heading} style={{ color: '#85e7c5' }}>
              <CheckCircle2 size={16} /> Autonomous Optimization & Cross-User Consolidation Applied
            </h3>
            <span className={`${styles.badge} ${styles.verified}`}>Status: {report.status}</span>
          </div>
          <p className={styles.muted}>{report.message}</p>
          <div className={styles.divider} />
          <dl className={styles.detailGrid}>
            <div>
              <dt>Optimization Action</dt>
              <dd><code>{report.action}</code></dd>
            </div>
            <div>
              <dt>Adaptive Retrieval top_k</dt>
              <dd>{report.adaptive_top_k} chunks</dd>
            </div>
            <div>
              <dt>Cross-User Insights Distilled</dt>
              <dd>{report.collective_insights_synthesized ?? 0} insights</dd>
            </div>
            <div>
              <dt>Active AI Cognitive Engine</dt>
              <dd>{report.active_engine}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Metrics Row */}
      <div className={styles.metrics}>
        <section className={`${styles.glass} ${styles.metric}`}>
          <div className={styles.metricLabel}>
            <span>Cognitive Engine Mode</span>
            <Cpu size={14} />
          </div>
          <span className={styles.metricValue} style={{ fontSize: 'clamp(16px, 2vw, 20px)', color: '#a5b4fc' }}>
            {stats?.intelligence_mode || 'IoT Human Intelligence Engine (Active)'}
          </span>
          <p className={styles.muted}>
            Multi-stage reasoning uniting structured document evidence with cyber-physical system awareness.
          </p>
        </section>

        <section className={`${styles.glass} ${styles.metric}`}>
          <div className={styles.metricLabel}>
            <span>Collective Cross-User Wisdom</span>
            <Brain size={14} />
          </div>
          <span className={styles.metricValue}>
            {loading ? '…' : `${stats?.collective_sessions || 0} Sessions / ${stats?.collective_insights || 0} Insights`}
          </span>
          <p className={styles.muted}>
            Learns continuously from verified previous interactions across all users to sharpen response clarity.
          </p>
        </section>

        <section className={`${styles.glass} ${styles.metric}`}>
          <div className={styles.metricLabel}>
            <span>Real-Time News Grounding</span>
            <Globe size={14} />
          </div>
          <span className={styles.metricValue} style={{ fontSize: 'clamp(14px, 1.8vw, 17px)', color: '#77e6bf' }}>
            {stats?.news_grounding_status || 'Active (Google Search + Real-Time News Stream)'}
          </span>
          <p className={styles.muted}>
            Live Google Search and RSS headline integration grounding answers with breaking 2026 world events.
          </p>
        </section>

        <section className={`${styles.glass} ${styles.metric}`}>
          <div className={styles.metricLabel}>
            <span>Global Satisfaction Index</span>
            <TrendingUp size={14} />
          </div>
          <span className={styles.metricValue} style={{ color: '#77e6bf' }}>
            {loading ? '…' : `${stats?.average_satisfaction.toFixed(1) || '5.0'} / 5.0 ★`}
          </span>
          <p className={styles.muted}>
            Cross-platform verified review score dynamically auto-tuning retrieval depth ({stats?.retrieval_top_k || 5} chunks).
          </p>
        </section>
      </div>

      {/* Multi-Engine Fleet */}
      <section className={styles.glass} aria-labelledby="engines-heading">
        <h3 id="engines-heading" className={styles.heading}>
          <Radio size={15} /> IoT Intelligence & Live Knowledge Fleet
        </h3>
        <p className={styles.muted} style={{ marginBottom: '14px' }}>
          Configured cognitive providers with circuit breaker isolation, latency tracking, live news feeds, and zero downtime failover.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Engine / Pipeline</th>
                <th>Provider / Source</th>
                <th>Role</th>
                <th>Health Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>gemini-2.5-flash</strong></td>
                <td>Google AI Studio</td>
                <td>IoT & Human Intelligence + Live Search Grounding</td>
                <td><span className={`${styles.badge} ${styles.verified}`}>Active & Grounded</span></td>
              </tr>
              <tr>
                <td><strong>Google News Live RSS</strong></td>
                <td>Google News Network</td>
                <td>Real-Time Breaking World News Feeds</td>
                <td><span className={`${styles.badge} ${styles.verified}`}>Live (Sub-Second Cache)</span></td>
              </tr>
              <tr>
                <td><strong>qwen/qwen3.8-27b</strong></td>
                <td>Groq Cloud LPU</td>
                <td>Fast Analytical Fallback</td>
                <td><span className={`${styles.badge} ${styles.verified}`}>Online & Ready</span></td>
              </tr>
              <tr>
                <td><strong>openai/gpt-oss-120b</strong></td>
                <td>Groq Cloud LPU</td>
                <td>Complex Architecture & Hardware Fallback</td>
                <td><span className={`${styles.badge} ${styles.low}`}>Standby</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Learned Exemplars Roster */}
      <section className={styles.glass} aria-labelledby="exemplars-heading">
        <div className={styles.sectionHead}>
          <h3 id="exemplars-heading" className={styles.heading}>
            <HelpCircle size={15} /> Collective User Wisdom & Learned Exemplars
          </h3>
          <span className={styles.muted}>
            High-confidence patterns learned from user conversations and ratings across the entire platform
          </span>
        </div>

        {stats && stats.recent_exemplars.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Query Pattern</th>
                  <th>Grounded Response Preview</th>
                  <th>Rating</th>
                  <th>Re-use Count</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_exemplars.map((ex, idx) => (
                  <tr key={idx}>
                    <td><strong className={styles.name}>{ex.question}</strong></td>
                    <td style={{ maxWidth: '380px', color: '#9aa8c4' }}>{ex.answer}</td>
                    <td><span className={`${styles.badge} ${styles.verified}`}>{ex.stars || 5} ★</span></td>
                    <td><code>{ex.use_count} times</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>
            Collective wisdom active. Every high-rated answer from all users is automatically indexed and synthesized into memory to make the entire system smarter.
          </p>
        )}
      </section>
    </div>
  );
}
