'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isSignedIn } from '@/lib/api';

// Visitors who chose "Continue without an account" are remembered here, so the
// gate does not bounce them straight back to /login on every navigation.
const GUEST_KEY = 'docmind_guest';

// Routes reachable without an account. /login is the gate itself; /admin has its
// own token-based check and must not be shadowed by this one.
const OPEN_ROUTES = ['/login', '/admin'];

export function allowGuestAccess(): void {
  try {
    window.localStorage.setItem(GUEST_KEY, '1');
  } catch {
    // Storage unavailable — the visitor simply sees the gate again next time.
  }
}

// Called on sign-out so the gate applies again instead of silently letting the
// now-anonymous browser back into the app.
export function clearGuestAccess(): void {
  try {
    window.localStorage.removeItem(GUEST_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

function isGuest(): boolean {
  try {
    return window.localStorage.getItem(GUEST_KEY) === '1';
  } catch {
    return false;
  }
}

// Hydration-safe flag: false during the server render and the hydrating client
// pass, then true once the browser can safely read localStorage.
function subscribeToHydration(): () => void {
  return () => {};
}

// Sends first-time visitors to the sign in / sign up page before the app itself.
// Gated routes render nothing until the check has run so the app never flashes
// behind the redirect; open routes are decided from the pathname alone and so
// still render on the server, keeping /login fast and crawlable.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isOpenRoute = OPEN_ROUTES.some((route) => pathname?.startsWith(route));
  const allowed = isOpenRoute || isSignedIn() || isGuest();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);

  useEffect(() => {
    if (hydrated && !isOpenRoute && !allowed) router.replace('/login');
  }, [hydrated, isOpenRoute, allowed, router]);

  if (!isOpenRoute && (!hydrated || !allowed)) return null;
  return <>{children}</>;
}
