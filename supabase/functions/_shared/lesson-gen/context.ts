/**
 * lesson-gen/context.ts — Transform loaded records into model-ready context blocks.
 * No DB calls. No prompt assembly. Pure data shaping.
 * OPT-1: Mastery context is now pre-loaded in loaders.ts (no async DB call here).
 */

import {
  mapToDifficultyLevel,
  adjustDifficultyByMastery,
  getRequiredDepth,
  buildMasteryFeedbackSuffix,
} from "../prompt-kit.ts";
import type { DifficultyLevel } from "../prompt-kit.ts";
import type { LessonData, LessonContext } from "./types.ts";

/**
 * Build all context blocks needed for prompt assembly.
 * Now synchronous-style since mastery is pre-loaded in data.masteryCtx.
 */
export function buildLessonGenerationContext(
  data: LessonData,
): LessonContext {
  const { lesson, lfData, lfId } = data;

  // LF context string
  const lfContext = lfData ? [
    `Lernfeld: ${lfData.code} – ${lfData.title}`,
    `Prüfungsgewichtung: ${lfData.weight_percent}%`,
    lfData.exam_part ? `Prüfungsteil: ${lfData.exam_part}` : "",
    `Schwierigkeitsstufe: ${lfData.difficulty_tier}`,
    Array.isArray(lfData.ihk_focus_areas) && lfData.ihk_focus_areas.length > 0
      ? `IHK-Schwerpunkte: ${lfData.ihk_focus_areas.join(", ")}`
      : "",
  ].filter(Boolean).join("\n") : "";

  // Adaptive difficulty — mastery already loaded
  const baseDifficultyLevel: DifficultyLevel = mapToDifficultyLevel(lfData?.difficulty_tier);
  const masteryCtx = data.masteryCtx || null;

  const difficultyLevel = adjustDifficultyByMastery(baseDifficultyLevel, masteryCtx);
  const adaptiveReq = getRequiredDepth(difficultyLevel);
  const masteryInjection = buildMasteryFeedbackSuffix(masteryCtx);

  const moduleName = (lesson as any).modules?.title || "";
  const contextBlock = [
    `Beruf: ${data.professionName}`,
    `Modul: ${moduleName}`,
    `Lektion: ${lesson.title}`,
    lfContext,
    `\n${adaptiveReq.promptSuffix}`,
    masteryInjection,
  ].filter(Boolean).join("\n");

  return {
    lfContext,
    contextBlock,
    difficultyLevel,
    adaptiveReq,
    masteryInjection,
    masteryCtx,
  };
}
