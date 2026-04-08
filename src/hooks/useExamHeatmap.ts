import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface HeatmapCell {
  learning_field_id: string;
  learning_field_title: string;
  learning_field_code: string;
  sort_order: number;
  competency_count: number;
  avg_mastery: number;
  total_answers: number;
  correct_answers: number;
  accuracy: number;
  /** 0-4 intensity bucket: 0=no data, 1=weak, 2=developing, 3=proficient, 4=mastered */
  heat_level: number;
}

function getHeatLevel(accuracy: number, totalAnswers: number): number {
  if (totalAnswers === 0) return 0;
  if (accuracy < 40) return 1;
  if (accuracy < 60) return 2;
  if (accuracy < 80) return 3;
  return 4;
}

export function useExamHeatmap(curriculumId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['exam-heatmap', curriculumId, user?.id],
    enabled: !!curriculumId && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<HeatmapCell[]> => {
      // 1. Get learning fields for this curriculum
      const { data: lfs, error: lfErr } = await supabase
        .from('learning_fields')
        .select('id, title, code, sort_order')
        .eq('curriculum_id', curriculumId!)
        .order('sort_order');
      if (lfErr) throw lfErr;
      if (!lfs?.length) return [];

      // 2. Get competencies mapped to learning fields
      const { data: comps, error: compErr } = await supabase
        .from('competencies')
        .select('id, learning_field_id')
        .in('learning_field_id', lfs.map(lf => lf.id));
      if (compErr) throw compErr;

      // 3. Get shuttle events for this user+curriculum
      const { data: events, error: evErr } = await supabase
        .from('shuttle_events')
        .select('competency_id, is_correct')
        .eq('user_id', user!.id)
        .eq('curriculum_id', curriculumId!)
        .eq('event_type', 'question_answered');
      if (evErr) throw evErr;

      // Build competency → learning_field map
      const compToLf = new Map<string, string>();
      for (const c of comps || []) {
        compToLf.set(c.id, c.learning_field_id);
      }

      // Aggregate per learning field
      const lfStats = new Map<string, { total: number; correct: number; compIds: Set<string> }>();
      for (const lf of lfs) {
        lfStats.set(lf.id, { total: 0, correct: 0, compIds: new Set() });
      }

      // Count competencies per LF
      for (const c of comps || []) {
        lfStats.get(c.learning_field_id)?.compIds.add(c.id);
      }

      // Tally events
      for (const ev of events || []) {
        const lfId = compToLf.get(ev.competency_id!);
        if (!lfId) continue;
        const s = lfStats.get(lfId);
        if (!s) continue;
        s.total++;
        if (ev.is_correct) s.correct++;
      }

      return lfs.map(lf => {
        const s = lfStats.get(lf.id)!;
        const accuracy = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
        return {
          learning_field_id: lf.id,
          learning_field_title: lf.title,
          learning_field_code: lf.code,
          sort_order: lf.sort_order,
          competency_count: s.compIds.size,
          avg_mastery: accuracy,
          total_answers: s.total,
          correct_answers: s.correct,
          accuracy,
          heat_level: getHeatLevel(accuracy, s.total),
        };
      });
    },
  });
}
