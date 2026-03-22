import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AdminPackagesSource = 'ssot_view' | 'fallback_course_packages';

export interface AdminPackageSSOT {
  package_id: string;
  raw_title: string | null;
  curriculum_id: string | null;
  status: string;
  track: string | null;
  priority: number | null;
  build_progress: number | null;
  current_step: string | null;
  blocked_reason: string | null;
  stuck_reason: string | null;
  last_progress_at: string | null;
  council_approved: boolean | null;
  council_approved_at: string | null;
  integrity_passed: boolean | null;
  published_at: string | null;
  is_published: boolean | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  queue_position: number | null;
  locked_at: string | null;
  canonical_title: string | null;
  beruf_id: string | null;
  beruf_display_name: string | null;
  steps_done: number;
  steps_functional: number;
  council_sessions_total: number;
  council_sessions_pending: number;
  council_sessions_processing: number;
  council_sessions_completed: number;
  council_sessions_approved: number;
  approved_questions: number;
  total_questions: number;
  jobs_pending: number;
  jobs_processing: number;
  jobs_failed: number;
  last_job_completed_at: string | null;
  last_job_error: string | null;
  has_stale_publish: boolean;
  is_stuck: boolean;
  council_complete: boolean;
  has_publish_drift: boolean;
  _source: AdminPackagesSource;
}

/** Null-safe helpers for fallback data */
export function effectiveStatus(pkg: AdminPackageSSOT): string {
  return pkg.status ??
    (pkg.published_at ? 'published' : pkg.blocked_reason ? 'blocked' : 'unknown');
}

export function effectiveProgress(pkg: AdminPackageSSOT): number {
  return typeof pkg.build_progress === 'number' ? pkg.build_progress : 0;
}

function mapFallbackPackage(row: any): Omit<AdminPackageSSOT, '_source'> {
  const title = row?.title ?? 'Unbenannt';
  const status = row?.status ?? 'queued';
  const publishedAt = row?.published_at ?? null;
  const councilApproved = row?.council_approved ?? false;

  return {
    package_id: row?.id,
    raw_title: title,
    curriculum_id: row?.curriculum_id ?? null,
    status,
    track: row?.track ?? null,
    priority: row?.priority ?? null,
    build_progress: row?.build_progress ?? 0,
    current_step: row?.current_step ?? null,
    blocked_reason: row?.blocked_reason ?? null,
    stuck_reason: row?.stuck_reason ?? null,
    last_progress_at: null,
    council_approved: councilApproved,
    council_approved_at: row?.council_approved_at ?? null,
    integrity_passed: row?.integrity_passed ?? false,
    published_at: publishedAt,
    is_published: status === 'published' || !!publishedAt,
    created_at: row?.created_at ?? new Date().toISOString(),
    updated_at: row?.updated_at ?? row?.created_at ?? new Date().toISOString(),
    last_error: row?.last_error ?? null,
    queue_position: row?.queue_position ?? null,
    locked_at: row?.locked_at ?? null,
    canonical_title: title,
    beruf_id: row?.beruf_id ?? null,
    beruf_display_name: row?.beruf_display_name ?? null,
    steps_done: 0,
    steps_functional: 0,
    council_sessions_total: 0,
    council_sessions_pending: 0,
    council_sessions_processing: 0,
    council_sessions_completed: councilApproved ? 1 : 0,
    council_sessions_approved: councilApproved ? 1 : 0,
    approved_questions: 0,
    total_questions: 0,
    jobs_pending: 0,
    jobs_processing: 0,
    jobs_failed: 0,
    last_job_completed_at: null,
    last_job_error: null,
    has_stale_publish: false,
    is_stuck: !!row?.stuck_reason,
    council_complete: !!councilApproved,
    has_publish_drift: false,
  };
}

export function useAdminPackagesSSOT() {
  return useQuery({
    queryKey: ['admin', 'packages-ssot'],
    queryFn: async (): Promise<AdminPackageSSOT[]> => {
      try {
        const { data, error } = await (supabase as any)
          .from('v_admin_packages_ssot')
          .select('*')
          .order('priority', { ascending: true })
          .order('updated_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          return data.map((row: any) => ({ ...row, _source: 'ssot_view' as const }));
        }

        console.warn('[admin-packages] SSOT view error, using fallback:', error?.message);
      } catch (e) {
        console.warn('[admin-packages] SSOT query exception, using fallback:', e);
      }

      const { data: fallbackData, error: fallbackError } = await (supabase as any)
        .from('course_packages')
        .select('id, title, curriculum_id, status, track, priority, build_progress, current_step, blocked_reason, stuck_reason, council_approved, council_approved_at, integrity_passed, published_at, created_at, updated_at, last_error, queue_position, locked_at')
        .order('priority', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: false });

      if (fallbackError) throw fallbackError;
      return (fallbackData || []).map((row: any) => ({
        ...mapFallbackPackage(row),
        _source: 'fallback_course_packages' as const,
      }));
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}
