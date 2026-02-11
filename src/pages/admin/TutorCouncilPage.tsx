import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Bot, Mic, MessageSquare, ClipboardCheck, Play,
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw
} from 'lucide-react';

const ASSET_TYPE_LABELS: Record<string, { label: string; icon: typeof Bot }> = {
  tutor_template: { label: 'Tutor-Templates', icon: Bot },
  oral_exam_prompt: { label: 'Mündliche Prüfung', icon: Mic },
  oral_exam_rubric: { label: 'Bewertungsraster', icon: ClipboardCheck },
  feedback_template: { label: 'Feedback-Templates', icon: MessageSquare },
};

const STATUS_BADGES: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  proposed: { variant: 'outline', label: 'Vorgeschlagen' },
  under_review: { variant: 'secondary', label: 'Im Review' },
  revise: { variant: 'default', label: 'Überarbeitung' },
  approved: { variant: 'default', label: 'Freigegeben' },
  rejected: { variant: 'destructive', label: 'Abgelehnt' },
};

export default function TutorCouncilPage() {
  const [activeTab, setActiveTab] = useState('assets');
  const queryClient = useQueryClient();

  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['tutor-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tutor_assets')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: verdicts } = useQuery({
    queryKey: ['tutor-verdicts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('council_verdicts')
        .select('*, content_versions!inner(entity_type, entity_id, council_round, created_at, created_by_agent)')
        .eq('content_versions.entity_type', 'tutor_asset')
        .order('decided_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const runCouncil = useMutation({
    mutationFn: async (assetId: string) => {
      const { data, error } = await supabase.functions.invoke('tutor-council-run', {
        body: { assetId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const decision = (data as Record<string, unknown>)?.decision as Record<string, unknown> | undefined;
      toast.success(`Council abgeschlossen: ${decision?.finalDecision ?? 'done'}`);
      queryClient.invalidateQueries({ queryKey: ['tutor-assets'] });
      queryClient.invalidateQueries({ queryKey: ['tutor-verdicts'] });
    },
    onError: (err) => toast.error(`Council-Fehler: ${err.message}`),
  });

  const publishedCount = assets?.filter(a => a.is_published).length ?? 0;
  const pendingCount = assets?.filter(a => !a.is_published).length ?? 0;
  const totalCount = assets?.length ?? 0;

  const assetsByType = (type: string) => assets?.filter(a => a.asset_type === type) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Tutor Council (Council 5)</h2>
          <p className="text-sm text-muted-foreground">
            Didaktische Templates, Oral-Exam-Prompts & Feedback – deliberativ freigegeben
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            {publishedCount} published
          </Badge>
          <Badge variant="outline" className="gap-1">
            <AlertTriangle className="h-3 w-3 text-yellow-500" />
            {pendingCount} pending
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(ASSET_TYPE_LABELS).map(([type, { label, icon: Icon }]) => {
          const items = assetsByType(type);
          const pub = items.filter(a => a.is_published).length;
          return (
            <Card key={type}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground">{label}</span>
                </div>
                <div className="text-xl font-bold">{items.length}</div>
                <div className="text-xs text-muted-foreground">{pub} freigegeben</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="assets">Assets ({totalCount})</TabsTrigger>
          <TabsTrigger value="inbox">Review Inbox</TabsTrigger>
          <TabsTrigger value="oral">Oral Exam</TabsTrigger>
          <TabsTrigger value="verdicts">Verdicts</TabsTrigger>
        </TabsList>

        {/* Assets Tab */}
        <TabsContent value="assets" className="space-y-3">
          {assetsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !assets?.length ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Keine Tutor-Assets vorhanden. Starte einen Seed-Job um Templates zu erstellen.
              </CardContent>
            </Card>
          ) : (
            assets.map(asset => (
              <Card key={asset.id}>
                <CardContent className="py-3 px-4 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{asset.title}</span>
                      <Badge variant="outline" className="text-xs">{asset.asset_type}</Badge>
                      {asset.is_published ? (
                        <Badge variant="default" className="text-xs bg-green-600">Published</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Draft</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Scope: {asset.scope_type}{asset.scope_id ? ` → ${(asset.scope_id as string).slice(0, 8)}…` : ''} · {asset.locale}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runCouncil.mutate(asset.id)}
                    disabled={runCouncil.isPending}
                    className="ml-2"
                  >
                    {runCouncil.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    <span className="ml-1">Council</span>
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Review Inbox */}
        <TabsContent value="inbox" className="space-y-3">
          {assets?.filter(a => !a.is_published).length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Keine Assets im Review. Alle sind freigegeben oder es gibt noch keine.
              </CardContent>
            </Card>
          ) : (
            assets?.filter(a => !a.is_published).map(asset => (
              <Card key={asset.id}>
                <CardContent className="py-3 px-4 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">{asset.title}</span>
                    <div className="text-xs text-muted-foreground">
                      {ASSET_TYPE_LABELS[asset.asset_type]?.label ?? asset.asset_type} · {asset.scope_type}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => runCouncil.mutate(asset.id)}
                    disabled={runCouncil.isPending}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Run Council
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Oral Exam Tab */}
        <TabsContent value="oral" className="space-y-3">
          {(() => {
            const oralAssets = [...assetsByType('oral_exam_prompt'), ...assetsByType('oral_exam_rubric')];
            if (oralAssets.length === 0) {
              return (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Keine Oral-Exam-Assets. Erstelle Prompts & Rubrics über den Seed-Job.
                  </CardContent>
                </Card>
              );
            }
            return oralAssets.map(asset => (
              <Card key={asset.id}>
                <CardContent className="py-3 px-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      {asset.asset_type === 'oral_exam_prompt' ? (
                        <Mic className="h-4 w-4 text-primary" />
                      ) : (
                        <ClipboardCheck className="h-4 w-4 text-primary" />
                      )}
                      <span className="font-medium text-sm">{asset.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {asset.asset_type === 'oral_exam_prompt' ? 'Prüfungsfrage' : 'Bewertungsraster'} · {asset.scope_type}
                      {asset.is_published && ' · ✅ Published'}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runCouncil.mutate(asset.id)}
                    disabled={runCouncil.isPending}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Council
                  </Button>
                </CardContent>
              </Card>
            ));
          })()}
        </TabsContent>

        {/* Verdicts Tab */}
        <TabsContent value="verdicts" className="space-y-3">
          {!verdicts?.length ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Noch keine Council-Entscheidungen für Tutor-Assets.
              </CardContent>
            </Card>
          ) : (
            verdicts.map((v: Record<string, unknown>) => {
              const cv = v.content_versions as Record<string, unknown> | null;
              const decision = v.final_decision as string;
              return (
                <Card key={v.id as string}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {decision === 'approved' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                        {decision === 'rejected' && <XCircle className="h-4 w-4 text-red-500" />}
                        {decision === 'revise' && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
                        <span className="font-medium text-sm capitalize">{decision}</span>
                        <Badge variant="outline" className="text-xs">
                          Runde {cv?.council_round as number ?? '?'}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {cv?.created_by_agent as string ?? ''} · Score {((v.consensus_score as number) * 100).toFixed(0)}%
                      </span>
                    </div>
                    {v.required_fixes && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Fixes: {JSON.stringify(v.required_fixes).slice(0, 120)}…
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
