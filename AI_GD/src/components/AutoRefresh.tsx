"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches the page's server data every few seconds until it is removed (used while scores are being prepared). */
export function AutoRefresh({ everyMs = 3000, maxTimes = 40 }: { everyMs?: number; maxTimes?: number }) {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= maxTimes) window.clearInterval(timer);
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs, maxTimes]);
  return null;
}
