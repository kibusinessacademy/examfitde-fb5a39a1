import { BookOpen, FileText, ClipboardCheck, Shield, Bot, MessageSquare, Brain, Rocket } from 'lucide-react';

export const ALL_PIPELINE_STEPS = [
  { key: 'scaffold_learning_course',  label: 'Lernkurs Scaffold',   icon: BookOpen,       shortLabel: 'Scaffold', flag: 'has_learning_course' },
  { key: 'generate_glossary',         label: 'Glossar',             icon: FileText,       shortLabel: 'Glossar',  flag: 'has_learning_course' },
  { key: 'generate_learning_content', label: 'Lerninhalte',         icon: BookOpen,       shortLabel: 'Inhalt',   flag: 'has_learning_course' },
  { key: 'validate_learning_content', label: 'QG Lerninhalte',      icon: Shield,         shortLabel: 'QG Lern',  flag: 'has_learning_course' },
  { key: 'auto_seed_exam_blueprints', label: 'Exam Blueprints',     icon: ClipboardCheck, shortLabel: 'BP Seed',  flag: 'has_exam_trainer' },
  { key: 'validate_blueprints',       label: 'QG Blueprints',       icon: Shield,         shortLabel: 'QG BP',    flag: 'has_exam_trainer' },
  { key: 'generate_exam_pool',        label: 'Prüfungsfragen',      icon: ClipboardCheck, shortLabel: 'Exam',     flag: 'has_exam_trainer' },
  { key: 'validate_exam_pool',        label: 'QG Exam Pool',        icon: Shield,         shortLabel: 'QG Exam',  flag: 'has_exam_trainer' },
  { key: 'build_ai_tutor_index',      label: 'AI Tutor',            icon: Bot,            shortLabel: 'Tutor',    flag: 'has_ai_tutor' },
  { key: 'validate_tutor_index',      label: 'QG Tutor',            icon: Shield,         shortLabel: 'QG Tut',   flag: 'has_ai_tutor' },
  { key: 'generate_oral_exam',        label: 'Mündliche',           icon: MessageSquare,  shortLabel: 'Oral',     flag: 'has_oral_exam_trainer' },
  { key: 'validate_oral_exam',        label: 'QG Mündliche',        icon: Shield,         shortLabel: 'QG Oral',  flag: 'has_oral_exam_trainer' },
  { key: 'generate_handbook',         label: 'Handbuch',            icon: FileText,       shortLabel: 'Buch',     flag: 'has_handbook' },
  { key: 'validate_handbook',         label: 'QG Handbuch',         icon: Shield,         shortLabel: 'QG Buch',  flag: 'has_handbook' },
  { key: 'run_integrity_check',       label: 'Qualitätsprüfung',    icon: Shield,         shortLabel: 'QA',       flag: null },
  { key: 'quality_council',           label: 'QA Council',          icon: Brain,          shortLabel: 'Council',  flag: null },
  { key: 'auto_publish',              label: 'Veröffentlichen',     icon: Rocket,         shortLabel: 'Pub',      flag: null },
];

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
