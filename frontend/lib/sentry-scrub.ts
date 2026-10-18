import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "email",
  "filename",
  "file_name",
  "password",
  "question",
  "answer",
  "token",
  "access_token",
  "recaptcha_token",
  "ip_address",
]);

function scrubUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, "https://docmind.local");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl.split("?")[0];
  }
}

/** Removes document names, query parameters, and PII before an event leaves the browser. */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request?.url) event.request.url = scrubUrl(event.request.url);
  if (event.request?.query_string) event.request.query_string = "[redacted]";
  if (event.request?.cookies) event.request.cookies = {};
  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        Reflect.set(event.extra, key, "[redacted]");
      }
    }
  }
  if (event.tags) {
    for (const key of Object.keys(event.tags)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        Reflect.set(event.tags, key, "[redacted]");
      }
    }
  }
  return event;
}

/** Masks document identifiers in breadcrumb URLs and data. */
export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.data && typeof breadcrumb.data.url === "string") {
    breadcrumb.data.url = scrubUrl(breadcrumb.data.url);
  }
  return breadcrumb;
}
