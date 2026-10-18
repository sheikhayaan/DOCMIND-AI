import * as Sentry from "@sentry/nextjs";

import { scrubSentryBreadcrumb, scrubSentryEvent } from "./lib/sentry-scrub";

const dsn = process.env.SENTRY_DSN ?? "";

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.05"),
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
