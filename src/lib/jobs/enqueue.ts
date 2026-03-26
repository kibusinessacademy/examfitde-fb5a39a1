import { supabase } from '@/integrations/supabase/client';
import { assertKnownJobType } from './job-registry';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN_FIELDS = ['slug', 'title', 'name', 'label', 'description'];

export interface JobPayload {
  job_type: string;
  curriculum_id: string;
  extra?: Record<string, unknown>;
  max_attempts?: number;
}

function validatePayload(job: JobPayload): void {
  if (!UUID_REGEX.test(job.curriculum_id)) {
    throw new Error(`SSOT Guard: curriculum_id must be a valid UUID, got "${job.curriculum_id}"`);
  }
  if (job.extra) {
    for (const key of Object.keys(job.extra)) {
      if (FORBIDDEN_FIELDS.includes(key.toLowerCase())) {
        throw new Error(`SSOT Guard: forbidden field "${key}" in payload. Use UUIDs only.`);
      }
    }
  }
}

export async function enqueueJob(job: JobPayload) {
  assertKnownJobType(job.job_type);
  validatePayload(job);
  const { data, error } = await supabase.from('job_queue').insert({
    job_type: job.job_type,
    payload: { curriculum_id: job.curriculum_id, ...(job.extra ?? {}) },
    status: 'pending',
    max_attempts: job.max_attempts ?? 3,
  }).select('id').single();
  if (error) throw error;
  return data;
}

export async function enqueuePipeline(curriculumId: string, jobs: Omit<JobPayload, 'curriculum_id'>[]) {
  if (!UUID_REGEX.test(curriculumId)) {
    throw new Error(`SSOT Guard: curriculum_id must be a valid UUID`);
  }
  const rows = jobs.map((j, i) => {
    const full: JobPayload = { ...j, curriculum_id: curriculumId };
    validatePayload(full);
    return {
      job_type: j.job_type,
      payload: { curriculum_id: curriculumId, pipeline_order: i, ...(j.extra ?? {}) },
      status: 'pending' as const,
      max_attempts: j.max_attempts ?? 3,
    };
  });
  const { data, error } = await supabase.from('job_queue').insert(rows).select('id, job_type');
  if (error) throw error;
  return data;
}

