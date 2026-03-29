import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { handleDomainError } from '@/lib/handleDomainError';

export interface CoursePackage {
  id: string;
  certification_id: string | null;
  course_id: string | null;
  title: string;
  status: string;
  components: Record<string, boolean>;
  council_approved: boolean;
  council_approved_at: string | null;
  build_progress: number;
  integrity_passed: boolean;
  integrity_report: any;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuildStep {
  package_id: string;
  step_key: string;
  sort_order: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  attempts?: number;
  max_attempts?: number;
  last_error?: string | null;
  runner_id?: string | null;
  meta?: any;
  created_at?: string;
  updated_at?: string;
  // legacy compat (may be absent from view)
  id?: string;
  step_label?: string;
  duration_ms?: number | null;
  log?: any;
  error_message?: string | null;
  retry_count?: number;
  timeout_seconds?: number;
  last_heartbeat_at?: string | null;
}

export interface CouncilSession {
  id: string;
  package_id: string;
  council_type: string;
  status: string;
  discussion: any;
  decision: string | null;
  recommendations: any;
  decided_at: string | null;
}

const COUNCIL_TYPES = [
  'didactic', 'exam', 'question_quality', 'oral', 'tutor', 'handbook', 'seo_commercial'
] as const;

// Re-exported from useTrackConfig for backward compat
import { ALL_PIPELINE_STEPS as TRACK_PIPELINE_STEPS } from '@/hooks/useTrackConfig';
const BUILD_STEPS = TRACK_PIPELINE_STEPS;

const STATUS_RANK: Record<string, number> = {
  building: 0,
  queued: 1,
  blocked: 2,
  qa: 3,
  council_review: 4,
  published: 5,
  done: 6,
  planning: 7,
  draft: 8,
  failed: 9,
  quality_gate_failed: 10,
};

const GENDER_INCLUSIVE_MARKER_REGEX = /\/(?:-|)(?:in|frau|mann|r|e|n)\b/i;

function hasGenderInclusiveMarker(title: string): boolean {
  return GENDER_INCLUSIVE_MARKER_REGEX.test(title);
}

function normalizePackageTitle(title: string): string {
  return title
    .replace(/^ExamFit\s*–\s*/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/kaufmann\/-frau/g, 'kaufmann')
    .replace(/\/(?:-|)(?:in|frau|mann|r|e|n)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function selectPreferredPackage(a: CoursePackage, b: CoursePackage): CoursePackage {
  const aInclusive = hasGenderInclusiveMarker(a.title);
  const bInclusive = hasGenderInclusiveMarker(b.title);

  if (aInclusive !== bInclusive) return aInclusive ? a : b;

  const aRank = STATUS_RANK[a.status] ?? 99;
  const bRank = STATUS_RANK[b.status] ?? 99;
  if (aRank !== bRank) return aRank < bRank ? a : b;

  const aPriority = Number((a as any).priority ?? Number.MAX_SAFE_INTEGER);
  const bPriority = Number((b as any).priority ?? Number.MAX_SAFE_INTEGER);
  if (aPriority !== bPriority) return aPriority < bPriority ? a : b;

  return new Date(a.updated_at).getTime() >= new Date(b.updated_at).getTime() ? a : b;
}

function dedupeVisiblePackages(rows: CoursePackage[]): CoursePackage[] {
  const nonArchived = rows.filter((pkg) => pkg.status !== 'archived');
  const grouped = new Map<string, CoursePackage[]>();

  for (const pkg of nonArchived) {
    // Use canonical_title from view (SSOT berufe.bezeichnung_kurz) if available
    const canonical = (pkg as any).canonical_title || pkg.title || pkg.id;
    const key = normalizePackageTitle(canonical);
    const bucket = grouped.get(key) || [];
    bucket.push({
      ...pkg,
      title: canonical,  // Ensure UI always shows canonical form
    });
    grouped.set(key, bucket);
  }

  const pickedIds = new Set<string>();
  for (const group of grouped.values()) {
    let picked = group[0];
    for (let i = 1; i < group.length; i++) {
      picked = selectPreferredPackage(picked, group[i]);
    }
    pickedIds.add(picked.id);
  }

  // Preserve backend ordering (priority + updated_at)
  return nonArchived.filter((pkg) => pickedIds.has(pkg.id));
}

export function useCoursePackages() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const packagesQuery = useQuery({
    queryKey: ['course-packages'],
    queryFn: async () => {
      // SSOT: DB-side deduplication via v_admin_visible_course_packages view
      // + client-side guard against stale/legacy duplicates in cached/native sessions
      const { data, error } = await (supabase as any)
        .from('v_admin_visible_course_packages')
        .select('*')
        .order('priority', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return dedupeVisiblePackages((data || []) as CoursePackage[]);
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const createPackage = useMutation({
    mutationFn: async (params: { certificationId: string; curriculumId: string; title: string; components?: Record<string, boolean> }) => {
      // UX-only pre-check (server is authoritative via SSOT guard + unique index)
      const { data: existing } = await supabase
        .from('course_packages')
        .select('id, status, title')
        .eq('curriculum_id', params.curriculumId)
        .in('status', ['building', 'published'])
        .maybeSingle();

      if (existing) {
        throw new Error(`Für dieses Curriculum existiert bereits ein aktives Paket: "${existing.title}" (${existing.status})`);
      }

      const { data, error } = await supabase
        .from('course_packages')
        .insert({
          certification_id: params.certificationId,
          curriculum_id: params.curriculumId,
          title: params.title,
          components: params.components || {
            learning_course: true,
            exam_trainer: true,
            oral_exam: true,
            ai_tutor: true,
            handbook: true,
          },
        } as any)
        .select('*')
        .single();
      if (error) throw error;
      return data as CoursePackage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-packages'] });
      toast({ title: 'Produktpaket erstellt' });
    },
    onError: (err: any) => {
      const handled = handleDomainError(err, { navigate, toast });
      if (!handled) {
        toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
      }
    },
  });

  return { ...packagesQuery, createPackage };
}

export function useCoursePackageDetail(packageId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const packageQuery = useQuery({
    queryKey: ['course-package', packageId],
    queryFn: async () => {
      if (!packageId) return null;
      // Use SSOT view for canonical title, fall back to course_packages for full data
      const { data: ssotData } = await (supabase as any)
        .from('v_course_display_ssot')
        .select('canonical_title')
        .eq('package_id', packageId)
        .maybeSingle();

      const { data, error } = await supabase
        .from('course_packages')
        .select('*')
        .eq('id', packageId)
        .single();
      if (error) throw error;
      // Overlay canonical title from SSOT view
      const pkg = data as CoursePackage;
      if (ssotData?.canonical_title) {
        pkg.title = ssotData.canonical_title;
      }
      return pkg;
    },
    enabled: !!packageId,
  });

  const buildStepsQuery = useQuery({
    queryKey: ['course-package-steps', packageId],
    queryFn: async () => {
      if (!packageId) return [];
      const { data, error } = await (supabase as any)
        .from('package_steps')
        .select('*')
        .eq('package_id', packageId)
        .order('created_at');
      if (error) throw error;
      return (data || []) as BuildStep[];
    },
    enabled: !!packageId,
    refetchInterval: packageQuery.data?.status === 'building' ? 3000 : false,
  });

  const councilsQuery = useQuery({
    queryKey: ['course-package-councils', packageId],
    queryFn: async () => {
      if (!packageId) return [];
      const { data, error } = await supabase
        .from('council_sessions')
        .select('*')
        .eq('package_id', packageId)
        .order('created_at');
      if (error) throw error;
      return (data || []) as CouncilSession[];
    },
    enabled: !!packageId,
  });

  const startBuild = useMutation({
    mutationFn: async () => {
      if (!packageId) throw new Error('No package');

      // Ensure priority ≤ 10 so the pipeline-runner's Priority Gate picks it up
      const { data: pkgRow } = await supabase
        .from('course_packages')
        .select('priority')
        .eq('id', packageId)
        .single();
      if (pkgRow && (pkgRow as any).priority > 10) {
        await supabase
          .from('course_packages')
          .update({ priority: 5, updated_at: new Date().toISOString() } as any)
          .eq('id', packageId);
      }

      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('build-course-package', {
        body: { packageId },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      // Handle WIP_LIMIT_REACHED (429) gracefully
      if (res.error) {
        // Check if the response body contains WIP limit info
        try {
          const errBody = typeof res.data === 'object' ? res.data : JSON.parse(String(res.error?.message || '{}'));
          if (errBody?.error === 'WIP_LIMIT_REACHED') {
            throw new Error('Das System ist aktuell ausgelastet. Das Paket wird automatisch gebaut, sobald ein Slot frei wird.');
          }
        } catch (parseErr) {
          if ((parseErr as Error).message.includes('ausgelastet')) throw parseErr;
        }
        throw res.error;
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-package', packageId] });
      queryClient.invalidateQueries({ queryKey: ['course-package-steps', packageId] });
      toast({ title: 'Build gestartet', description: 'Das Produktpaket wird erstellt...' });
    },
    onError: (err: any) => {
      toast({ title: 'Build-Fehler', description: err.message, variant: 'destructive' });
    },
  });

  const initCouncils = useMutation({
    mutationFn: async () => {
      if (!packageId) throw new Error('No package');
      const sessions = COUNCIL_TYPES.map(type => ({
        package_id: packageId,
        council_type: type,
        status: 'pending' as const,
      }));
      const { error } = await supabase.from('council_sessions').insert(sessions);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-package-councils', packageId] });
      toast({ title: 'Councils initialisiert' });
    },
  });

  const approveCouncils = useMutation({
    mutationFn: async () => {
      if (!packageId) throw new Error('No package');
      const { error } = await supabase
        .from('course_packages')
        .update({
          council_approved: true,
          council_approved_at: new Date().toISOString(),
          status: 'council_review',
        })
        .eq('id', packageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-package', packageId] });
      toast({ title: 'Council-Freigabe erteilt' });
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['course-package', packageId] });
    queryClient.invalidateQueries({ queryKey: ['course-package-steps', packageId] });
    queryClient.invalidateQueries({ queryKey: ['course-package-councils', packageId] });
  };

  return {
    package: packageQuery.data,
    packageLoading: packageQuery.isLoading,
    buildSteps: buildStepsQuery.data || [],
    councils: councilsQuery.data || [],
    startBuild,
    initCouncils,
    approveCouncils,
    invalidate,
    BUILD_STEPS,
    COUNCIL_TYPES,
  };
}
