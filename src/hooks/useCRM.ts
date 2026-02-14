import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeInvalidation } from './useAdminRealtimeInvalidation';

// ═══════════════════════════════════════════════════════════
// Learner Profiles
// ═══════════════════════════════════════════════════════════

export interface LearnerProfile {
  id: string;
  user_id: string;
  learning_style: string | null;
  pace_category: string | null;
  frustration_threshold: string | null;
  motivation_type: string | null;
  risk_areas: any;
  exam_readiness_score: number | null;
  confidence_score: number | null;
  churn_risk_score: number | null;
  last_activity_at: string | null;
  total_learning_minutes: number | null;
  streak_current: number | null;
  streak_best: number | null;
  created_at: string;
  updated_at: string;
  // joined
  email?: string;
  display_name?: string;
}

export function useLearnerProfiles(opts?: { riskFilter?: string; search?: string }) {
  useRealtimeInvalidation('learner_profiles', [['crm-learners']]);

  return useQuery({
    queryKey: ['crm-learners', opts?.riskFilter, opts?.search],
    queryFn: async () => {
      let query = supabase
        .from('learner_profiles')
        .select('*')
        .order('churn_risk_score', { ascending: false })
        .limit(100);

      if (opts?.riskFilter && opts.riskFilter !== 'all') {
        const thresholds: Record<string, [number, number]> = {
          high: [0.7, 1],
          medium: [0.3, 0.7],
          low: [0, 0.3],
        };
        const [min, max] = thresholds[opts.riskFilter] || [0, 1];
        query = query.gte('churn_risk_score', min).lt('churn_risk_score', max);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch display names from profiles table
      const userIds = (data || []).map((d: any) => d.user_id).filter(Boolean);
      let profileMap: Record<string, { full_name?: string }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', userIds);
        if (profiles) {
          profileMap = Object.fromEntries(profiles.map((p: any) => [p.user_id, p]));
        }
      }

      return (data || []).map((d: any) => ({
        ...d,
        display_name: profileMap[d.user_id]?.full_name,
      })) as LearnerProfile[];
    },
  });
}

// ═══════════════════════════════════════════════════════════
// Churn Predictions
// ═══════════════════════════════════════════════════════════

export interface ChurnPrediction {
  id: string;
  user_id: string;
  risk_score: number;
  risk_level: string;
  signals: any;
  recommended_action: string | null;
  action_taken: string | null;
  action_taken_at: string | null;
  predicted_at: string;
  expires_at: string | null;
}

export function useChurnPredictions() {
  useRealtimeInvalidation('churn_predictions', [['crm-churn']]);

  return useQuery({
    queryKey: ['crm-churn'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('churn_predictions')
        .select('*')
        .order('risk_score', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as ChurnPrediction[];
    },
  });
}

// ═══════════════════════════════════════════════════════════
// Learner Segments
// ═══════════════════════════════════════════════════════════

export interface LearnerSegment {
  id: string;
  name: string;
  description: string | null;
  criteria: any;
  color: string | null;
  is_dynamic: boolean;
  created_at: string;
  updated_at: string;
}

export function useLearnerSegments() {
  useRealtimeInvalidation('learner_segments', [['crm-segments']]);

  return useQuery({
    queryKey: ['crm-segments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('learner_segments')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data || []) as LearnerSegment[];
    },
  });
}
