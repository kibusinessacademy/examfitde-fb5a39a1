import { supabase } from '@/integrations/supabase/client';

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
  'quality-only': {
    label: 'Dry Run (Quality Check)',
    description: 'Nur Quality Gates und Smoke Tests – keine Generierung, kein Publish.',
    icon: 'ShieldCheck',
    jobs: [
      { job_type: 'quality_gate_precheck' },
      { job_type: 'curriculum_smoke' },
    ],
  },
} as const;

export type PipelineTemplateKey = keyof typeof PIPELINE_TEMPLATES;
