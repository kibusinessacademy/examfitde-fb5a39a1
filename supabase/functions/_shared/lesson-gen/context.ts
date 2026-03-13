/**
 * lesson-gen/context.ts — Transform loaded records into model-ready context blocks.
 * No DB calls. No prompt assembly. Pure data shaping.
 */

import {
  mapToDifficultyLevel,
  loadMasteryContext,
  adjustDifficultyByMastery,
  getRequiredDepth,
  buildMasteryFeedbackSuffix,
} from "../prompt-kit.ts";
import type { DifficultyLevel } from "../prompt-kit.ts";
import type { LessonData, LessonContext } from "./types.ts";

/**
 * Build all context blocks needed for prompt assembly.
 */
export async function buildLessonGenerationContext(
  sb: any,
  data: LessonData,
  curriculumId: string,
): Promise<LessonContext> {
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

  // Adaptive difficulty
  const baseDifficultyLevel: DifficultyLevel = mapToDifficultyLevel(lfData?.difficulty_tier);
  let masteryCtx = null;
  try {
    masteryCtx = await loadMasteryContext(sb, curriculumId, lfId || null);
  } catch { /* proceed without mastery */ }

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
