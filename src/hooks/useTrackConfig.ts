import { useMemo } from 'react';

export type CertificationType = 
  | 'ausbildung' 
  | 'fortbildung_ihk' 
  | 'fortbildung_hwk' 
  | 'sachkunde' 
  | 'branchenzertifikat' 
  | 'projektmanagement';

export type ProductTrack = 'AUSBILDUNG_VOLL' | 'EXAM_FIRST';

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
};

export const TRACK_LABELS: Record<ProductTrack, string> = {
  AUSBILDUNG_VOLL: 'Vollprodukt',
  EXAM_FIRST: 'Exam-First',
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
};

// Pipeline steps filtered by feature_flags — full 17-step pipeline matching DB
export const ALL_PIPELINE_STEPS = [
  { key: 'scaffold_learning_course', label: 'Lernkurs Scaffold', shortLabel: 'Scaffold', flag: 'has_learning_course' },
  { key: 'generate_glossary',        label: 'Glossar',           shortLabel: 'Glossar',  flag: 'has_learning_course' },
  { key: 'generate_learning_content',label: 'Lerninhalte',       shortLabel: 'Inhalt',   flag: 'has_learning_course' },
  { key: 'validate_learning_content',label: 'QG Lerninhalte',    shortLabel: 'QG Lern',  flag: 'has_learning_course' },
  { key: 'auto_seed_exam_blueprints',label: 'Exam Blueprints',   shortLabel: 'BP Seed',  flag: 'has_exam_trainer' },
  { key: 'validate_blueprints',      label: 'QG Blueprints',     shortLabel: 'QG BP',    flag: 'has_exam_trainer' },
  { key: 'generate_exam_pool',       label: 'Prüfungsfragen',    shortLabel: 'Exam',     flag: 'has_exam_trainer' },
  { key: 'validate_exam_pool',       label: 'QG Exam Pool',      shortLabel: 'QG Exam',  flag: 'has_exam_trainer' },
  { key: 'build_ai_tutor_index',     label: 'AI Tutor',          shortLabel: 'Tutor',    flag: 'has_ai_tutor' },
  { key: 'validate_tutor_index',     label: 'QG Tutor',          shortLabel: 'QG Tut',   flag: 'has_ai_tutor' },
  { key: 'generate_oral_exam',       label: 'Mündliche',         shortLabel: 'Oral',     flag: 'has_oral_exam_trainer' },
  { key: 'validate_oral_exam',       label: 'QG Mündliche',      shortLabel: 'QG Oral',  flag: 'has_oral_exam_trainer' },
  { key: 'generate_handbook',        label: 'Handbuch',          shortLabel: 'Buch',     flag: 'has_handbook' },
  { key: 'validate_handbook',        label: 'QG Handbuch',       shortLabel: 'QG Buch',  flag: 'has_handbook' },
  { key: 'run_integrity_check',      label: 'Qualitätsprüfung',  shortLabel: 'QA',       flag: null },
  { key: 'quality_council',          label: 'QA Council',        shortLabel: 'Council',  flag: null },
  { key: 'auto_publish',             label: 'Veröffentlichen',   shortLabel: 'Pub',      flag: null },
] as const;

export function getActiveSteps(flags: FeatureFlags | null | undefined) {
  if (!flags) return ALL_PIPELINE_STEPS;
  return ALL_PIPELINE_STEPS.filter(s => 
    s.flag === null || (flags as any)[s.flag] === true
  );
}

export function useTrackConfig(pkg: { track?: string; feature_flags?: any; certification_type?: string } | null | undefined) {
  return useMemo(() => {
    const track = (pkg?.track || 'AUSBILDUNG_VOLL') as ProductTrack;
    const certType = (pkg?.certification_type || 'ausbildung') as CertificationType;
    const flags: FeatureFlags = pkg?.feature_flags || DEFAULT_FLAGS[track];
    const activeSteps = getActiveSteps(flags);
    const isExamFirst = track === 'EXAM_FIRST';

    return { track, certType, flags, activeSteps, isExamFirst };
  }, [pkg?.track, pkg?.feature_flags, pkg?.certification_type]);
}
