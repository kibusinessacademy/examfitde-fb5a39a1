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

export function useCoursePackages() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const packagesQuery = useQuery({
    queryKey: ['course-packages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_packages')
        .select('*')
        .neq('status', 'archived')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rows = (data || []) as (CoursePackage & { curriculum_id?: string | null })[];

      // Defensive guard against duplicate versions leaking into admin lists
      // (e.g. stale cache/status drift). Keep exactly one visible package per curriculum/title.
      const statusPriority: Record<string, number> = {
        building: 100,
        queued: 90,
        qa: 80,
        council_review: 70,
        planning: 60,
        draft: 60,
        published: 50,
        done: 40,
        failed: 30,
        quality_gate_failed: 20,
        archived: 0,
      };

      const deduped = new Map<string, CoursePackage & { curriculum_id?: string | null }>();

      for (const pkg of rows) {
        if (pkg.status === 'archived') continue;

        const key = pkg.curriculum_id || (pkg.title || '').trim().toLowerCase() || pkg.id;
        const current = deduped.get(key);

        if (!current) {
          deduped.set(key, pkg);
          continue;
        }

        const currentScore = statusPriority[current.status] ?? 10;
        const nextScore = statusPriority[pkg.status] ?? 10;

        if (nextScore > currentScore) {
          deduped.set(key, pkg);
          continue;
        }

        if (nextScore === currentScore) {
          const currentUpdated = new Date(current.updated_at).getTime();
          const nextUpdated = new Date(pkg.updated_at).getTime();
          if (nextUpdated > currentUpdated) {
            deduped.set(key, pkg);
          }
        }
      }

      return Array.from(deduped.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ) as CoursePackage[];
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
      const { data, error } = await supabase
        .from('course_packages')
        .select('*')
        .eq('id', packageId)
        .single();
      if (error) throw error;
      return data as CoursePackage;
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
      if (res.error) throw res.error;
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
