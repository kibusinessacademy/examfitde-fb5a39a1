import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { FlaskConical, Trophy } from 'lucide-react';

export default function ExperimentsTab() {
  const { data: experiments, isLoading } = useQuery({
    queryKey: ['marketing-experiments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_experiments')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">A/B-Tests & Experimente – max. 1-2 parallel, schnelle Entscheidungen</p>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Laufend</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{experiments?.filter(e => e.status === 'running').length || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Abgeschlossen</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{experiments?.filter(e => e.status === 'completed').length || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Geplant</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{experiments?.filter(e => e.status === 'planned').length || 0}</div></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {experiments?.map((exp) => (
          <Card key={exp.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FlaskConical className="h-4 w-4" />
                  {exp.name}
                </CardTitle>
                <Badge variant={exp.status === 'running' ? 'default' : exp.status === 'completed' ? 'secondary' : 'outline'}>
                  {exp.status}
                </Badge>
              </div>
              <CardDescription>{exp.hypothesis}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Sample: {exp.current_sample_size} / {exp.sample_size_target}</span>
                  {exp.confidence_level && <span>Konfidenz: {exp.confidence_level}%</span>}
                </div>
                <Progress value={(exp.current_sample_size / exp.sample_size_target) * 100} />
              </div>
              {exp.winner && (
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Trophy className="h-4 w-4 text-primary" />
                  Gewinner: Variante {exp.winner.toUpperCase()}
                </div>
              )}
              {exp.learnings && (
                <p className="text-sm text-muted-foreground border-l-2 pl-3">{exp.learnings}</p>
              )}
            </CardContent>
          </Card>
        ))}
        {experiments?.length === 0 && (
          <Card className="col-span-full py-8">
            <CardContent className="text-center text-muted-foreground">Noch keine Experimente</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
