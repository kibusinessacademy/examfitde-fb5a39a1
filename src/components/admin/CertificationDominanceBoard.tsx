import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Loader2, RefreshCw, Target, Shield, BarChart3,
  CheckCircle2, ArrowRight, Crown, Zap, AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CertMaster {
  id: string;
  name: string;
  cluster: string;
  traeger: string;
  track: string;
  pruefungsart: string;
  min_fragen_target: number;
  oral_required: boolean;
  dominance_phase: string;
  dominance_score: number;
  dominance_criteria: any;
  seeding_status: string;
  priority_rank: number;
  wave: number;
  marktgroesse: string;
  wettbewerb_level: string;
  seo_ranking_keywords: number;
  user_reviews_count: number;
  conversion_rate: number;
  deep_audit_passes: number;
  last_dominance_eval_at: string | null;
}

const PHASE_CONFIG: Record<string, { label: string; icon: any; color: string; step: number }> = {
  phase_0: { label: 'Nicht gestartet', icon: Target, color: 'text-muted-foreground', step: 0 },
  phase_1_analyse: { label: 'Analyse & Architektur', icon: BarChart3, color: 'text-blue-500', step: 1 },
  phase_2_seeding: { label: 'Hardcore Seeding', icon: Zap, color: 'text-amber-500', step: 2 },
  phase_3_quality: { label: 'Qualitätsdominanz', icon: Shield, color: 'text-purple-500', step: 3 },
  phase_4_ux: { label: 'Exam UX Dominanz', icon: Target, color: 'text-cyan-500', step: 4 },
  phase_5_authority: { label: 'Authority Layer', icon: Crown, color: 'text-orange-500', step: 5 },
  dominated: { label: 'DOMINIERT', icon: CheckCircle2, color: 'text-emerald-500', step: 6 },
};

const CLUSTER_LABELS: Record<string, string> = {
  ihk_aufstieg: '🏆 IHK Aufstieg',
  sachkunde: '📋 Sachkunde',
  meister_hwk: '🔧 Meister/HWK',
  aevo: '👨‍🏫 AEVO',
  projektmanagement: '📊 Projektmanagement',
  tuev_branche: '🏢 TÜV/Branche',
};

const MARKET_COLORS: Record<string, string> = {
  sehr_gross: 'bg-emerald-500/20 text-emerald-600',
  gross: 'bg-blue-500/20 text-blue-600',
  mittel: 'bg-amber-500/20 text-amber-600',
  klein: 'bg-muted text-muted-foreground',
};

