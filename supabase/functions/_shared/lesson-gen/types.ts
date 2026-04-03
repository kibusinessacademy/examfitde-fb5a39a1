/**
 * lesson-gen/types.ts — Type definitions (dependency-free)
 */

export interface LessonRequest {
  packageId: string;
  courseId: string;
  curriculumId: string;
  certificationId: string | null;
  lessonId: string;
  stepKey: string;
  isMiniCheck: boolean;
  attemptIndex: number;
  jobHash: number;
  jobId: string;
}

export interface LessonData {
  lesson: any;
  lfData: any | null;
  lfId: string | null;
  professionName: string;
  glossaryContext: string;
  /** Pre-loaded mastery context (OPT-1: parallelized with LF/glossary) */
  masteryCtx: any | null;
  /** Program type: "vocational" | "higher_education" — drives prompt profiling */
  programType: "vocational" | "higher_education";
}

export interface LessonContext {
  lfContext: string;
  contextBlock: string;
  difficultyLevel: import("../prompt-kit.ts").DifficultyLevel;
  adaptiveReq: import("../prompt-kit.ts").AdaptiveDepthRequirements;
  masteryInjection: string;
  masteryCtx: import("../prompt-kit.ts").MasteryContext | null;
}

export interface LessonRuntime {
  chain: Array<{ provider: any; model: string }>;
  fullChain: Array<{ provider: any; model: string }>;
  effectiveMaxTokens: number;
  llmTimeoutMs: number;
  remainingPlatformMs: number;
  autopilotAction: string | null;
  maxTokensOverride: number | null;
}

export interface LessonPrompts {
  systemPrompt: string;
  userPrompt: string;
}

export interface LlmResult {
  content: any;
  result: any;
  plainRetry: boolean;
}
