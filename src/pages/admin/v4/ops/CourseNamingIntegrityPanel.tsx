import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Loader2 } from 'lucide-react';

type CourseNameCollision = {
  canonical_title_norm: string;
  cnt: number;
  package_ids: string[];
  canonical_titles: string[];
};

type InvalidCourseTitle = {
  package_id: string;
  status: string | null;
  raw_course_title: string | null;
  raw_curriculum_title: string | null;
  canonical_title: string;
  canonical_title_norm: string;
  created_at: string | null;
};

function HealthBadge({ tone, label }: { tone: 'green' | 'yellow' | 'red'; label: string }) {
  const variant = tone === 'green' ? 'default' : tone === 'yellow' ? 'secondary' : 'destructive';
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

export default function CourseNamingIntegrityPanel() {
  const { data: collisions, isLoading: cLoading, refetch: refetchC } = useQuery({
    queryKey: ['ops-course-name-collisions'],
    queryFn: async (): Promise<CourseNameCollision[]> => {
      const { data, error } = await (supabase as any)
        .from('v_ops_course_name_collisions')
        .select('*')
        .order('cnt', { ascending: false });
      if (error) throw error;
      return (data || []) as CourseNameCollision[];
    },
    refetchInterval: 60_000,
  });

  const { data: invalidTitles, isLoading: iLoading, refetch: refetchI } = useQuery({
    queryKey: ['ops-invalid-course-titles'],
    queryFn: async (): Promise<InvalidCourseTitle[]> => {
      const { data, error } = await (supabase as any)
        .from('v_ops_invalid_course_titles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as InvalidCourseTitle[];
    },
    refetchInterval: 60_000,
  });

  const isLoading = cLoading || iLoading;
  const collisionCount = collisions?.length || 0;
  const invalidCount = invalidTitles?.length || 0;
  const overallTone = collisionCount > 0 ? 'red' as const : invalidCount > 0 ? 'yellow' as const : 'green' as const;
  const OverallIcon = overallTone === 'green' ? CheckCircle2 : overallTone === 'yellow' ? AlertTriangle : XCircle;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Course Naming Integrity</h2>
          <p className="text-xs text-muted-foreground">Überwacht doppelte kanonische Kurse und inkonsistente Roh-Titel.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refetchC(); refetchI(); }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Aktualisieren
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={overallTone === 'green' ? 'default' : 'destructive'} className="gap-1">
          <OverallIcon className="h-3 w-3" />
          {overallTone === 'green' ? 'Gesund' : overallTone === 'yellow' ? 'Achtung' : 'Problem'}
        </Badge>
        <HealthBadge tone={collisionCount === 0 ? 'green' : 'red'} label={`Kollisionen: ${collisionCount}`} />
        <HealthBadge tone={invalidCount === 0 ? 'green' : 'yellow'} label={`Abweichende Titel: ${invalidCount}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Kanonische Kollisionen</h3>
              <HealthBadge tone={collisionCount === 0 ? 'green' : 'red'} label={collisionCount === 0 ? '0 Probleme' : `${collisionCount} Treffer`} />
            </div>
            {collisionCount === 0 ? (
              <p className="text-sm text-muted-foreground">Keine doppelten kanonischen Kurse gefunden.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {collisions!.slice(0, 20).map((row) => (
                  <div key={row.canonical_title_norm} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">{row.canonical_titles?.[0] || row.canonical_title_norm}</p>
                    <p className="text-xs text-muted-foreground mt-1">Norm: {row.canonical_title_norm}</p>
                    <p className="text-xs mt-1">Anzahl: <span className="font-semibold">{row.cnt}</span></p>
                    <p className="text-xs text-muted-foreground mt-1 truncate">IDs: {(row.package_ids || []).slice(0, 3).join(', ')}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Abweichende Roh-Titel</h3>
              <HealthBadge tone={invalidCount === 0 ? 'green' : 'yellow'} label={invalidCount === 0 ? '0 Treffer' : `${invalidCount} Treffer`} />
            </div>
            {invalidCount === 0 ? (
              <p className="text-sm text-muted-foreground">Keine abweichenden Roh-Titel gefunden.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {invalidTitles!.slice(0, 20).map((row) => (
                  <div key={`${row.package_id}-${row.created_at}`} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">{row.canonical_title}</p>
                    <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                      <span>Status: {row.status || 'unbekannt'}</span>
                      <span>Raw Course: {row.raw_course_title || '—'}</span>
                      <span>Raw Curriculum: {row.raw_curriculum_title || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
