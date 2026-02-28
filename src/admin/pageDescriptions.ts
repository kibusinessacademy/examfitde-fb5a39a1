/**
 * Page Descriptions — SSOT für Seitenzweck + Aktionen pro Admin-Seite
 * 
 * Wird von PageExplainer-Bannern auf jeder Admin-Seite genutzt,
 * um sofort zu erklären, was man hier tun kann.
 */

export interface PageDescription {
  title: string;
  description: string;
  actions: string[];
  tips?: string[];
}

export const PAGE_DESCRIPTIONS: Record<string, PageDescription> = {
  '/admin/command': {
    title: 'Leitstelle — Produktionssteuerung',
    description: 'Dein Cockpit: Hier siehst du den gesamten Systemzustand auf einen Blick — aktive Builds, Kosten, Qualität und Alarme.',
    actions: [
      'Aktive Builds und deren Fortschritt prüfen',
      'Tageskosten und Budget überwachen',
      'Fehlgeschlagene Jobs erkennen und neu starten',
      'Quick Actions für häufige Aufgaben nutzen',
    ],
    tips: [
      'Die Ampel oben zeigt den System-Gesundheitszustand: Grün = alles läuft, Gelb = Warnungen, Rot = Eingriff nötig.',
    ],
  },
  '/admin/studio': {
    title: 'Kurse erstellen & steuern',
    description: 'Hier findest du alle Kurs-Pakete. Du kannst die Erstellung starten, den Fortschritt prüfen und veröffentlichen.',
    actions: [
      'Kurs auswählen → „Arbeitsbereich öffnen"',
      '„Fehlerhafte Kurse" filtern → reparieren → erneut prüfen',
      '„Veröffentlicht" filtern → Export prüfen',
      'Neues Kurs-Paket anlegen',
    ],
    tips: [
      'Bevor du einen Build startest, prüfe ob das Curriculum zu 100% angereichert ist (Enrichment v2).',
      'Ein Re-run von Schritten kann KI-Kosten verursachen.',
    ],
  },
  '/admin/quality': {
    title: 'Qualität prüfen & sicherstellen',
    description: 'Hier prüfst du die Qualität aller Kurspakete, siehst Elite-Metriken und stellst Compliance sicher.',
    actions: [
      'Elite-Matrix: Qualitäts-Übersicht pro Beruf',
      'Review Inbox: Manuelle Prüfung ausstehender Inhalte',
      'AZAV/ISO Compliance-Checklisten',
      'Lernfeld-Abdeckung pro Kurs prüfen',
    ],
  },
  '/admin/ops': {
    title: 'System überwachen & steuern',
    description: 'Systemstatus, Job-Queue, Pipeline-Live-Ansicht und AI Worker-Management.',
    actions: [
      'Ampel & Alerts: Systemgesundheit auf einen Blick',
      'Queue: Alle Jobs mit Status, Fehler und Retry-Optionen',
      'Pipeline Live: Echtzeit-Fortschritt aktiver Builds',
      'AI Workers: Kosten, Rate-Limits, Concurrency steuern',
    ],
    tips: [
      'Bei gehäuften Fehlern prüfe zuerst die Budget-Limits unter Finanzen.',
    ],
  },
  '/admin/content': {
    title: 'Content & SEO verwalten',
    description: 'Seiten, Blog-Beiträge, Assets und SEO-Einstellungen zentral steuern.',
    actions: [
      'Seiten erstellen und bearbeiten',
      'Blog-Beiträge verwalten',
      'Assets und Medien hochladen',
      'SEO-Metriken prüfen und Redirects setzen',
    ],
  },
  '/admin/business': {
    title: 'Finanzen & Lizenzen',
    description: 'Umsatz, KI-Kosten, Lizenz-Verwaltung und Steuer-Exporte.',
    actions: [
      'Umsatz und Kosten im Überblick',
      'Lizenzen verwalten und zuweisen',
      'Steuer-Export für Buchhaltung erzeugen',
    ],
  },
  '/admin/handbook': {
    title: 'System-Handbuch',
    description: 'Vollständige Dokumentation: Wie funktionieren Workflows, was bedeuten Statuswerte, wie löse ich Probleme?',
    actions: [
      'Workflow-Dokumentation lesen',
      'Fehlerbehebung nachschlagen',
      'Glossar: Technische Begriffe verstehen',
      'Als PDF/Text exportieren',
    ],
  },
};

/** Get description for a route, with fallback */
export function getPageDescription(path: string): PageDescription | null {
  // Exact match
  if (PAGE_DESCRIPTIONS[path]) return PAGE_DESCRIPTIONS[path];
  // Try parent path
  const parent = path.replace(/\/[^/]+$/, '');
  if (PAGE_DESCRIPTIONS[parent]) return PAGE_DESCRIPTIONS[parent];
  return null;
}
