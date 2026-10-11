"use client";

import { useEffect } from "react";

/**
 * Fire-and-forget warm-up ping to the API.
 *
 * Mounted in the root layout so it runs on the very first paint, before any
 * page component hydrates. If the Render free-tier container happens to be
 * asleep, this starts the ~30-45s spin-up in the background while the user
 * is still reading the shell, instead of it starting only once they trigger
 * their first real query.
 *
 * Deliberately silent: it renders nothing, never blocks, and swallows every
 * error. A failed warm-up must never surface to the user — AppShell's own
 * health poll is what drives the visible API ONLINE / OFFLINE badge.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  process.env.NEXT_PUBLIC_API_URL ??
  "https://cargox-api.onrender.com";

export function BackendWarmup() {
  useEffect(() => {
    // AbortController so a fast unmount (e.g. StrictMode double-invoke in
    // dev) doesn't leave a dangling request.
    const controller = new AbortController();

    fetch(`${API_BASE}/health`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => {
      /* silent — this is only a warm-up */
    });

    return () => controller.abort();
  }, []);

  return null;
}
