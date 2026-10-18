// Loads Google reCAPTCHA v3 once and returns short-lived action tokens.
const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? "";
const SCRIPT_ID = "docmind-recaptcha-v3";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

export type RecaptchaAction = "upload" | "query" | "general";

function loadScript(): Promise<void> {
  if (typeof window === "undefined" || !SITE_KEY) return Promise.resolve();
  if (window.grecaptcha) return Promise.resolve();
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => resolve(), { once: true });
    });
  }
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(SITE_KEY)}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

/** Returns a reCAPTCHA v3 token for one action, or null when the key is unset. */
export async function getRecaptchaToken(action: RecaptchaAction): Promise<string | null> {
  if (!SITE_KEY) return null;
  try {
    await loadScript();
    if (!window.grecaptcha) return null;
    return await new Promise<string | null>((resolve) => {
      window.grecaptcha?.ready(() => {
        window.grecaptcha
          ?.execute(SITE_KEY, { action })
          .then((token) => resolve(token))
          .catch(() => resolve(null));
      });
    });
  } catch {
    return null;
  }
}
