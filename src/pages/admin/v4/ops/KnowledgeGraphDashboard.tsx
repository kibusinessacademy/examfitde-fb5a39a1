import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Network, GitBranch, AlertTriangle, BookOpen, Target, Layers } from 'lucide-react';

export default function KnowledgeGraphDashboard() {
  // Node counts by type
  const { data: nodeCounts, isLoading: nodesLoading } = useQuery({
    queryKey: ['kg-node-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_graph_nodes')
        .select('node_type')
        .eq('is_active', true);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        counts[row.node_type] = (counts[row.node_type] || 0) + 1;
      }
      return counts;
    },
    refetchInterval: 30_000,
  });

  // Edge counts by type
  const { data: edgeCounts, isLoading: edgesLoading } = useQuery({
    queryKey: ['kg-edge-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_graph_edges')
        .select('edge_type')
        .eq('is_active', true);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        counts[row.edge_type] = (counts[row.edge_type] || 0) + 1;
      }
      return counts;
    },
    refetchInterval: 30_000,
  });

  // Recent error patterns sample
  const { data: errorPatterns } = useQuery({
    queryKey: ['kg-error-patterns-sample'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_graph_nodes')
        .select('id, label, source_key, created_at')
        .eq('node_type', 'error_pattern')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(15);
      if (error) throw error;
      return data;
    },
  });

  // Coverage: competencies with lowest question counts
  const { data: coverageGaps } = useQuery({
    queryKey: ['kg-coverage-gaps'],
    queryFn: async () => {
      // Get competency nodes
      const { data: compNodes, error: compErr } = await supabase
        .from('knowledge_graph_nodes')
        .select('id, label, source_id')
        .eq('node_type', 'competency')
        .eq('is_active', true)
        .limit(500);
      if (compErr) throw compErr;

      // Get tested_by edges (blueprint → competency) to count blueprints per competency
      const { data: edges, error: edgeErr } = await supabase
        .from('knowledge_graph_edges')
        .select('to_node_id')
        .eq('edge_type', 'tested_by')
        .eq('is_active', true)
        .limit(5000);
      if (edgeErr) throw edgeErr;

      const bpCountMap = new Map<string, number>();
      for (const e of edges || []) {
        bpCountMap.set(e.to_node_id, (bpCountMap.get(e.to_node_id) || 0) + 1);
      }

      // Also count causes_error edges per competency
      const { data: errEdges, error: errEdgeErr } = await supabase
        .from('knowledge_graph_edges')
        .select('to_node_id')
        .eq('edge_type', 'causes_error')
        .eq('is_active', true)
        .limit(5000);
      if (errEdgeErr) throw errEdgeErr;

      const errCountMap = new Map<string, number>();
      for (const e of errEdges || []) {
        errCountMap.set(e.to_node_id, (errCountMap.get(e.to_node_id) || 0) + 1);
      }

      return (compNodes || [])
        .map((n: any) => ({
          id: n.id,
          label: n.label,
          blueprintCount: bpCountMap.get(n.id) || 0,
          errorCount: errCountMap.get(n.id) || 0,
        }))
        .sort((a: any, b: any) => a.blueprintCount - b.blueprintCount)
        .slice(0, 10);
    },
  });

  const isLoading = nodesLoading || edgesLoading;

  const nodeTypeIcons: Record<string, typeof Network> = {
    learning_field: Layers,
    competency: Target,
    blueprint: BookOpen,
    error_pattern: AlertTriangle,
    concept: Network,
  };

  const totalNodes = Object.values(nodeCounts || {}).reduce((a, b) => a + b, 0);
  const totalEdges = Object.values(edgeCounts || {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Knoten gesamt</span>
            </div>
            {isLoading ? <Skeleton className="h-8 w-20 mt-1" /> : (
              <p className="text-2xl font-bold text-foreground">{totalNodes}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Kanten gesamt</span>
            </div>
            {isLoading ? <Skeleton className="h-8 w-20 mt-1" /> : (
              <p className="text-2xl font-bold text-foreground">{totalEdges}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-muted-foreground">Error Patterns</span>
            </div>
            {isLoading ? <Skeleton className="h-8 w-20 mt-1" /> : (
              <p className="text-2xl font-bold text-foreground">{nodeCounts?.error_pattern || 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm text-muted-foreground">Kompetenzen</span>
            </div>
            {isLoading ? <Skeleton className="h-8 w-20 mt-1" /> : (
              <p className="text-2xl font-bold text-foreground">{nodeCounts?.competency || 0}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Node distribution */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Knoten nach Typ</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32" /> : (
              <div className="space-y-2">
                {Object.entries(nodeCounts || {}).sort(([,a], [,b]) => b - a).map(([type, count]) => {
                  const Icon = nodeTypeIcons[type] || Network;
                  const pct = totalNodes ? Math.round((count / totalNodes) * 100) : 0;
                  return (
                    <div key={type} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm text-foreground">{type}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm font-mono text-muted-foreground w-12 text-right">{count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edge distribution */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Kanten nach Typ</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32" /> : (
              <div className="space-y-2">
                {Object.entries(edgeCounts || {}).sort(([,a], [,b]) => b - a).map(([type, count]) => {
                  const pct = totalEdges ? Math.round((count / totalEdges) * 100) : 0;
                  return (
                    <div key={type} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm text-foreground">{type}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm font-mono text-muted-foreground w-12 text-right">{count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Coverage Gaps */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Coverage Gaps — niedrigste Blueprint-Abdeckung</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kompetenz</TableHead>
                <TableHead className="w-24 text-right">Blueprints</TableHead>
                <TableHead className="w-24 text-right">Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(coverageGaps || []).map((gap: any) => (
                <TableRow key={gap.id}>
                  <TableCell className="text-sm max-w-md truncate">{gap.label}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={gap.blueprintCount === 0 ? 'destructive' : gap.blueprintCount < 3 ? 'secondary' : 'default'}>
                      {gap.blueprintCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {gap.errorCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Error Patterns Sample */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Neueste Error Patterns</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead className="w-48">Source Key</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(errorPatterns || []).map((ep: any) => (
                <TableRow key={ep.id}>
                  <TableCell className="text-sm max-w-lg truncate">{ep.label}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-48">
                    {ep.source_key?.slice(0, 40)}…
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
