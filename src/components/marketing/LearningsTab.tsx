import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Lightbulb } from 'lucide-react';

const impactColors: Record<string, string> = {
  product: 'bg-info-bg-subtle text-info',
  pricing: 'bg-success-bg-subtle text-success',
  messaging: 'bg-petrol-100 text-petrol-700',
  channel: 'bg-warning-bg-subtle text-warning',
  targeting: 'bg-mint-100 text-petrol-800',
  didactics: 'bg-warning-bg-subtle text-warning',
};

export default function LearningsTab() {
  const { data: learnings, isLoading } = useQuery({
    queryKey: ['marketing-learnings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_learnings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">Feedback-Loop: Sales → Produkt, Abbrüche → Didaktik, Fragen → neue Inhalte</p>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {learnings?.map((l) => (
          <Card key={l.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-xs">{l.source_type}</Badge>
                  <span className={`text-xs px-2 py-0.5 rounded ${impactColors[l.impact_area] || ''}`}>{l.impact_area}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium mb-2">{l.learning}</p>
              {l.action_taken && (
                <p className="text-xs text-muted-foreground border-l-2 pl-2">{l.action_taken}</p>
              )}
            </CardContent>
          </Card>
        ))}
        {learnings?.length === 0 && (
          <Card className="col-span-full py-8">
            <CardContent className="text-center text-muted-foreground">Noch keine Learnings erfasst</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
