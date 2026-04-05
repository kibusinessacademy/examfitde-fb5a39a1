/**
 * Track-Aware Audit Profiles — SSOT
 *
 * Central profile definitions for all tracks (Ausbildung, Studium,
 * Fortbildung, Meister, Zertifikat). Used by the content-audit-engine
 * to apply track-specific structural, didactic, exam-quality, language,
 * tutor and gate rules.
 */

// ── Track Key ──

export type TrackKey =
  | "AUSBILDUNG_VOLL"
  | "EXAM_FIRST"
  | "EXAM_FIRST_PLUS"
  | "STUDIUM"
  | "FORTBILDUNG"
  | "MEISTER"
  | "ZERTIFIKAT";

// ── Sub-types ──

export type DidacticModel =
  | "five_step"
  | "academic"
  | "practical"
  | "mixed"
  | "exam_only";

export type TutorPersona =
  | "ihk_examiner"
  | "academic_tutor"
  | "practice_coach"
  | "mastercraft_coach"
  | "cert_exam_coach";

export type ArtifactType =
  | "exam_question"
  | "minicheck_question"
  | "lesson"
  | "handbook_chapter"
  | "oral_exam_question"
  | "tutor_response"
  | "seo_article";

export type AuditLayer = "A" | "B" | "C" | "D" | "E";

// ── Profile Shape ──

export type AuditProfile = {
  track: TrackKey;
  label: string;

  structural: {
    requireBlueprintForQuestions: boolean;
    requireBlueprintForLessons: boolean;
    requireCompetency: boolean;
    requireCurriculum: boolean;
    requireLessonToLearningField: boolean;
    requireExamTypeTag: boolean;
    requireDifficulty: boolean;
    requireWeightPercentage: boolean;
    requireMiniCheckForLessons: boolean;
    requireTutorReferenceObject: boolean;
  };

  didactics: {
    model: DidacticModel;
    requireEntryStep: boolean;
    requireExplanationStep: boolean;
    requireApplicationStep: boolean;
    requireRevisionStep: boolean;
    requireMiniCheckStep: boolean;
    minimumDidacticScore: number;
  };

  examQuality: {
    requireOperatorSignal: boolean;
    allowOpenQuestions: boolean;
    enforceDistractorQuality: boolean;
    enforceTypicalErrorDerivation: boolean;
    enforceTransferOrientation: boolean;
    allowPureKnowledgeQuestions: boolean;
    maxKnowledgeQuestionRatio: number;
  };

  language: {
    maxSentenceLength: number;
    maxPassiveRatio: number;
    enableGenericPhraseDetection: boolean;
    enableSpellingChecks: boolean;
    operatorSet: string[];
  };

  tutor: {
    persona: TutorPersona;
    requireModeConsistency: boolean;
    requireLearnerContext: boolean;
    allowGeneralExplanationWithoutSession: boolean;
    requireReferencedCurriculumObject: boolean;
  };

  gates: {
    blockPublishOnRejected: boolean;
    blockPublishOnRewrite: boolean;
    allowReviewToPublish: boolean;
    blockTutorOnRejected: boolean;
    blockExamUsageOnRejected: boolean;
  };
};

// ── Operator Sets ──

const IHK_OPERATORS = [
  "nennen", "beschreiben", "erklären", "beurteilen", "berechnen",
  "planen", "entwickeln", "vergleichen", "begründen",
];

const ACADEMIC_OPERATORS = [
  "analysieren", "diskutieren", "interpretieren", "herleiten",
  "einordnen", "bewerten", "argumentieren", "reflektieren",
];

const PRACTICAL_OPERATORS = [
  "planen", "durchführen", "bewerten", "optimieren",
  "entscheiden", "begründen", "anwenden",
];

const CERT_OPERATORS = [
  "identify", "select", "configure", "compare",
  "troubleshoot", "evaluate",
];

// ── Profile Registry ──

