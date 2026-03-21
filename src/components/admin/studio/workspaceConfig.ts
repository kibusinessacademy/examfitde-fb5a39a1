/**
 * workspaceConfig.ts — Workspace-specific configuration
 *
 * Pipeline step definitions come from pipeline-ui-registry.ts (SSOT).
 * This file only adds workspace-specific concerns (error hints, diagnostics).
 */

export { ALL_PIPELINE_STEPS_UI as ALL_PIPELINE_STEPS, getActivePipelineStepsUI } from '@/lib/pipeline-ui-registry';

export const ERROR_HINTS: Record<string, { cause: string; fix: string }> = {
  INVALID_COMPETENCY_REF: { cause: 'Kompetenz-ID existiert nicht im Curriculum', fix: 'Lessons neu generieren' },
  MISSING_COURSE_ID: { cause: 'Kurs-ID wurde nicht korrekt übergeben', fix: 'Build erneut starten' },
  INTEGRITY_ERROR: { cause: 'Soll-Ist-Abgleich fehlgeschlagen', fix: 'Integrity Check erneut ausführen' },
  DUPLICATE_LESSON: { cause: 'Doppelte Lektion erkannt', fix: 'Duplikate bereinigen lassen' },
  LLM_TIMEOUT: { cause: 'KI-Antwort Timeout', fix: 'Step erneut versuchen' },
  MISSING_API_KEY: { cause: 'API-Key nicht konfiguriert', fix: 'API-Keys in den Einstellungen prüfen' },
  PREREQ_NOT_DONE: { cause: 'Vorheriger Schritt noch nicht abgeschlossen', fix: 'Wird automatisch erneut versucht (15s)' },
  GENERATION_LOCKED: { cause: 'Generierung läuft bereits', fix: 'Warten oder Lock aufheben' },
};

export function diagnoseError(errorMessage: string | null): { cause: string; fix: string } | null {
  if (!errorMessage) return null;
  const upper = errorMessage.toUpperCase();
  for (const [key, hint] of Object.entries(ERROR_HINTS)) {
    if (upper.includes(key) || upper.includes(key.replace(/_/g, ' '))) return hint;
  }
  if (upper.includes('TIMEOUT') || upper.includes('TIMED OUT')) return ERROR_HINTS.LLM_TIMEOUT;
  if (upper.includes('API_KEY') || upper.includes('API KEY')) return ERROR_HINTS.MISSING_API_KEY;
  if (upper.includes('DUPLICATE') || upper.includes('UNIQUE')) return ERROR_HINTS.DUPLICATE_LESSON;
  return null;
}
