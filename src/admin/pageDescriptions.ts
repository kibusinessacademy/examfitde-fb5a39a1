/**
 * Page Descriptions — SSOT für Seitenzweck + Aktionen pro Admin-Seite
 * 
 * Wird von PageExplainer-Bannern auf jeder Admin-Seite genutzt,
 * um sofort zu erklären, was man hier tun kann.
 *
 * NUR V2-Routen: command, studio, queue
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
  '/admin/queue': {
    title: 'Queue — Job-Management',
    description: 'Alle aktiven und abgeschlossenen Jobs. Retry, Priorisierung und Fehleranalyse.',
    actions: [
      'Aktive Jobs und deren Status prüfen',
      'Fehlgeschlagene Jobs erneut starten',
      'Job-Prioritäten anpassen',
      'Batch-Operationen für mehrere Jobs',
    ],
  },
};

/** Get description for a route, with fallback */
export function getPageDescription(path: string): PageDescription | null {
  if (PAGE_DESCRIPTIONS[path]) return PAGE_DESCRIPTIONS[path];
  const parent = path.replace(/\/[^/]+$/, '');
  if (PAGE_DESCRIPTIONS[parent]) return PAGE_DESCRIPTIONS[parent];
  return null;
}
