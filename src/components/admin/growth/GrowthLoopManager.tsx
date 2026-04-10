import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Play, RotateCcw, Eye, AlertTriangle, CheckCircle, Clock, Zap, TrendingUp, DollarSign, Users, Share2 } from 'lucide-react';
import { toast } from 'sonner';

const statusColors: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  researching: 'bg-blue-500/10 text-blue-600',
  generating: 'bg-purple-500/10 text-purple-600',
  validating: 'bg-amber-500/10 text-amber-600',
  done: 'bg-green-500/10 text-green-600',
  failed: 'bg-destructive/10 text-destructive',
};

export default function GrowthLoopManager() {
  const [activeTab, setActiveTab] = useState('pipeline');
  const qc = useQueryClient();

  // Content Pipeline Jobs
  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: ['content-generation-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_generation_jobs' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  // Growth Dashboard Summary
  const { data: dashboardSummary } = useQuery({
    queryKey: ['growth-dashboard-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_get_growth_dashboard_summary' as any);
      if (error) throw error;
      return data as any;
    },
  });

  // Revenue Profiles
  const { data: revenueProfiles } = useQuery({
    queryKey: ['revenue-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_revenue_profile' as any)
        .select('*')
        .order('purchase_probability', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  // Offers
  const { data: offers } = useQuery({
    queryKey: ['active-offers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers' as any)
        .select('*')
        .order('priority', { ascending: true })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  // Retention Actions
  const { data: retentionActions } = useQuery({
    queryKey: ['retention-actions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('retention_actions' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  // Run pipeline
  const runPipeline = useMutation({
    mutationFn: async (jobId?: string) => {
      const { data, error } = await supabase.functions.invoke('run-content-pipeline', {
        body: jobId ? { job_id: jobId } : { limit: 5 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Pipeline: ${data.processed} Jobs verarbeitet`);
      qc.invalidateQueries({ queryKey: ['content-generation-jobs'] });
    },
    onError: (e) => toast.error(`Pipeline-Fehler: ${e.message}`),
  });

  // Compute revenue profiles
  const computeProfiles = useMutation({
    mutationFn: async (_unused?: unknown) => {
      const { data, error } = await supabase.functions.invoke('compute-revenue-profiles', {
        body: { limit: 100 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.computed} Revenue-Profile berechnet`);
      qc.invalidateQueries({ queryKey: ['revenue-profiles'] });
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const summary = dashboardSummary ?? {};

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <KPICard icon={<Share2 className="h-4 w-4" />} label="Shares 30d" value={summary.total_shares_30d ?? 0} />
        <KPICard icon={<Users className="h-4 w-4" />} label="Referrals 30d" value={summary.total_referrals_30d ?? 0} />
        <KPICard icon={<DollarSign className="h-4 w-4" />} label="Conversions 30d" value={summary.total_conversions_30d ?? 0} />
        <KPICard icon={<TrendingUp className="h-4 w-4" />} label="Ø Virality" value={Number(summary.avg_virality_score ?? 0).toFixed(1)} />
        <KPICard icon={<Zap className="h-4 w-4" />} label="Content Jobs" value={`${summary.content_jobs_done ?? 0}/${(summary.content_jobs_queued ?? 0) + (summary.content_jobs_done ?? 0)}`} />
        <KPICard icon={<AlertTriangle className="h-4 w-4" />} label="Failed" value={summary.content_jobs_failed ?? 0} color="destructive" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="pipeline" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Zap className="h-3 w-3" /> Content Pipeline
          </TabsTrigger>
          <TabsTrigger value="revenue" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <DollarSign className="h-3 w-3" /> Revenue
          </TabsTrigger>
          <TabsTrigger value="offers" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <TrendingUp className="h-3 w-3" /> Offers
          </TabsTrigger>
          <TabsTrigger value="retention" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg">
            <Users className="h-3 w-3" /> Retention
          </TabsTrigger>
        </TabsList>

        {/* Content Pipeline Tab */}
        <TabsContent value="pipeline" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">AI Content Pipeline</h3>
            <Button size="sm" onClick={() => runPipeline.mutate()} disabled={runPipeline.isPending}>
              {runPipeline.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              Pipeline starten
            </Button>
          </div>

          {jobsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !jobs?.length ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Keine Content-Jobs vorhanden</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {jobs.map((job: any) => (
                <Card key={job.id} className="border">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px]">{job.content_type}</Badge>
                          <Badge className={`text-[10px] ${statusColors[job.status] ?? ''}`}>{job.status}</Badge>
                          <Badge variant="outline" className="text-[10px]">{job.pipeline_step}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {job.input_payload?.keyword ?? job.id}
                        </p>
                        {job.error && (
                          <p className="text-[10px] text-destructive mt-1 truncate">{job.error}</p>
                        )}
                        {job.quality_scores?.overall != null && (
                          <div className="flex gap-2 mt-1">
                            <span className="text-[10px] text-muted-foreground">SEO: {job.quality_scores.seo}</span>
                            <span className="text-[10px] text-muted-foreground">Didaktik: {job.quality_scores.didaktik}</span>
                            <span className="text-[10px] text-muted-foreground">Conversion: {job.quality_scores.conversion}</span>
                            <span className="text-[10px] font-medium">Gesamt: {job.quality_scores.overall}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {job.status === 'failed' && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => runPipeline.mutate(job.id)}>
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Revenue Tab */}
        <TabsContent value="revenue" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">User Revenue Profiles</h3>
            <Button size="sm" onClick={() => computeProfiles.mutate()} disabled={computeProfiles.isPending}>
              {computeProfiles.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
              Profile berechnen
            </Button>
          </div>

          <div className="space-y-2">
            {revenueProfiles?.map((p: any) => (
              <Card key={p.id} className="border">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-mono truncate w-48">{p.user_id?.substring(0, 8)}...</p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="outline" className="text-[10px]">Risk: {p.risk_level}</Badge>
                        <Badge variant="outline" className="text-[10px]">Sensitivity: {p.price_sensitivity}</Badge>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{Number(p.purchase_probability).toFixed(0)}%</p>
                      <p className="text-[10px] text-muted-foreground">Kaufwahrsch.</p>
                      <p className="text-xs mt-1">LTV: €{Number(p.ltv_estimate).toFixed(0)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!revenueProfiles?.length && (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Keine Revenue-Profile vorhanden. Klicke "Profile berechnen".</CardContent></Card>
            )}
          </div>
        </TabsContent>

        {/* Offers Tab */}
        <TabsContent value="offers" className="mt-4 space-y-4">
          <h3 className="text-sm font-semibold">Aktive Angebote</h3>
          <div className="space-y-2">
            {offers?.map((o: any) => (
              <Card key={o.id} className="border">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{o.title}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="outline" className="text-[10px]">{o.offer_type}</Badge>
                        <Badge className={o.status === 'active' ? 'bg-green-500/10 text-green-600 text-[10px]' : 'text-[10px]'}>{o.status}</Badge>
                      </div>
                    </div>
                    <div className="text-right">
                      {o.discount_percentage && <p className="text-sm font-bold text-green-600">-{o.discount_percentage}%</p>}
                      <p className="text-xs">€{o.price ?? '—'} <span className="line-through text-muted-foreground">€{o.original_price ?? '—'}</span></p>
                      <p className="text-[10px] text-muted-foreground">{o.current_claims}/{o.max_claims ?? '∞'} Claims</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!offers?.length && (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Keine Angebote konfiguriert</CardContent></Card>
            )}
          </div>
        </TabsContent>

        {/* Retention Tab */}
        <TabsContent value="retention" className="mt-4 space-y-4">
          <h3 className="text-sm font-semibold">Retention Actions</h3>
          <div className="space-y-2">
            {retentionActions?.map((a: any) => (
              <Card key={a.id} className="border">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-[10px]">{a.action_type}</Badge>
                        {a.executed ? (
                          <Badge className="bg-green-500/10 text-green-600 text-[10px]"><CheckCircle className="h-2.5 w-2.5 mr-0.5" /> Ausgeführt</Badge>
                        ) : (
                          <Badge className="bg-amber-500/10 text-amber-600 text-[10px]"><Clock className="h-2.5 w-2.5 mr-0.5" /> Offen</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{a.reason}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleDateString('de')}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!retentionActions?.length && (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Keine Retention-Aktionen</CardContent></Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KPICard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color?: string }) {
  return (
    <Card className="border">
      <CardContent className="py-3 px-3">
        <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">{icon}<span className="text-[10px]">{label}</span></div>
        <p className={`text-lg font-bold ${color === 'destructive' ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
