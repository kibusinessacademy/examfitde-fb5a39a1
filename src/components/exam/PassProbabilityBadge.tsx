import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PassProbabilityBadgeProps {
  curriculumId?: string;
  className?: string;
}

export function PassProbabilityBadge({ curriculumId, className }: PassProbabilityBadgeProps) {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['pass-probability', user?.id, curriculumId],
    queryFn: async () => {
      if (!user || !curriculumId) return null;
      const { data, error } = await supabase
        .from('user_ability_profiles')
        .select('pass_probability, theta_overall, updated_at')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculumId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!curriculumId,
    staleTime: 1000 * 60 * 5,
  });

  if (!data) return null;

  const prob = Math.round((data.pass_probability ?? 0) * 100);
  const theta = data.theta_overall ?? 0;

  const config = prob >= 75
    ? { color: 'text-green-500 bg-green-500/10', Icon: TrendingUp }
    : prob >= 50
    ? { color: 'text-yellow-500 bg-yellow-500/10', Icon: Minus }
    : { color: 'text-destructive bg-destructive-bg-subtle', Icon: TrendingDown };

  return (
    <Badge variant="outline" className={cn('gap-1.5 font-mono', config.color, className)}>
      <config.Icon className="h-3 w-3" />
      {prob}% Bestehenschance
    </Badge>
  );
}
