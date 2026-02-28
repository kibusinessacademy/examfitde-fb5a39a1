/**
 * Admin Glossar — SSOT für alle deutschen Labels + technische Begriffe
 * 
 * Wird von GlossaryTerm-Tooltips und PageExplainer verwendet,
 * um konsistente Übersetzungen in der gesamten Admin-UI sicherzustellen.
 */

export interface GlossaryEntry {
  /** Deutscher Begriff (angezeigt im UI) */
  de: string;
  /** Technischer englischer Begriff (Tooltip-Klammer) */
  en: string;
  /** Kurzbeschreibung für Tooltip */
  desc: string;
  /** Kategorie für Gruppierung */
  category: 'pipeline' | 'quality' | 'system' | 'product' | 'status';
}

export const ADMIN_GLOSSARY: Record<string, GlossaryEntry> = {
  // Pipeline
  course_package: {
    de: 'Kurs-Paket',
    en: 'Course Package',
    desc: 'Bündelt alle Artefakte eines Kurses: Fragen, Lektionen, Tutor-Index, Handbuch.',
    category: 'pipeline',
  },
  build: {
    de: 'Erstellung',
    en: 'Build',
    desc: 'Automatischer Prozess, der alle Kursinhalte generiert und validiert.',
    category: 'pipeline',
  },
  pipeline: {
    de: 'Ablauf',
    en: 'Pipeline',
    desc: 'Die 17-stufige Sequenz von der Erstellung bis zur Veröffentlichung.',
    category: 'pipeline',
  },
  step: {
    de: 'Schritt',
    en: 'Step',
    desc: 'Ein einzelner Arbeitsschritt in der Pipeline (z.B. "Fragen generieren").',
    category: 'pipeline',
  },
  runner: {
    de: 'Automatik-Worker',
    en: 'Runner',
    desc: 'Hintergrundprozess, der Jobs automatisch abarbeitet.',
    category: 'pipeline',
  },
  job_queue: {
    de: 'Auftragsliste',
    en: 'Job Queue',
    desc: 'Warteschlange aller anstehenden, laufenden und erledigten Aufträge.',
    category: 'pipeline',
  },
  lease: {
    de: 'Bearbeitungsslot',
    en: 'Lease',
    desc: 'Zeitlich begrenzte Reservierung eines Pakets für die Verarbeitung.',
    category: 'pipeline',
  },
  heartbeat: {
    de: 'Lebenszeichen',
    en: 'Heartbeat',
    desc: 'Regelmäßiges Signal, dass ein Worker noch aktiv arbeitet.',
    category: 'pipeline',
  },

  // Quality
  quality_gate: {
    de: 'Qualitätssperre',
    en: 'Quality Gate',
    desc: 'Prüfpunkt, der Inhalte erst nach bestandener Validierung weiterleitet.',
    category: 'quality',
  },
  integrity_check: {
    de: 'Integritätsprüfung',
    en: 'Integrity Check',
    desc: 'Gesamtprüfung aller Artefakte auf Vollständigkeit und Konsistenz.',
    category: 'quality',
  },
  council: {
    de: 'Qualitätsrat',
    en: 'Council',
    desc: 'KI-basierte Bewertungsinstanz, die über Veröffentlichung entscheidet.',
    category: 'quality',
  },
  elite_score: {
    de: 'Elite-Score',
    en: 'Elite Score',
    desc: 'Qualitätskennzahl (0–10) für die Prüfungsrelevanz einer Frage.',
    category: 'quality',
  },
  blueprint: {
    de: 'Fragenvorlage',
    en: 'Blueprint',
    desc: 'Strukturierte Vorlage, aus der Prüfungsfragen generiert werden.',
    category: 'quality',
  },
  enrichment: {
    de: 'Anreicherung',
    en: 'Enrichment',
    desc: 'KI-gestützte Erweiterung von Kompetenzen um Fehlkonzepte und Transferkontexte.',
    category: 'quality',
  },

  // System
  heal: {
    de: 'Automatische Reparatur',
    en: 'Auto-Heal',
    desc: 'System repariert sich selbst bei erkannten Fehlern (z.B. hängende Jobs).',
    category: 'system',
  },
  watchdog: {
    de: 'Systemwächter',
    en: 'Watchdog',
    desc: 'Überwacht die Pipeline und greift bei Problemen automatisch ein.',
    category: 'system',
  },
  cron: {
    de: 'Zeitplan',
    en: 'Cron',
    desc: 'Automatischer Auslöser, der Prozesse in festen Intervallen startet.',
    category: 'system',
  },
  backpressure: {
    de: 'Gegendruck',
    en: 'Backpressure',
    desc: 'Mechanismus zur Drosselung bei Überlastung (zu viele parallele Jobs).',
    category: 'system',
  },

  // Product
  exam_pool: {
    de: 'Fragenpool',
    en: 'Exam Pool',
    desc: 'Sammlung aller generierten und validierten Prüfungsfragen eines Kurses.',
    category: 'product',
  },
  learning_course: {
    de: 'Lernkurs',
    en: 'Learning Course',
    desc: 'Strukturierter Kurs mit Modulen und Lektionen (nur AUSBILDUNG_VOLL).',
    category: 'product',
  },
  minicheck: {
    de: 'Mini-Check',
    en: 'MiniCheck',
    desc: 'Kurze Verständnisabfrage am Ende jeder Lektion.',
    category: 'product',
  },
  handbook: {
    de: 'Prüfungshandbuch',
    en: 'Handbook',
    desc: 'Strategischer Begleiter mit Prüfungstipps und Zusammenfassungen.',
    category: 'product',
  },

  // Status
  building: {
    de: 'Wird erstellt',
    en: 'Building',
    desc: 'Paket durchläuft gerade die Pipeline.',
    category: 'status',
  },
  queued: {
    de: 'Wartet',
    en: 'Queued',
    desc: 'Paket ist bereit und wartet auf einen freien Bearbeitungsslot.',
    category: 'status',
  },
  published: {
    de: 'Veröffentlicht',
    en: 'Published',
    desc: 'Paket ist live und für Lernende sichtbar.',
    category: 'status',
  },
  failed: {
    de: 'Fehlgeschlagen',
    en: 'Failed',
    desc: 'Ein Fehler ist aufgetreten. Prüfe die Logs und versuche es erneut.',
    category: 'status',
  },
  blocked: {
    de: 'Blockiert',
    en: 'Blocked',
    desc: 'Paket kann nicht weitermachen — eine Voraussetzung fehlt.',
    category: 'status',
  },
  processing: {
    de: 'In Bearbeitung',
    en: 'Processing',
    desc: 'Ein Worker arbeitet gerade an diesem Auftrag.',
    category: 'status',
  },
  pending: {
    de: 'Ausstehend',
    en: 'Pending',
    desc: 'Auftrag ist bereit zur Bearbeitung, wartet auf Zuweisung.',
    category: 'status',
  },
  done: {
    de: 'Erledigt',
    en: 'Done',
    desc: 'Schritt wurde erfolgreich abgeschlossen.',
    category: 'status',
  },
  cancelled: {
    de: 'Abgebrochen',
    en: 'Cancelled',
    desc: 'Auftrag wurde manuell oder automatisch abgebrochen.',
    category: 'status',
  },
};

/** Lookup helper — returns German label with English fallback */
export function glossaryLabel(key: string): string {
  return ADMIN_GLOSSARY[key]?.de ?? key;
}

/** Lookup helper — returns "Deutsch (English)" format */
export function glossaryFull(key: string): string {
  const entry = ADMIN_GLOSSARY[key];
  if (!entry) return key;
  return `${entry.de} (${entry.en})`;
}
