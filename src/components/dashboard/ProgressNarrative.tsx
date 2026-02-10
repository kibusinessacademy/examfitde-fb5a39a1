import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, TrendingUp, Award, Clock } from 'lucide-react';

export default function ProgressNarrative() {
  const { user } = useAuth();

  const { data: narratives } = useQuery({
    queryKey: ['progress-narratives', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('progress_narratives')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!user
  });

  const { data: referralCode } = useQuery({
    queryKey: ['my-referral', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('learner_referrals')
        .select('referral_code, status')
        .eq('referrer_user_id', user!.id)
        .limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!user
  });

  if (!narratives?.length) return null;

  const iconMap: Record<string, React.ElementType> = {
    milestone: Award,
    transformation: TrendingUp,
    ritual: Sparkles,
    comparison: Clock,
  };

  return (
    <Card className="glass-card border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Deine Lerngeschichte
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {narratives.map(n => {
          const Icon = iconMap[n.narrative_type] || Sparkles;
          const metrics = n.metrics as Record<string, any> | null;
          return (
            <div key={n.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{n.content}</p>
                {metrics?.before != null && metrics?.after != null && (
                  <div className="flex gap-2 mt-1.5">
                    <Badge variant="outline" className="text-xs">Vorher: {metrics.before}{metrics.unit || ''}</Badge>
                    <Badge variant="default" className="text-xs">Jetzt: {metrics.after}{metrics.unit || ''}</Badge>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Referral prompt */}
        {referralCode && referralCode.length === 0 && (
          <div className="p-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 text-center">
            <p className="text-sm font-medium">Hilf jemandem, dieselbe Prüfung zu bestehen</p>
            <p className="text-xs text-muted-foreground mt-0.5">Teile deinen Lernfortschritt und motiviere andere</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
