/**
 * pipeline-ui-registry.ts — SSOT for Pipeline Step UI Metadata
 *
 * Merges pipeline step definitions from `pipeline-steps.ts` (canonical order)
 * with UI-specific metadata (icons, labels, feature-flag gating).
 *
 * Both `workspaceConfig.ts` and `useTrackConfig.ts` MUST consume this file
 * to avoid divergent pipeline definitions.
 */

import {
  BookOpen, FileText, ClipboardCheck, Shield, Bot,
  MessageSquare, Brain, Rocket, CheckSquare, Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FULL_STEP_ORDER, type PipelineStepKey } from "./pipeline-steps";

export interface PipelineStepUI {
  key: PipelineStepKey;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  /** Feature flag key — if null, step is always shown */
  flag: string | null;
}

/**
 * UI metadata per step. Order follows FULL_STEP_ORDER from pipeline-steps.ts.
 */
const STEP_UI_MAP: Record<string, Omit<PipelineStepUI, "key">> = {
  scaffold_learning_course:  { label: "Lernkurs Scaffold",  shortLabel: "Scaffold", icon: BookOpen,       flag: "has_learning_course" },
  generate_glossary:         { label: "Glossar",             shortLabel: "Glossar",  icon: FileText,       flag: "has_learning_course" },
  generate_learning_content: { label: "Lerninhalte",         shortLabel: "Inhalt",   icon: BookOpen,       flag: "has_learning_course" },
  validate_learning_content: { label: "QG Lerninhalte",      shortLabel: "QG Lern",  icon: Shield,         flag: "has_learning_course" },
  auto_seed_exam_blueprints: { label: "Exam Blueprints",     shortLabel: "BP Seed",  icon: ClipboardCheck, flag: "has_exam_trainer" },
  validate_blueprints:       { label: "QG Blueprints",       shortLabel: "QG BP",    icon: Shield,         flag: "has_exam_trainer" },
  generate_exam_pool:        { label: "Prüfungsfragen",      shortLabel: "Exam",     icon: ClipboardCheck, flag: "has_exam_trainer" },
  validate_exam_pool:        { label: "QG Exam Pool",        shortLabel: "QG Exam",  icon: Shield,         flag: "has_exam_trainer" },
  build_ai_tutor_index:      { label: "AI Tutor",            shortLabel: "Tutor",    icon: Bot,            flag: "has_ai_tutor" },
  validate_tutor_index:      { label: "QG Tutor",            shortLabel: "QG Tut",   icon: Shield,         flag: "has_ai_tutor" },
  generate_oral_exam:        { label: "Mündliche",           shortLabel: "Oral",     icon: MessageSquare,  flag: "has_oral_exam_trainer" },
  validate_oral_exam:        { label: "QG Mündliche",        shortLabel: "QG Oral",  icon: Shield,         flag: "has_oral_exam_trainer" },
  generate_lesson_minichecks:{ label: "MiniChecks",          shortLabel: "Mini",     icon: CheckSquare,    flag: "has_minichecks" },
  validate_lesson_minichecks:{ label: "QG MiniChecks",       shortLabel: "QG Mini",  icon: Shield,         flag: "has_minichecks" },
  generate_handbook:         { label: "Handbuch",            shortLabel: "Buch",     icon: FileText,       flag: "has_handbook" },
  validate_handbook:         { label: "QG Handbuch",         shortLabel: "QG Buch",  icon: Shield,         flag: "has_handbook" },
  enqueue_handbook_expand:   { label: "Handbook Expand Queue", shortLabel: "HB Queue", icon: Layers,      flag: "has_handbook" },
  expand_handbook:           { label: "Handbook Expand",     shortLabel: "HB Exp",   icon: FileText,       flag: "has_handbook" },
  validate_handbook_depth:   { label: "QG Handbook Depth",   shortLabel: "QG HB",    icon: Shield,         flag: "has_handbook" },
  elite_harden:              { label: "Elite Hardening",     shortLabel: "Elite",    icon: Shield,         flag: null },
  run_integrity_check:       { label: "Qualitätsprüfung",    shortLabel: "QA",       icon: Shield,         flag: null },
  quality_council:           { label: "QA Council",          shortLabel: "Council",  icon: Brain,          flag: null },
  auto_publish:              { label: "Veröffentlichen",     shortLabel: "Pub",      icon: Rocket,         flag: null },
};

/**
 * All pipeline steps with UI metadata, in canonical FULL_STEP_ORDER.
 */
export const ALL_PIPELINE_STEPS_UI: PipelineStepUI[] = FULL_STEP_ORDER
  .filter(key => STEP_UI_MAP[key])
  .map(key => ({ key, ...STEP_UI_MAP[key] }));

/**
 * Filter pipeline steps by active feature flags.
 */
export function getActivePipelineStepsUI(
  flags: Record<string, boolean> | null | undefined,
): PipelineStepUI[] {
  if (!flags) return ALL_PIPELINE_STEPS_UI;
  return ALL_PIPELINE_STEPS_UI.filter(
    s => s.flag === null || flags[s.flag] === true,
  );
}
