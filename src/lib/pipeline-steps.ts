/**
 * SSOT Pipeline Step Registry
 * 
 * This is the SINGLE SOURCE OF TRUTH for all pipeline step definitions.
 * All UI components, tests, and references MUST import from here.
 * Backend edge functions maintain their own copies but MUST match this order.
 */

export type PipelineStepKey =
  | "scaffold_learning_course"
  | "generate_glossary"
  | "generate_learning_content"
  | "validate_learning_content"
  | "auto_seed_exam_blueprints"
  | "validate_blueprints"
  | "generate_exam_pool"
  | "validate_exam_pool"
  | "build_ai_tutor_index"
  | "validate_tutor_index"
  | "generate_oral_exam"
  | "validate_oral_exam"
  | "generate_lesson_minichecks"
  | "validate_lesson_minichecks"
  | "generate_handbook"
  | "validate_handbook"
  | "enqueue_handbook_expand"
  | "expand_handbook"
  | "validate_handbook_depth"
  | "elite_harden"
  | "run_integrity_check"
  | "quality_council"
  | "auto_publish";

/**
 * Canonical step order — superset of all tracks.
 * Steps not present in a package's DB rows are simply skipped.
 * 
 * Order rationale:
 * - MiniChecks before Handbook (so Handbook can reference MiniCheck data)
 * - elite_harden after Handbook (hardens ALL generated content)
 * - Matches useTrackConfig / UI expectations
 */
export const FULL_STEP_ORDER: PipelineStepKey[] = [
  "scaffold_learning_course",
  "generate_glossary",
  "generate_learning_content",
  "validate_learning_content",
  "auto_seed_exam_blueprints",
  "validate_blueprints",
  "generate_exam_pool",
  "validate_exam_pool",
  "build_ai_tutor_index",
  "validate_tutor_index",
  "generate_oral_exam",
  "validate_oral_exam",
  "generate_lesson_minichecks",
  "validate_lesson_minichecks",
  "generate_handbook",
  "validate_handbook",
  "enqueue_handbook_expand",
  "expand_handbook",
  "validate_handbook_depth",
  "elite_harden",
  "run_integrity_check",
  "quality_council",
  "auto_publish",
];

/** German UI labels for each step */
export const PIPELINE_STEP_LABELS: Record<PipelineStepKey, string> = {
  scaffold_learning_course: "Lernkurs Scaffold",
  generate_glossary: "Glossar",
  generate_learning_content: "Lerninhalte",
  validate_learning_content: "QG Lerninhalte",
  auto_seed_exam_blueprints: "Exam Blueprints",
  validate_blueprints: "QG Blueprints",
  generate_exam_pool: "Prüfungsfragen",
  validate_exam_pool: "QG Exam Pool",
  build_ai_tutor_index: "KI-Tutor Index",
  validate_tutor_index: "QG Tutor",
  generate_oral_exam: "Mündliche Prüfung",
  validate_oral_exam: "QG Mündliche",
  generate_lesson_minichecks: "MiniChecks",
  validate_lesson_minichecks: "QG MiniChecks",
  generate_handbook: "Handbuch (Basis)",
  validate_handbook: "QG Handbuch",
  enqueue_handbook_expand: "Handbuch Expand Queue",
  expand_handbook: "Handbuch Vertiefung",
  validate_handbook_depth: "QG Handbuch Tiefe",
  elite_harden: "Elite Harden",
  run_integrity_check: "Integritätsprüfung",
  quality_council: "QA Council",
  auto_publish: "Veröffentlichen",
};

/** Short labels for compact UI (status bars, step bars) */
export const PIPELINE_STEP_SHORT_LABELS: Record<PipelineStepKey, string> = {
  scaffold_learning_course: "Scaffold",
  generate_glossary: "Glossar",
  generate_learning_content: "Lerninhalte",
  validate_learning_content: "QG Lernen",
  auto_seed_exam_blueprints: "Blueprints",
  validate_blueprints: "QG BP",
  generate_exam_pool: "Prüfungen",
  validate_exam_pool: "QG Fragen",
  build_ai_tutor_index: "Tutor",
  validate_tutor_index: "QG Tutor",
  generate_oral_exam: "Mündlich",
  validate_oral_exam: "QG Mündl.",
  generate_lesson_minichecks: "MiniChecks",
  validate_lesson_minichecks: "QG MC",
  generate_handbook: "HB Basis",
  validate_handbook: "QG HB",
  enqueue_handbook_expand: "HB Expand Q",
  expand_handbook: "HB Tiefe",
  validate_handbook_depth: "QG HB Tiefe",
  elite_harden: "Harden",
  run_integrity_check: "Integrität",
  quality_council: "Council",
  auto_publish: "Publish",
};