export const PIPELINE_TEMPLATES = {
  'end-to-end': {
    label: 'End-to-End: Curriculum → Produkt → Quality',
    description: 'Vollständige Pipeline: Extraktion, Kursgenerierung, QC-Worker, Finalisierung und Quality Gates.',
    icon: 'Rocket',
    jobs: [
      { job_type: 'extract_curriculum' },
      { job_type: 'generate_course' },
      { job_type: 'seed_exam_questions' },
      { job_type: 'enrich_exam_solutions' },
      { job_type: 'upgrade_minichecks_v1' },
      { job_type: 'qc_worker_full' },
      { job_type: 'course_finalize' },
      { job_type: 'post_validation' },
      { job_type: 'curriculum_smoke' },
    ],
  },
  'release': {
    label: 'Release Pipeline',
    description: 'Quality Gate → Kurs → QC → Seal → Publish → SEO',
    icon: 'Package',
    jobs: [
      { job_type: 'quality_gate_precheck' },
      { job_type: 'generate_course' },
      { job_type: 'seed_exam_questions' },
      { job_type: 'upgrade_minichecks_v1' },
      { job_type: 'qc_worker_full' },
      { job_type: 'course_finalize' },
      { job_type: 'post_validation' },
      { job_type: 'publish_product' },
      { job_type: 'seo_foundation' },
      { job_type: 'seo_audit' },
    ],
  },
  'seo-foundation': {
    label: 'SEO Foundation',
    description: 'SEO-Meta-Daten generieren, Audit durchführen und interne Verlinkung aufbauen.',
    icon: 'Globe',
    jobs: [
      { job_type: 'seo_foundation' },
      { job_type: 'seo_audit' },
      { job_type: 'seo_internal_links' },
    ],
  },
  'seo-content': {
    label: 'SEO Content Pipeline',
    description: 'Landing + Blog + FAQ generieren, QC prüfen, Internal Linking, Sitemap aktualisieren.',
    icon: 'FileText',
    jobs: [
      { job_type: 'seo_generate' },
      { job_type: 'seo_qc_check' },
      { job_type: 'seo_internal_links' },
      { job_type: 'seo_sitemap_refresh' },
    ],
  },
  'quality-only': {
    label: 'Dry Run (Quality Check)',
    description: 'Nur Quality Gates und Smoke Tests – keine Generierung, kein Publish.',
    icon: 'ShieldCheck',
    jobs: [
      { job_type: 'quality_gate_precheck' },
      { job_type: 'curriculum_smoke' },
    ],
  },
  'ihk-upgrade': {
    label: 'IHK-Prüfungsniveau Upgrade',
    description: 'Blueprint-Mapping, Exam-Blocks, MiniCheck-Upgrade, Gewichtung & Difficulty – vollautomatisch in 4 Phasen.',
    icon: 'GraduationCap',
    jobs: [
      { job_type: 'upgrade_ihk', extra: { phase: 'blueprints' } },
      { job_type: 'upgrade_ihk', extra: { phase: 'exam_blocks' } },
      { job_type: 'upgrade_ihk', extra: { phase: 'weighting' } },
      { job_type: 'upgrade_ihk', extra: { phase: 'minichecks' } },
      { job_type: 'qc_worker_full' },
      { job_type: 'post_validation' },
    ],
  },
  'council-review': {
    label: 'Council v2 Review',
    description: 'Deliberative Architektur: GPT-4.1 generiert, Claude Sonnet 4 validiert, Verdict + Publish Gate.',
    icon: 'Scale',
    jobs: [
      { job_type: 'council_propose_step' },
      { job_type: 'council_critique_step' },
      { job_type: 'council_vote_and_verdict' },
      { job_type: 'council_publish_step' },
      { job_type: 'council_recompute_course_ready' },
    ],
  },
  'council-full-loop': {
    label: 'Council v2 Full Loop (pro Step)',
    description: 'Einzelaufruf: Propose → Critique → (Revise)* → Verdict → Publish – für einen Lesson-Step.',
    icon: 'Gavel',
    jobs: [
      { job_type: 'council_run_step' },
    ],
  },
  'seed-first': {
    label: 'Phase 0 → Build (Seed-First)',
    description: 'Seeding prüfen & auffüllen, dann Build-Pipeline starten. Blockiert bei unvollständigem Curriculum.',
    icon: 'Sprout',
    jobs: [
      { job_type: 'seed_learning_fields' },
      { job_type: 'seed_competencies' },
      { job_type: 'seed_recheck' },
      { job_type: 'generate_course' },
      { job_type: 'seed_exam_questions' },
      { job_type: 'qc_worker_full' },
      { job_type: 'course_finalize' },
      { job_type: 'post_validation' },
    ],
  },
  'seed-only': {
    label: 'Seed Only (Curriculum auffüllen)',
    description: 'Nur fehlende Lernfelder, Kompetenzen und Objectives seeden – kein Build.',
    icon: 'Sprout',
    jobs: [
      { job_type: 'seed_learning_fields' },
      { job_type: 'seed_competencies' },
      { job_type: 'seed_recheck' },
    ],
  },
  'full-pipeline': {
    label: 'Full Pipeline (Seed → Build → QA → Publish)',
    description: 'Kompletter End-to-End-Workflow: Phase 0 Seeding → Build → Integrity → Gap-Closure → Publish.',
    icon: 'Rocket',
    jobs: [
      { job_type: 'seed_learning_fields' },
      { job_type: 'seed_competencies' },
      { job_type: 'seed_recheck' },
      { job_type: 'extract_curriculum' },
      { job_type: 'generate_course' },
      { job_type: 'seed_exam_questions' },
      { job_type: 'enrich_exam_solutions' },
      { job_type: 'upgrade_minichecks_v1' },
      { job_type: 'qc_worker_full' },
      { job_type: 'course_finalize' },
      { job_type: 'post_validation' },
      { job_type: 'curriculum_smoke' },
      { job_type: 'publish_product' },
    ],
  },
} as const;

export type PipelineTemplateKey = keyof typeof PIPELINE_TEMPLATES;