export default function CertificationDominanceBoard() {
  const [certs, setCerts] = useState<CertMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [clusterFilter, setClusterFilter] = useState('all');
  const [waveFilter, setWaveFilter] = useState<number | 'all'>('all');

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('german_certification_master')
      .select('*')
      .order('priority_rank', { ascending: true });
    setCerts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const evaluateSingle = async (id: string) => {
    setEvaluating(id);
    try {
      const { data, error } = await (supabase as any).rpc('evaluate_certification_dominance', {
        p_cert_master_id: id,
      });
      if (error) throw error;
      toast.success(`${data.name}: Score ${data.score} → ${data.phase}`);
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setEvaluating(null);
    }
  };

  const evaluateAll = async () => {
    setEvaluating('all');
    let count = 0;
    for (const c of certs) {
      await (supabase as any).rpc('evaluate_certification_dominance', {
        p_cert_master_id: c.id,
      });
      count++;
    }
    toast.success(`${count} Zertifizierungen evaluiert`);
    setEvaluating(null);
    load();
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  const filtered = certs.filter(c => {
    if (clusterFilter !== 'all' && c.cluster !== clusterFilter) return false;
    if (waveFilter !== 'all' && c.wave !== waveFilter) return false;
    return true;
  });

  const dominated = certs.filter(c => c.dominance_phase === 'dominated').length;
  const avgScore = certs.length > 0
    ? Math.round(certs.reduce((s, c) => s + (c.dominance_score || 0), 0) / certs.length)
    : 0;
  const clusters = [...new Set(certs.map(c => c.cluster))];
  const waves = [...new Set(certs.map(c => c.wave))].sort();

  return (
    <div className="space-y-6">
      {/* Overview KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Zertifizierungen</p>
            <p className="text-2xl font-bold text-foreground">{certs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Dominiert</p>
            <p className="text-2xl font-bold text-emerald-500">{dominated}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ø Score</p>
            <p className="text-2xl font-bold text-primary">{avgScore}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">In Seeding</p>
            <p className="text-2xl font-bold text-amber-500">
              {certs.filter(c => c.dominance_phase === 'phase_2_seeding').length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + Actions */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground">Cluster:</span>
        <Button size="sm" variant={clusterFilter === 'all' ? 'default' : 'outline'} className="text-xs h-7"
          onClick={() => setClusterFilter('all')}>Alle</Button>
        {clusters.map(c => (
          <Button key={c} size="sm" variant={clusterFilter === c ? 'default' : 'outline'} className="text-xs h-7"
            onClick={() => setClusterFilter(c)}>
            {CLUSTER_LABELS[c] || c}
          </Button>
        ))}

        <span className="text-xs text-muted-foreground ml-3">Wave:</span>
        <Button size="sm" variant={waveFilter === 'all' ? 'default' : 'outline'} className="text-xs h-7"
          onClick={() => setWaveFilter('all')}>Alle</Button>
        {waves.map(w => (
          <Button key={w} size="sm" variant={waveFilter === w ? 'default' : 'outline'} className="text-xs h-7"
            onClick={() => setWaveFilter(w)}>Wave {w}</Button>
        ))}

        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={evaluateAll} disabled={evaluating === 'all'}>
            {evaluating === 'all' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Target className="h-3.5 w-3.5 mr-1" />}
            Alle evaluieren
          </Button>
        </div>
      </div>

      {/* Certification cards */}
      <div className="space-y-2">
        {filtered.map(cert => {
          const phase = PHASE_CONFIG[cert.dominance_phase] || PHASE_CONFIG.phase_0;
          const PhaseIcon = phase.icon;
          const criteria = cert.dominance_criteria || {};
          const contentOk = criteria.content?.ok;
          const techOk = criteria.tech?.ok;
          const marketOk = criteria.market?.ok;
          const phasePct = (phase.step / 6) * 100;

          return (
            <Card key={cert.id} className={cn(
              cert.dominance_phase === 'dominated' && 'border-emerald-500/50 bg-emerald-500/5'
            )}>
              <CardContent className="py-3">
                <div className="flex items-start gap-3">
                  {/* Phase icon */}
                  <div className={cn("mt-0.5", phase.color)}>
                    <PhaseIcon className="h-5 w-5" />
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{cert.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {CLUSTER_LABELS[cert.cluster] || cert.cluster}
                      </Badge>
                      <Badge variant="outline" className={cn("text-[10px]", MARKET_COLORS[cert.marktgroesse] || '')}>
                        {cert.marktgroesse || '?'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">W{cert.wave}</Badge>
                      {cert.oral_required && (
                        <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-600">Oral</Badge>
                      )}
                    </div>

                    {/* Phase progress */}
                    <div className="flex items-center gap-2">
                      <Progress value={phasePct} className="h-1.5 flex-1 max-w-64" />
                      <span className={cn("text-xs font-medium", phase.color)}>{phase.label}</span>
                    </div>

                    {/* Criteria chips */}
                    {cert.dominance_score > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <CriteriaChip label="Inhalt" ok={contentOk}
                          detail={`${criteria.content?.question_count || 0}/${criteria.content?.target || cert.min_fragen_target}`} />
                        <CriteriaChip label="Technik" ok={techOk}
                          detail={`C:${criteria.tech?.confidence || 0} G:${criteria.tech?.governance || 0}`} />
                        <CriteriaChip label="Markt" ok={marketOk}
                          detail={`SEO:${criteria.market?.seo_keywords || 0} Rev:${criteria.market?.reviews || 0}`} />
                      </div>
                    )}
                  </div>

                  {/* Score + Action */}
                  <div className="text-right flex flex-col items-end gap-1">
                    <div className={cn(
                      "text-lg font-bold",
                      cert.dominance_score >= 80 ? 'text-emerald-500' :
                      cert.dominance_score >= 50 ? 'text-amber-500' : 'text-muted-foreground'
                    )}>
                      {cert.dominance_score}
                    </div>
                    <Button size="sm" variant="ghost" className="text-xs h-6 px-2"
                      onClick={() => evaluateSingle(cert.id)}
                      disabled={evaluating === cert.id}>
                      {evaluating === cert.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <RefreshCw className="h-3 w-3" />
                      }
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CriteriaChip({ label, ok, detail }: { label: string; ok?: boolean; detail: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
      ok === true ? 'bg-emerald-500/10 text-emerald-600' :
      ok === false ? 'bg-destructive/10 text-destructive' :
      'bg-muted text-muted-foreground'
    )}>
      {ok === true ? <CheckCircle2 className="h-2.5 w-2.5" /> : ok === false ? <AlertTriangle className="h-2.5 w-2.5" /> : null}
      {label}: {detail}
    </span>
  );
}
