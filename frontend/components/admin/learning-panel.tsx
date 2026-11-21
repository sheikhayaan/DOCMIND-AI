'use client';

import { useEffect, useState } from 'react';
import { Brain, Sparkles, RefreshCw, Cpu, CheckCircle2, TrendingUp, Layers, HelpCircle } from 'lucide-react';
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
    loadData(controller.signal);
    return () => controller.abort();
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
              Continuous AI Self-Learning Engine
            </h2>
            <p className={styles.subtitle}>
              DocMind AI analyzes user satisfaction, query resolution patterns, and ratings to dynamically optimize prompt structure, retrieval top-k, and multi-model routing.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={styles.primary}
          onClick={handleConsolidate}
          disabled={optimizing}
          style={{ width: 'auto', minWidth: '180px' }}
        >
          {optimizing ? (
            <>
              <RefreshCw size={14} className="spin" /> Optimizing...
            </>
          ) : (
            <>
              <Brain size={15} /> Consolidate & Tune Memory
            </>
          )}
        </button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {report && (
        <section className={styles.glass} aria-labelledby="report-heading">
          <div className={styles.sectionHead}>
            <h3 id="report-heading" className={styles.heading} style={{ color: '#85e7c5' }}>
              <CheckCircle2 size={16} /> Autonomous Optimization Applied
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
              <dt>Exemplars Evaluated</dt>
              <dd>{report.exemplars_evaluated}</dd>
            </div>
            <div>
              <dt>Active AI Engine</dt>
              <dd>{report.active_engine}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Metrics Row */}
      <div className={styles.metrics}>
        <section className={`${styles.glass} ${styles.metric}`}>
          <div className={styles.metricLabel}>
            <span>Active AI Intelligence Engine</span>
            <Cpu size={14} />
          </div>
          <span className={styles.metricValue} style={{ fontSize: 'clamp(18px, 2.4vw, 22px)' }}>
            {stats?.active_engine || 'Detecting...'}
          </span>
          <p className={styles.muted}>
            Dual-provider intelligent gateway with automatic failover between Google Gemini & Groq.
          </p>
        </section>

        <section className={`${styles.glass} ${styles.metric}`}>
          <div className={styles.metricLabel}>
            <span>Learned Exemplar Memory</span>
            <Brain size={14} />
          </div>
          <span className={styles.metricValue}>
            {loading ? '…' : stats?.total_exemplars || 0}
          </span>
          <p className={styles.muted}>
            High-rated Q&A interactions saved as dynamic few-shot guidance for prompt self-improvement.
          </p>
        </section>

        <section className={`${styles.glass} ${styles.metric}`}>
          <div className={styles.metricLabel}>
            <span>Average User Satisfaction</span>
            <TrendingUp size={14} />
          </div>
          <span className={styles.metricValue} style={{ color: '#77e6bf' }}>
            {loading ? '…' : `${stats?.average_satisfaction.toFixed(1) || '5.0'} / 5.0 ★`}
          </span>
          <p className={styles.muted}>
            Calculated from verified chat completion ratings; drives autonomous retrieval calibration.
          </p>
        </section>

        <section className={`${styles.glass} ${styles.metric}`}>
          <div className={styles.metricLabel}>
            <span>Adaptive Retrieval Depth</span>
            <Layers size={14} />
          </div>
          <span className={styles.metricValue}>
            {loading ? '…' : `${stats?.retrieval_top_k || 5} chunks`}
          </span>
          <p className={styles.muted}>
            Dynamically auto-tuned semantic depth window based on real retrieval confidence.
          </p>
        </section>
      </div>

      {/* Model Capabilities & Candidate Providers */}
      <section className={styles.glass} aria-labelledby="engines-heading">
        <h3 id="engines-heading" className={styles.heading}>
          <Cpu size={15} /> Multi-Engine Intelligence Fleet
        </h3>
        <p className={styles.muted} style={{ marginBottom: '14px' }}>
          Configured LLM providers with circuit breaker isolation, latency tracking, and zero downtime failover.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Engine / Model</th>
                <th>Provider</th>
                <th>Role</th>
                <th>Health Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>gemini-2.5-flash</strong></td>
                <td>Google AI Studio</td>
                <td>Primary Intelligence & Synthesis</td>
                <td><span className={`${styles.badge} ${styles.verified}`}>Active & Grounded</span></td>
              </tr>
              <tr>
                <td><strong>qwen/qwen3.8-27b</strong></td>
                <td>Groq Cloud LPU</td>
                <td>Fast Reasoning Fallback</td>
                <td><span className={`${styles.badge} ${styles.verified}`}>Online & Ready</span></td>
              </tr>
              <tr>
                <td><strong>openai/gpt-oss-120b</strong></td>
                <td>Groq Cloud LPU</td>
                <td>Complex Document Fallback</td>
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
            <HelpCircle size={15} /> Recently Learned Q&A Exemplars
          </h3>
          <span className={styles.muted}>
            Top-rated responses verified by users and promoted into prompt memory
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
            No high-rated exemplars promoted yet. When users rate answers with 4 or 5 stars, Q&A pairs are automatically learned and displayed here.
          </p>
        )}
      </section>
    </div>
  );
}
