import { useMemo } from 'react';
import { ALL_PIPELINE_STEPS_UI, getActivePipelineStepsUI } from '@/lib/pipeline-ui-registry';

export type CertificationType = 
  | 'ausbildung' 
  | 'fortbildung_ihk' 
  | 'fortbildung_hwk' 
  | 'sachkunde' 
  | 'branchenzertifikat' 
  | 'projektmanagement'
  | 'studium';

export type ProductTrack = 'AUSBILDUNG_VOLL' | 'EXAM_FIRST' | 'STUDIUM';

export type AiTutorMode = 'full' | 'limited_exam' | 'off';

export interface FeatureFlags {
  has_learning_course: boolean;
  has_practice_course_h5p: boolean;
  has_minichecks: boolean;
  has_exam_trainer: boolean;
  has_exam_simulation: boolean;
  has_oral_exam_trainer: boolean;
  has_ai_tutor: boolean;
  has_handbook: boolean;
  ai_tutor_mode?: AiTutorMode;
}

export const CERT_TYPE_LABELS: Record<CertificationType, string> = {
  ausbildung: 'Ausbildung',
  fortbildung_ihk: 'Fortbildung (IHK)',
  fortbildung_hwk: 'Fortbildung (HWK)',
  sachkunde: 'Sachkunde (§34 etc.)',
  branchenzertifikat: 'Branchenzertifikat',
  projektmanagement: 'Projektmanagement',
  studium: 'Studium',
};

export const TRACK_LABELS: Record<ProductTrack, string> = {
  AUSBILDUNG_VOLL: 'Vollprodukt',
  EXAM_FIRST: 'Exam-First',
  STUDIUM: 'Studium',
};

export const DEFAULT_FLAGS: Record<ProductTrack, FeatureFlags> = {
  AUSBILDUNG_VOLL: {
    has_learning_course: true,
    has_practice_course_h5p: true,
    has_minichecks: true,
    has_exam_trainer: true,
    has_exam_simulation: true,
    has_oral_exam_trainer: true,
    has_ai_tutor: true,
    has_handbook: true,
    ai_tutor_mode: 'full',
  },
  EXAM_FIRST: {
    has_learning_course: false,
    has_practice_course_h5p: false,
    has_minichecks: false,
    has_exam_trainer: true,
    has_exam_simulation: true,
    has_oral_exam_trainer: true,
    has_ai_tutor: true,
    has_handbook: false,
    ai_tutor_mode: 'limited_exam',
  },
  STUDIUM: {
    has_learning_course: true,
    has_practice_course_h5p: false,
    has_minichecks: true,
    has_exam_trainer: true,
    has_exam_simulation: true,
    has_oral_exam_trainer: false,
    has_ai_tutor: true,
    has_handbook: true,
    ai_tutor_mode: 'full',
  },
};

/** @deprecated Use ALL_PIPELINE_STEPS_UI from pipeline-ui-registry.ts */
export const ALL_PIPELINE_STEPS = ALL_PIPELINE_STEPS_UI;

/** @deprecated Use getActivePipelineStepsUI from pipeline-ui-registry.ts */
export function getActiveSteps(flags: FeatureFlags | null | undefined) {
  return getActivePipelineStepsUI(flags as unknown as Record<string, boolean> | null | undefined);
}

// ── SSOT Track Interpreter ─────────────────────────────────
export function requiresLearning(track: ProductTrack): boolean {
  return track === 'AUSBILDUNG_VOLL' || track === 'STUDIUM';
}

export function requiresHandbook(track: ProductTrack): boolean {
  return track === 'AUSBILDUNG_VOLL' || track === 'STUDIUM';
}

export function requiresTutorIndex(track: ProductTrack): boolean {
  return track === 'AUSBILDUNG_VOLL' || track === 'STUDIUM';
}

export function isExamOnlyScore(track: ProductTrack): boolean {
  return track === 'EXAM_FIRST';
}

export function isHigherEd(track: ProductTrack): boolean {
  return track === 'STUDIUM';
}

export function useTrackConfig(pkg: { track?: string; feature_flags?: any; certification_type?: string } | null | undefined) {
  return useMemo(() => {
    const track = (pkg?.track || 'AUSBILDUNG_VOLL') as ProductTrack;
    const certType = (pkg?.certification_type || 'ausbildung') as CertificationType;
    const flags: FeatureFlags = pkg?.feature_flags || DEFAULT_FLAGS[track];
    const activeSteps = getActivePipelineStepsUI(flags as unknown as Record<string, boolean>);
    const isExamFirst = track === 'EXAM_FIRST';
    const isStudium = track === 'STUDIUM';

    return { track, certType, flags, activeSteps, isExamFirst, isStudium };
  }, [pkg?.track, pkg?.feature_flags, pkg?.certification_type]);
}
