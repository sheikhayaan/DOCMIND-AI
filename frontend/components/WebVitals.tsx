'use client';

import { useEffect } from 'react';
import { API_URL, ensureAccessToken } from '@/lib/api';

type VitalName = 'CLS' | 'FID' | 'LCP' | 'INP' | 'FCP' | 'TTFB';

interface VitalMetric {
  name: VitalName;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  id: string;
  page: string;
  referrer: string;
  timestamp: number;
  connection?: string;
  device: 'mobile' | 'desktop';
}

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface TimedPerformanceEntry extends PerformanceEntry {
  processingStart?: number;
  responseStart?: number;
}

interface NetworkInformationLike {
  effectiveType?: string;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
}

const THRESHOLDS: Record<VitalName, { good: number; poor: number }> = {
  CLS: { good: 100, poor: 250 },
  FID: { good: 100, poor: 300 },
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

// Classifies a web vital value using Google Core Web Vitals thresholds.
function ratingFor(name: VitalName, value: number): VitalMetric['rating'] {
  const threshold = THRESHOLDS[name];
  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

// Sends one metric sample to the FastAPI monitoring endpoint.
function sendVital(name: VitalName, value: number, delta = value): void {
  const rounded = Math.round(name === 'CLS' ? value * 1000 : value);
  const payload: VitalMetric = {
    name,
    value: rounded,
    rating: ratingFor(name, rounded),
    delta,
    id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    page: window.location.pathname,
    referrer: document.referrer,
    timestamp: Date.now(),
    connection: (navigator as NavigatorWithConnection).connection?.effectiveType,
    device: /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
  };

  ensureAccessToken()
    .then((token) =>
      window.fetch(`${API_URL}/vitals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }),
    )
    .catch(() => undefined);
}

// Observes browser performance entries without adding a runtime dependency.
export default function WebVitals() {
  useEffect(() => {
    const observers: PerformanceObserver[] = [];
    let cumulativeLayoutShift = 0;
    let maxInteractionLatency = 0;

    const observe = (
      type: string,
      handler: (entries: PerformanceObserverEntryList) => void,
      buffered = true,
    ) => {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
      try {
        const observer = new PerformanceObserver(handler);
        observer.observe({ type, buffered });
        observers.push(observer);
      } catch {
        return;
      }
    };

    observe('largest-contentful-paint', (list) => {
      const entries = list.getEntries();
      const latest = entries.at(-1);
      if (latest) sendVital('LCP', latest.startTime);
    });

    observe('paint', (list) => {
      const fcp = list.getEntries().find((entry) => entry.name === 'first-contentful-paint');
      if (fcp) sendVital('FCP', fcp.startTime);
    });

    observe('layout-shift', (list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        if (!entry.hadRecentInput) cumulativeLayoutShift += entry.value;
      }
      sendVital('CLS', cumulativeLayoutShift);
    });

    observe('first-input', (list) => {
      const entry = list.getEntries()[0] as TimedPerformanceEntry | undefined;
      if (entry?.processingStart) sendVital('FID', entry.processingStart - entry.startTime);
    });

    observe('event', (list) => {
      for (const entry of list.getEntries() as TimedPerformanceEntry[]) {
        const latency = (entry.processingStart ?? entry.startTime) - entry.startTime;
        maxInteractionLatency = Math.max(maxInteractionLatency, latency);
      }
      if (maxInteractionLatency > 0) sendVital('INP', maxInteractionLatency);
    });

    const navigation = performance.getEntriesByType('navigation')[0] as
      | TimedPerformanceEntry
      | undefined;
    if (navigation?.responseStart) sendVital('TTFB', navigation.responseStart);

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);

  return null;
}
