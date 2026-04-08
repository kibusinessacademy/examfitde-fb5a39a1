import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CurriculumProductStats {
  curriculum_id: string;
  title: string;
  slug: string;
  chamber_type: string;
  catalog_type: string;
  question_count: number;
  competency_count: number;
  lf_count: number;
  has_oral_exam: boolean;
  has_handbook: boolean;
  track: string;
}

export function useCurriculumProductStats(curriculumId: string | null) {
  return useQuery({
    queryKey: ['curriculum-product-stats', curriculumId],
    queryFn: async (): Promise<CurriculumProductStats | null> => {
      if (!curriculumId) return null;

      // Parallel queries
      const [currRes, statsRes, packageRes] = await Promise.all([
        supabase
          .from('curricula')
          .select('id, title, certification_id')
          .eq('id', curriculumId)
          .single(),
        supabase
          .from('learning_fields')
          .select('id, competencies(id, exam_questions(id))')
          .eq('curriculum_id', curriculumId),
        supabase
          .from('course_packages')
          .select('id, track, persona_profile')
          .eq('curriculum_id', curriculumId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (currRes.error || !currRes.data) return null;

      // Get certification info
      const { data: cert } = await supabase
        .from('certification_catalog')
        .select('slug, chamber_type, catalog_type')
        .eq('id', currRes.data.certification_id!)
        .single();

      const lfs = statsRes.data || [];
      let totalQuestions = 0;
      let totalComps = 0;
      for (const lf of lfs) {
        const comps = (lf as any).competencies || [];
        totalComps += comps.length;
        for (const c of comps) {
          totalQuestions += ((c as any).exam_questions || []).length;
        }
      }

      const track = packageRes.data?.track || 'AUSBILDUNG_VOLL';
      const hasOral = track === 'AUSBILDUNG_VOLL' || track === 'EXAM_FIRST_PLUS';

      return {
        curriculum_id: curriculumId,
        title: currRes.data.title || '',
        slug: cert?.slug || '',
        chamber_type: cert?.chamber_type || 'IHK',
        catalog_type: cert?.catalog_type || 'Ausbildung',
        question_count: totalQuestions,
        competency_count: totalComps,
        lf_count: lfs.length,
        has_oral_exam: hasOral,
        has_handbook: true,
        track,
      };
    },
    enabled: !!curriculumId,
    staleTime: 60_000,
  });
}
