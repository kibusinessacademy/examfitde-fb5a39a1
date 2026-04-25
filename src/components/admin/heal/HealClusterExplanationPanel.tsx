import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database, FileText, AlertTriangle } from 'lucide-react';

interface ClusterInfo {
  cluster: string;
  known_via: 'produced_data' | 'view_defn' | 'unknown';
  in_produced_data: boolean;
  in_view_defn: boolean;
}
interface ExplanationData {
  clusters: ClusterInfo[];
  view_def_length: number;
  produced_clusters_total: number;
  fetched_at: string;
}

export function HealClusterExplanationPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['heal-cluster-explanation'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_healcheck_cluster_explanation');
      if (error) throw error;
      return data as unknown as ExplanationData;
    },
    refetchInterval: 60_000,
  });

  const knownViaIcon = (via: ClusterInfo['known_via']) => {
    if (via === 'produced_data')
      return <Badge variant="default" className="bg-success text-success-foreground">
        <Database className="w-3 h-3 mr-1" />produziert
      </Badge>;
    if (via === 'view_defn')
      return <Badge variant="secondary">
        <FileText className="w-3 h-3 mr-1" />view-defn
      </Badge>;
    return <Badge variant="destructive">
      <AlertTriangle className="w-3 h-3 mr-1" />unbekannt
    </Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Heal-Cluster Erklärung</CardTitle>
        <p className="text-xs text-muted-foreground">
          Zeigt für jeden bekannten Cluster, ob er aktuell durch produzierte Daten
          oder nur durch die statische View-Definition (<code>pg_get_viewdef</code>)
          als bekannt gilt. <em>view_defn</em>-Cluster sind potenziell veraltet.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="text-sm text-muted-foreground">Lade …</div>}
        {data && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {data.produced_clusters_total} produzierte Cluster · view_def {data.view_def_length}b ·
              Stand {new Date(data.fetched_at).toLocaleString('de-DE')}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.clusters.map((c) => (
                <div key={c.cluster} className="border rounded p-2 flex items-center gap-2 text-xs">
                  <code className="flex-1 truncate">{c.cluster}</code>
                  {knownViaIcon(c.known_via)}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
