/**
 * OS Identity — leichter localStorage-Spiegel des aktiven Berufs.
 *
 * Wird vom Hero (Beruf-Auswahl) geschrieben und vom OSCompanionBar +
 * BerufIdentityChip gelesen. Bewusst KEIN globaler Provider — die Auswahl
 * passiert anonym vor Login und muss surface-übergreifend funktionieren.
 *
 * Cross-Tab-Sync via 'storage'-Event.
 */

import { useEffect, useState } from "react";

const KEY = "ef_os_beruf_v1";

export interface OsBerufIdentity {
  slug: string;
  label: string;
  /** Kurzform für CTAs ("Industriekaufmann/-frau" → "Industriekaufmann"). */
  short?: string;
  ts: number;
}

export function readOsBeruf(): OsBerufIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OsBerufIdentity;
    if (!parsed?.slug || !parsed?.label) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeOsBeruf(beruf: Omit<OsBerufIdentity, "ts"> | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!beruf) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, JSON.stringify({ ...beruf, ts: Date.now() }));
    }
    // Notify same tab
    window.dispatchEvent(new CustomEvent("os-beruf-changed"));
  } catch {
    /* quota / private mode */
  }
}

export function useOsBeruf(): OsBerufIdentity | null {
  const [val, setVal] = useState<OsBerufIdentity | null>(() => readOsBeruf());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => setVal(readOsBeruf());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("os-beruf-changed", refresh as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("os-beruf-changed", refresh as EventListener);
    };
  }, []);

  return val;
}
