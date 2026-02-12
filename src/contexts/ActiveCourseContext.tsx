import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface CourseStats {
  id: string;
  title: string;
  status: string;
  buildProgress: number;
  integrityPassed: boolean;
  councilApproved: boolean;
  examQuestionCount: number;
  tutorIndexVersion: number | null;
  lastBuildAt: string | null;
  healthScore: number;
  lockActive: boolean;
  lockSince: string | null;
}

interface ActiveCourseContextValue {
  course: CourseStats | null;
  loading: boolean;
  setCourseId: (id: string | null) => void;
  refresh: () => void;
}

const ActiveCourseContext = createContext<ActiveCourseContextValue>({
  course: null,
  loading: false,
  setCourseId: () => {},
  refresh: () => {},
});

export function ActiveCourseProvider({ children }: { children: ReactNode }) {
  const [courseId, setCourseId] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!courseId) { setCourse(null); return; }
    setLoading(true);
    try {
      const sb = supabase as any;
      const pkgRes = await sb.from('course_packages').select('id, title, status, build_progress, integrity_passed, council_approved, updated_at').eq('id', courseId).single();
      const questionsRes = await sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('course_id', courseId);
      const tutorRes = await sb.from('ai_tutor_context_index').select('index_version').eq('package_id', courseId).order('created_at', { ascending: false }).limit(1);
      const lockRes = await sb.from('course_package_locks').select('locked_at').eq('package_id', courseId).eq('released', false).limit(1);
      const stepsRes = await sb.from('course_package_build_steps').select('status').eq('package_id', courseId);

      const pkg = pkgRes.data;
      if (!pkg) { setCourse(null); return; }

      const steps = stepsRes.data || [];
      const doneSteps = steps.filter(s => s.status === 'done').length;
      const totalSteps = steps.length || 1;
      const failedSteps = steps.filter(s => s.status === 'failed').length;
      const healthScore = Math.max(0, Math.round(
        (pkg.integrity_passed ? 30 : 0) +
        (pkg.council_approved ? 10 : 0) +
        (doneSteps / totalSteps * 40) +
        (failedSteps === 0 ? 20 : Math.max(0, 20 - failedSteps * 5))
      ));

      const lock = lockRes.data?.[0];

      setCourse({
        id: pkg.id,
        title: pkg.title || pkg.id.substring(0, 12),
        status: pkg.status,
        buildProgress: pkg.build_progress,
        integrityPassed: pkg.integrity_passed,
        councilApproved: pkg.council_approved,
        examQuestionCount: questionsRes.count || 0,
        tutorIndexVersion: tutorRes.data?.[0]?.index_version ?? null,
        lastBuildAt: pkg.updated_at,
        healthScore,
        lockActive: !!lock,
        lockSince: lock?.locked_at ?? null,
      });
    } catch (e) {
      console.error('ActiveCourse load error:', e);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  return (
    <ActiveCourseContext.Provider value={{ course, loading, setCourseId, refresh: load }}>
      {children}
    </ActiveCourseContext.Provider>
  );
}

export function useActiveCourse() {
  return useContext(ActiveCourseContext);
}