/** Emoji for pipeline monitor */
export const PIPELINE_STEP_EMOJI: Record<PipelineStepKey, string> = {
  scaffold_learning_course: "📚",
  generate_glossary: "📖",
  generate_learning_content: "✏️",
  validate_learning_content: "✅",
  auto_seed_exam_blueprints: "🗺️",
  validate_blueprints: "✅",
  generate_exam_pool: "❓",
  validate_exam_pool: "✅",
  build_ai_tutor_index: "🤖",
  validate_tutor_index: "✅",
  generate_oral_exam: "🎤",
  validate_oral_exam: "✅",
  generate_lesson_minichecks: "📝",
  validate_lesson_minichecks: "✅",
  generate_handbook: "📖",
  validate_handbook: "✅",
  enqueue_handbook_expand: "📤",
  expand_handbook: "🔬",
  validate_handbook_depth: "✅",
  elite_harden: "🛡️",
  run_integrity_check: "🔍",
  quality_council: "🛡️",
  auto_publish: "🚀",
};

/** Package-level status config */
export const PACKAGE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "Entwurf", color: "bg-muted text-muted-foreground" },
  queued: { label: "Warteschlange", color: "bg-blue-500/10 text-blue-600" },
  building: { label: "Wird gebaut", color: "bg-primary/10 text-primary" },
  blocked: { label: "Blockiert", color: "bg-yellow-500/10 text-yellow-700" },
  quality_gate_failed: { label: "QA blockiert", color: "bg-destructive/10 text-destructive" },
  publish_failed: { label: "Publish fehlgeschlagen", color: "bg-orange-500/10 text-orange-600" },
  frozen: { label: "Eingefroren", color: "bg-yellow-500/10 text-yellow-700" },
  failed: { label: "Fehlgeschlagen", color: "bg-destructive/10 text-destructive" },
  done: { label: "Fertig", color: "bg-emerald-500/10 text-emerald-600" },
  published: { label: "Veröffentlicht", color: "bg-emerald-500/10 text-emerald-600" },
  archived: { label: "Archiviert", color: "bg-muted text-muted-foreground" },
};

/** Type guard */
export function isPipelineStepKey(x: string): x is PipelineStepKey {
  return (FULL_STEP_ORDER as string[]).includes(x);
}

/** Get label for any step key, with fallback */
export function getStepLabel(key: string): string {
  return isPipelineStepKey(key) ? PIPELINE_STEP_LABELS[key] : key;
}

/** Get short label for any step key, with fallback */
export function getStepShortLabel(key: string): string {
  return isPipelineStepKey(key) ? PIPELINE_STEP_SHORT_LABELS[key] : key;
}

/**
 * Known non-SSOT legacy keys that may appear in step_status_json.
 * These are NEVER counted for progress or displayed as current step.
 */
const LEGACY_STEP_KEYS = new Set([
  'generate_curriculum', 'generate_lessons', 'generate_modules',
  'generate_lesson_content', 'generate_handbook_content', 'validate_handbook_content',
  'generate_oral_exam_content', 'validate_oral_exam_content',
  'validate_exam_questions', 'generate_exam_questions',
  'setup_course_package', 'setup_storefront', 'council_review',
  'launch_marketing', 'post_launch_monitor',
  'fanout_learning_content', 'finalize_learning_content',
]);

/**
 * Fanout patterns: parent step → prerequisite fanout step.
 * When the parent is 'queued' but the fanout step is 'done',
 * the parent is effectively running (child jobs are active).
 */
const FANOUT_PATTERNS: Record<string, string> = {
  generate_learning_content: 'fanout_learning_content',
};

/**
 * Derive real progress & current step from step_status_json (SSOT).
 * Never trust course_packages.build_progress / current_step — they can be stale.
 * 
 * - Strips legacy keys from calculation
 * - Detects fanout patterns (parent queued + fanout done = effectively running)
 */
export function deriveStepProgress(stepStatuses: Record<string, string> | null | undefined) {
  const statuses = stepStatuses || {};
  // Only count SSOT steps, never legacy keys
  const packageSteps = FULL_STEP_ORDER.filter(k => k in statuses && !LEGACY_STEP_KEYS.has(k));
  const total = packageSteps.length || 1;
  const doneCount = packageSteps.filter(k => statuses[k] === 'done' || statuses[k] === 'skipped').length;
  const progress = Math.round((doneCount / total) * 100);

  // Check for fanout-active pattern: parent step is 'queued' but fanout prerequisite is 'done'
  const fanoutActiveStep = packageSteps.find(k => {
    if (statuses[k] !== 'queued') return false;
    const fanoutKey = FANOUT_PATTERNS[k];
    return fanoutKey && statuses[fanoutKey] === 'done';
  });

  // Current step = running/enqueued, fanout-active, or first non-done step
  const activeStep = packageSteps.find(k => statuses[k] === 'running' || statuses[k] === 'enqueued');
  const effectiveActive = activeStep || fanoutActiveStep;
  const nextStep = effectiveActive || packageSteps.find(k => statuses[k] !== 'done' && statuses[k] !== 'skipped');
  
  const isFanoutActive = !activeStep && !!fanoutActiveStep;
  const currentLabel = nextStep
    ? (isPipelineStepKey(nextStep)
      ? PIPELINE_STEP_SHORT_LABELS[nextStep] + (isFanoutActive ? ' ⚡' : '')
      : nextStep)
    : (doneCount >= total ? 'Fertig' : '—');
  const isActive = !!effectiveActive;

  return { progress, currentLabel, isActive, doneCount, total, activeStepKey: effectiveActive || null, isFanoutActive };
}
