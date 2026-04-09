import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, AlertTriangle, TrendingUp, Search, Link2, Target, RefreshCw, FileText, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface ContentAudit {
  id: string;
  content_type: string;
  content_id: string;
  content_url: string | null;
  content_title: string | null;
  seo_score: number;
  intent_match_score: number;
  conversion_score: number;
  completeness_score: number;
  interlink_score: number;
  refresh_risk_score: number;
  overall_score: number;
  issues: any[];
  recommendations: any[];
  cannibalization_risk: any;
  schema_recommendation: string | null;
  audited_at: string;
}

const scoreColor = (s: number) => s >= 80 ? 'text-emerald-500' : s >= 50 ? 'text-amber-500' : 'text-red-500';
const scoreBg = (s: number) => s >= 80 ? 'bg-emerald-500' : s >= 50 ? 'bg-amber-500' : 'bg-red-500';

export default function SEOAuditManager() {
  const qc = useQueryClient();
  const { data: audits = [], isLoading } = useQuery({
    queryKey: ['seo-content-audits'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_content_audits' as any)
        .select('*').order('audited_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ContentAudit[];
    },
  });

  const runAuditMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('seo-discovery-engine', {
        body: { action: 'keyword_opportunity_score' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['seo-content-audits'] });
      toast.success(`Opportunity Scores: ${data?.updated || 0} Keywords aktualisiert`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cannibalizationMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('seo-discovery-engine', {
        body: { action: 'cannibalization_detect' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Kannibalisierung: ${data?.issues_found || 0} Issues gefunden`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const avgScore = audits.length > 0 ? Math.round(audits.reduce((s, a) => s + a.overall_score, 0) / audits.length) : 0;
  const issues = audits.reduce((s, a) => s + ((a.issues as any[])?.length || 0), 0);
  const cannibalizationCount = audits.filter(a => a.cannibalization_risk).length;

  if (isLoading) return <Card><CardContent className="py-10"><Skeleton className="h-40 w-full" /></CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 mb-2">
        <Button size="sm" className="h-8 text-xs gap-1"
          onClick={() => runAuditMutation.mutate()}
          disabled={runAuditMutation.isPending}>
          <Zap className="h-3 w-3" />
          {runAuditMutation.isPending ? 'Berechne...' : 'Opportunity Scores'}
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
          onClick={() => cannibalizationMutation.mutate()}
          disabled={cannibalizationMutation.isPending}>
          <AlertTriangle className="h-3 w-3" />
          {cannibalizationMutation.isPending ? 'Prüfe...' : 'Kannibalisierung prüfen'}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className={`text-2xl font-bold ${scoreColor(avgScore)}`}>{avgScore}%</div>
          <div className="text-xs text-muted-foreground">Ø SEO Score</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-primary">{audits.length}</div>
          <div className="text-xs text-muted-foreground">Audited Pages</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-amber-500">{issues}</div>
          <div className="text-xs text-muted-foreground">Issues gesamt</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-red-500">{cannibalizationCount}</div>
          <div className="text-xs text-muted-foreground">Kannibalisierung</div>
        </CardContent></Card>
      </div>

      {audits.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">
          <Search className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
          Keine SEO-Audits vorhanden. Audits werden automatisch bei Content-Änderungen erstellt.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {audits.map(audit => (
            <Card key={audit.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{audit.content_title || audit.content_url || 'Untitled'}</span>
                      <Badge variant="secondary" className="text-[10px]">{audit.content_type}</Badge>
                      {audit.schema_recommendation && (
                        <Badge variant="outline" className="text-[10px]">Schema: {audit.schema_recommendation}</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-2">
                      {[
                        { label: 'SEO', score: audit.seo_score, icon: <Search className="h-3 w-3" /> },
                        { label: 'Intent', score: audit.intent_match_score, icon: <Target className="h-3 w-3" /> },
                        { label: 'Conversion', score: audit.conversion_score, icon: <TrendingUp className="h-3 w-3" /> },
                        { label: 'Vollständig', score: audit.completeness_score, icon: <FileText className="h-3 w-3" /> },
                        { label: 'Links', score: audit.interlink_score, icon: <Link2 className="h-3 w-3" /> },
                        { label: 'Refresh', score: audit.refresh_risk_score, icon: <RefreshCw className="h-3 w-3" /> },
                      ].map(({ label, score, icon }) => (
                        <div key={label} className="text-center">
                          <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                            {icon} {label}
                          </div>
                          <Progress value={score} className="h-1.5" />
                          <div className={`text-[10px] font-medium mt-0.5 ${scoreColor(score)}`}>{score}</div>
                        </div>
                      ))}
                    </div>
                    {(audit.issues as any[])?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(audit.issues as any[]).slice(0, 3).map((issue: any, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px] text-amber-600">
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                            {typeof issue === 'string' ? issue : issue.message || JSON.stringify(issue)}
                          </Badge>
                        ))}
                        {(audit.issues as any[]).length > 3 && (
                          <Badge variant="outline" className="text-[10px]">+{(audit.issues as any[]).length - 3} mehr</Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={`text-2xl font-bold ${scoreColor(audit.overall_score)}`}>
                    {audit.overall_score}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