export const AUDIT_PROFILES: Record<TrackKey, AuditProfile> = {
  AUSBILDUNG_VOLL: {
    track: "AUSBILDUNG_VOLL",
    label: "Ausbildung Voll",
    structural: {
      requireBlueprintForQuestions: true,
      requireBlueprintForLessons: true,
      requireCompetency: true,
      requireCurriculum: true,
      requireLessonToLearningField: true,
      requireExamTypeTag: true,
      requireDifficulty: true,
      requireWeightPercentage: true,
      requireMiniCheckForLessons: true,
      requireTutorReferenceObject: true,
    },
    didactics: {
      model: "five_step",
      requireEntryStep: true,
      requireExplanationStep: true,
      requireApplicationStep: true,
      requireRevisionStep: true,
      requireMiniCheckStep: true,
      minimumDidacticScore: 75,
    },
    examQuality: {
      requireOperatorSignal: true,
      allowOpenQuestions: false,
      enforceDistractorQuality: true,
      enforceTypicalErrorDerivation: true,
      enforceTransferOrientation: true,
      allowPureKnowledgeQuestions: true,
      maxKnowledgeQuestionRatio: 0.2,
    },
    language: {
      maxSentenceLength: 36,
      maxPassiveRatio: 0.5,
      enableGenericPhraseDetection: true,
      enableSpellingChecks: true,
      operatorSet: IHK_OPERATORS,
    },
    tutor: {
      persona: "ihk_examiner",
      requireModeConsistency: true,
      requireLearnerContext: true,
      allowGeneralExplanationWithoutSession: false,
      requireReferencedCurriculumObject: true,
    },
    gates: {
      blockPublishOnRejected: true,
      blockPublishOnRewrite: true,
      allowReviewToPublish: false,
      blockTutorOnRejected: true,
      blockExamUsageOnRejected: true,
    },
  },

  EXAM_FIRST: {
    track: "EXAM_FIRST",
    label: "Exam First",
    structural: {
      requireBlueprintForQuestions: true,
      requireBlueprintForLessons: false,
      requireCompetency: true,
      requireCurriculum: true,
      requireLessonToLearningField: false,
      requireExamTypeTag: true,
      requireDifficulty: true,
      requireWeightPercentage: true,
      requireMiniCheckForLessons: false,
      requireTutorReferenceObject: true,
    },
    didactics: {
      model: "exam_only",
      requireEntryStep: false,
      requireExplanationStep: false,
      requireApplicationStep: false,
      requireRevisionStep: false,
      requireMiniCheckStep: false,
      minimumDidacticScore: 35,
    },
    examQuality: {
      requireOperatorSignal: true,
      allowOpenQuestions: false,
      enforceDistractorQuality: true,
      enforceTypicalErrorDerivation: true,
      enforceTransferOrientation: true,
      allowPureKnowledgeQuestions: true,
      maxKnowledgeQuestionRatio: 0.25,
    },
    language: {
      maxSentenceLength: 32,
      maxPassiveRatio: 0.45,
      enableGenericPhraseDetection: true,
      enableSpellingChecks: true,
      operatorSet: IHK_OPERATORS,
    },
    tutor: {
      persona: "ihk_examiner",
      requireModeConsistency: true,
      requireLearnerContext: false,
      allowGeneralExplanationWithoutSession: true,
      requireReferencedCurriculumObject: true,
    },
    gates: {
      blockPublishOnRejected: true,
      blockPublishOnRewrite: true,
      allowReviewToPublish: false,
      blockTutorOnRejected: true,
      blockExamUsageOnRejected: true,
    },
  },

  EXAM_FIRST_PLUS: {
    track: "EXAM_FIRST_PLUS",
    label: "Exam First Plus",
    structural: {
      requireBlueprintForQuestions: true,
      requireBlueprintForLessons: false,
      requireCompetency: true,
      requireCurriculum: true,
      requireLessonToLearningField: false,
      requireExamTypeTag: true,
      requireDifficulty: true,
      requireWeightPercentage: true,
      requireMiniCheckForLessons: false,
      requireTutorReferenceObject: true,
    },
    didactics: {
      model: "mixed",
      requireEntryStep: false,
      requireExplanationStep: true,
      requireApplicationStep: true,
      requireRevisionStep: false,
      requireMiniCheckStep: false,
      minimumDidacticScore: 55,
    },
    examQuality: {
      requireOperatorSignal: true,
      allowOpenQuestions: true,
      enforceDistractorQuality: true,
      enforceTypicalErrorDerivation: true,
      enforceTransferOrientation: true,
      allowPureKnowledgeQuestions: true,
      maxKnowledgeQuestionRatio: 0.25,
    },
    language: {
      maxSentenceLength: 34,
      maxPassiveRatio: 0.5,
      enableGenericPhraseDetection: true,
      enableSpellingChecks: true,
      operatorSet: IHK_OPERATORS,
    },
    tutor: {
      persona: "ihk_examiner",
      requireModeConsistency: true,
      requireLearnerContext: true,
      allowGeneralExplanationWithoutSession: true,
      requireReferencedCurriculumObject: true,
    },
    gates: {
      blockPublishOnRejected: true,
      blockPublishOnRewrite: true,
      allowReviewToPublish: false,
      blockTutorOnRejected: true,
      blockExamUsageOnRejected: true,
    },
  },

  STUDIUM: {
    track: "STUDIUM",
    label: "Studium",
    structural: {
      requireBlueprintForQuestions: false,
      requireBlueprintForLessons: false,
      requireCompetency: true,
      requireCurriculum: true,
      requireLessonToLearningField: false,
      requireExamTypeTag: false,
      requireDifficulty: true,
      requireWeightPercentage: false,
      requireMiniCheckForLessons: false,
      requireTutorReferenceObject: true,
    },
    didactics: {
      model: "academic",
      requireEntryStep: false,
      requireExplanationStep: true,
      requireApplicationStep: false,
      requireRevisionStep: false,
      requireMiniCheckStep: false,
      minimumDidacticScore: 60,
    },
    examQuality: {
      requireOperatorSignal: false,
      allowOpenQuestions: true,
      enforceDistractorQuality: false,
      enforceTypicalErrorDerivation: false,
      enforceTransferOrientation: true,
      allowPureKnowledgeQuestions: true,
      maxKnowledgeQuestionRatio: 0.35,
    },
    language: {
      maxSentenceLength: 42,
      maxPassiveRatio: 0.6,
      enableGenericPhraseDetection: true,
      enableSpellingChecks: true,
      operatorSet: ACADEMIC_OPERATORS,
    },
    tutor: {
      persona: "academic_tutor",
      requireModeConsistency: true,
      requireLearnerContext: true,
      allowGeneralExplanationWithoutSession: true,
      requireReferencedCurriculumObject: true,
    },
    gates: {
      blockPublishOnRejected: true,
      blockPublishOnRewrite: true,
      allowReviewToPublish: false,
      blockTutorOnRejected: true,
      blockExamUsageOnRejected: false,
    },
  },

  FORTBILDUNG: {
    track: "FORTBILDUNG",
    label: "Fortbildung",
    structural: {
      requireBlueprintForQuestions: true,
      requireBlueprintForLessons: true,
      requireCompetency: true,
      requireCurriculum: true,
      requireLessonToLearningField: false,
      requireExamTypeTag: true,
      requireDifficulty: true,
      requireWeightPercentage: true,
      requireMiniCheckForLessons: true,
      requireTutorReferenceObject: true,
    },
    didactics: {
      model: "mixed",
      requireEntryStep: true,
      requireExplanationStep: true,
      requireApplicationStep: true,
      requireRevisionStep: true,
      requireMiniCheckStep: true,
      minimumDidacticScore: 70,
    },
    examQuality: {
      requireOperatorSignal: true,
      allowOpenQuestions: true,
      enforceDistractorQuality: true,
      enforceTypicalErrorDerivation: true,
      enforceTransferOrientation: true,
      allowPureKnowledgeQuestions: true,
      maxKnowledgeQuestionRatio: 0.25,
    },
    language: {
      maxSentenceLength: 36,
      maxPassiveRatio: 0.5,
      enableGenericPhraseDetection: true,
      enableSpellingChecks: true,
      operatorSet: [...IHK_OPERATORS, "anwenden", "bewerten"],
    },
    tutor: {
      persona: "practice_coach",
      requireModeConsistency: true,
      requireLearnerContext: true,
      allowGeneralExplanationWithoutSession: true,
      requireReferencedCurriculumObject: true,
    },
    gates: {
      blockPublishOnRejected: true,
      blockPublishOnRewrite: true,
      allowReviewToPublish: false,
      blockTutorOnRejected: true,
      blockExamUsageOnRejected: true,
    },
  },

  MEISTER: {
    track: "MEISTER",
    label: "Meister",
    structural: {
      requireBlueprintForQuestions: true,
      requireBlueprintForLessons: true,
      requireCompetency: true,
      requireCurriculum: true,
      requireLessonToLearningField: false,
      requireExamTypeTag: true,
      requireDifficulty: true,
      requireWeightPercentage: true,
      requireMiniCheckForLessons: true,
      requireTutorReferenceObject: true,
    },
    didactics: {
      model: "practical",
      requireEntryStep: true,
      requireExplanationStep: true,
      requireApplicationStep: true,
      requireRevisionStep: true,
      requireMiniCheckStep: true,
      minimumDidacticScore: 75,
    },
    examQuality: {
      requireOperatorSignal: true,
      allowOpenQuestions: true,
      enforceDistractorQuality: true,
      enforceTypicalErrorDerivation: true,
      enforceTransferOrientation: true,
      allowPureKnowledgeQuestions: false,
      maxKnowledgeQuestionRatio: 0.15,
    },
    language: {
      maxSentenceLength: 34,
      maxPassiveRatio: 0.45,
      enableGenericPhraseDetection: true,
      enableSpellingChecks: true,
      operatorSet: PRACTICAL_OPERATORS,
    },
    tutor: {
      persona: "mastercraft_coach",
      requireModeConsistency: true,
      requireLearnerContext: true,
      allowGeneralExplanationWithoutSession: false,
      requireReferencedCurriculumObject: true,
    },
    gates: {
      blockPublishOnRejected: true,
      blockPublishOnRewrite: true,
      allowReviewToPublish: false,
      blockTutorOnRejected: true,
      blockExamUsageOnRejected: true,
    },
  },

  ZERTIFIKAT: {
    track: "ZERTIFIKAT",
    label: "Zertifizierung",
    structural: {
      requireBlueprintForQuestions: true,
      requireBlueprintForLessons: false,
      requireCompetency: true,
      requireCurriculum: true,
      requireLessonToLearningField: false,
      requireExamTypeTag: true,
      requireDifficulty: true,
      requireWeightPercentage: false,
      requireMiniCheckForLessons: false,
      requireTutorReferenceObject: true,
    },
    didactics: {
      model: "exam_only",
      requireEntryStep: false,
      requireExplanationStep: false,
      requireApplicationStep: false,
      requireRevisionStep: false,
      requireMiniCheckStep: false,
      minimumDidacticScore: 30,
    },
    examQuality: {
      requireOperatorSignal: false,
      allowOpenQuestions: false,
      enforceDistractorQuality: true,
      enforceTypicalErrorDerivation: false,
      enforceTransferOrientation: true,
      allowPureKnowledgeQuestions: true,
      maxKnowledgeQuestionRatio: 0.25,
    },
    language: {
      maxSentenceLength: 28,
      maxPassiveRatio: 0.45,
      enableGenericPhraseDetection: true,
      enableSpellingChecks: true,
      operatorSet: CERT_OPERATORS,
    },
    tutor: {
      persona: "cert_exam_coach",
      requireModeConsistency: true,
      requireLearnerContext: false,
      allowGeneralExplanationWithoutSession: true,
      requireReferencedCurriculumObject: true,
    },
    gates: {
      blockPublishOnRejected: true,
      blockPublishOnRewrite: true,
      allowReviewToPublish: false,
      blockTutorOnRejected: true,
      blockExamUsageOnRejected: true,
    },
  },
};

// ── Helpers ──

const TRACK_ALIASES: Record<string, TrackKey> = {
  AUSBILDUNG: "AUSBILDUNG_VOLL",
  AUSBILDUNG_VOLL: "AUSBILDUNG_VOLL",
  EXAM_FIRST: "EXAM_FIRST",
  EXAM_FIRST_PLUS: "EXAM_FIRST_PLUS",
  STUDIUM: "STUDIUM",
  BACHELOR: "STUDIUM",
  MASTER: "STUDIUM",
  HIGHER_ED: "STUDIUM",
  FORTBILDUNG: "FORTBILDUNG",
  MEISTER: "MEISTER",
  ZERTIFIKAT: "ZERTIFIKAT",
  CERT: "ZERTIFIKAT",
  CERTIFICATION: "ZERTIFIKAT",
};

export function normalizeTrack(input: unknown): TrackKey {
  const raw = String(input ?? "").trim().toUpperCase();
  return TRACK_ALIASES[raw] ?? "AUSBILDUNG_VOLL";
}

export function getAuditProfile(track: unknown): AuditProfile {
  return AUDIT_PROFILES[normalizeTrack(track)];
}
