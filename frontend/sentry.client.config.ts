import * as Sentry from "@sentry/nextjs";

import { scrubSentryBreadcrumb, scrubSentryEvent } from "./lib/sentry-scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.05"),
  dataCollection: {
    userInfo: false,
    cookies: false,
    urlQueryParams: false,
    httpBodies: [],
    databaseQueryData: false,
    queues: false,
    genAI: { inputs: false, outputs: false },
  },
  beforeSend: scrubSentryEvent,
  beforeBreadcrumb: scrubSentryBreadcrumb,
});
