/**
 * Lightweight i18n dictionary for the Runbook + Job Live Progress UI.
 * No external dep — keeps bundle small. Locale resolved from
 *   ?lang=de|en  →  localStorage.lov_admin_lang  →  navigator.language
 */
export type Locale = "de" | "en";

const DICT = {
  de: {
    "live.title": "Live-Progress aktive Jobs",
    "live.active": "aktiv",
    "live.ghost": "Ghost",
    "live.staleHb": "stale HB",
    "live.refresh": "Refresh",
    "live.loading": "Lade aktive Jobs…",
    "live.empty": "Keine aktiven Jobs.",
    "live.nextRefresh": "Nächster Refresh",
    "live.pollIntv": "Polling-Intervall",
    "live.warnRepeated": "Mehrere Refresh-Fehler in Folge — bitte Verbindung prüfen.",
    "live.label.loop": "REQUEUE-Loop terminal",
    "live.label.ghost": "Ghost-Finalization",
    "live.label.stale": "Stale Heartbeat",
    "live.label.ok": "Aktiv",
    "live.btn.heal": "Heal",
    "live.btn.terminal": "Terminal",
    "runbook.title": "Runbook · package_run_integrity_check",
    "runbook.subtitle": "Erkennt typische Ursachen und bietet je einen geguardeten Heal-Button.",
    "runbook.pickPkg": "Paket auswählen",
    "runbook.placeholder": "package_id (UUID)",
    "runbook.analyze": "Analysieren",
    "runbook.flags": "Status-Flags",
    "runbook.causes": "Erkannte Ursachen",
    "runbook.noCauses": "Keine bekannten Failure-Patterns für dieses Paket erkannt.",
    "runbook.heal": "Heal ausführen",
    "runbook.lastJob": "Letzter Job + Step",
    "runbook.exportCsv": "Audit CSV",
    "runbook.exportJson": "Audit JSON",
    "runbook.diffPreview": "Was wird sich ändern?",
    "runbook.diffEmpty": "Keine effektive Änderung — Heal wird blockiert.",
    "runbook.diffBlockReason": "Grund",
    "targeted.title": "Targeted Heal · letzte Integrity-Jobs",
    "targeted.healable": "healbar",
    "targeted.selectAll": "Alle healbaren wählen",
    "targeted.clear": "Auswahl leeren",
    "targeted.run": "Heal ausführen",
    "targeted.preview": "Vorschau anzeigen",
    "targeted.previewBlocked": "Heal blockiert: keine effektive Änderung.",
    "targeted.empty": "Keine kürzlichen Integrity-Jobs gefunden.",
    "targeted.attempts": "Versuche",
    "diff.colCurrent": "aktuell",
    "diff.colNext": "nach Heal",
    "diff.stepReset": "Step wird zurückgesetzt",
    "diff.noChange": "keine Änderung",
  },
  en: {
    "live.title": "Live Progress · Active Jobs",
    "live.active": "active",
    "live.ghost": "Ghost",
    "live.staleHb": "stale HB",
    "live.refresh": "Refresh",
    "live.loading": "Loading active jobs…",
    "live.empty": "No active jobs.",
    "live.nextRefresh": "Next refresh",
    "live.pollIntv": "Polling interval",
    "live.warnRepeated": "Multiple refresh failures in a row — please check connectivity.",
    "live.label.loop": "REQUEUE loop terminal",
    "live.label.ghost": "Ghost finalization",
    "live.label.stale": "Stale heartbeat",
    "live.label.ok": "Active",
    "live.btn.heal": "Heal",
    "live.btn.terminal": "Terminal",
    "runbook.title": "Runbook · package_run_integrity_check",
    "runbook.subtitle": "Detects common failure patterns and offers a guarded heal button per cause.",
    "runbook.pickPkg": "Pick package",
    "runbook.placeholder": "package_id (UUID)",
    "runbook.analyze": "Analyze",
    "runbook.flags": "Status flags",
    "runbook.causes": "Detected causes",
    "runbook.noCauses": "No known failure patterns detected for this package.",
    "runbook.heal": "Run heal",
    "runbook.lastJob": "Latest job + step",
    "runbook.exportCsv": "Audit CSV",
    "runbook.exportJson": "Audit JSON",
    "runbook.diffPreview": "What will change?",
    "runbook.diffEmpty": "No effective change — heal is blocked.",
    "runbook.diffBlockReason": "Reason",
    "targeted.title": "Targeted heal · recent integrity jobs",
    "targeted.healable": "healable",
    "targeted.selectAll": "Select all healable",
    "targeted.clear": "Clear selection",
    "targeted.run": "Run heal",
    "targeted.preview": "Show preview",
    "targeted.previewBlocked": "Heal blocked: no effective change.",
    "targeted.empty": "No recent integrity jobs found.",
    "targeted.attempts": "attempts",
    "diff.colCurrent": "current",
    "diff.colNext": "after heal",
    "diff.stepReset": "step will reset",
    "diff.noChange": "no change",
  },
} as const;

type Key = keyof typeof DICT["de"];

export function detectLocale(): Locale {
  if (typeof window === "undefined") return "de";
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("lang");
  if (fromUrl === "de" || fromUrl === "en") return fromUrl;
  const fromStorage = window.localStorage.getItem("lov_admin_lang");
  if (fromStorage === "de" || fromStorage === "en") return fromStorage as Locale;
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "de";
}

export function setLocale(loc: Locale) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("lov_admin_lang", loc);
}

export function t(key: Key, locale: Locale = detectLocale()): string {
  return DICT[locale][key] ?? DICT.de[key] ?? key;
}

import { useEffect, useState } from "react";
export function useLocale() {
  const [loc, setLoc] = useState<Locale>(detectLocale());
  useEffect(() => {
    const handler = () => setLoc(detectLocale());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return {
    locale: loc,
    setLocale: (next: Locale) => {
      setLocale(next);
      setLoc(next);
    },
    t: (k: Key) => t(k, loc),
  };
}
