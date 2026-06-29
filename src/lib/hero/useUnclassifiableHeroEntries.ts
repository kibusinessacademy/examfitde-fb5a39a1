import { useEffect, useState } from "react";
import {
  listUnclassifiableHeroEntries,
  type UnclassifiableHeroEntry,
} from "@/lib/hero/unclassifiableLogger";

/**
 * Subscribes to the in-browser hero-phrasing unclassifiable logger.
 *
 * Returns the current list of unclassifiable records detected during this
 * session. Updates live via the `vlo:hero-unclassifiable` custom event that
 * `reportUnclassifiableHeroPhrasing` dispatches.
 *
 * Read-only / observability hook — never mutates anything.
 */
export function useUnclassifiableHeroEntries(): UnclassifiableHeroEntry[] {
  const [entries, setEntries] = useState<UnclassifiableHeroEntry[]>(() =>
    listUnclassifiableHeroEntries(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setEntries(listUnclassifiableHeroEntries());
    window.addEventListener("vlo:hero-unclassifiable", handler as EventListener);
    return () => window.removeEventListener("vlo:hero-unclassifiable", handler as EventListener);
  }, []);

  return entries;
}
