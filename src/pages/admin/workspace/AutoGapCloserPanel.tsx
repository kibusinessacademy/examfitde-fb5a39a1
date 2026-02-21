import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, Wrench, Shield, Zap, StopCircle, ClipboardCheck, MessageSquare, FileText, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export default function AutoGapCloserPanel({
  packageId, courseId, curriculumId, integrityReport, onRefresh,
}: {
  packageId: string; courseId: string; curriculumId: string;
  integrityReport: any; onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [targetScore, setTargetScore] = useState(85);
  const [autofixRun, setAutofixRun] = useState<any>(null);

  const score = integrityReport?.score ?? 0;
  const deficits = {
    questions: Math.max(0, (integrityReport?.exam?.target || 1000) - (integrityReport?.exam?.total || 0)),
    oral: Math.max(0, (integrityReport?.oral?.target || 20) - (integrityReport?.oral?.total || 0)),
    handbook: Math.max(0, (integrityReport?.handbook?.target || 5) - (integrityReport?.handbook?.chapters || 0)),
    tutor: integrityReport?.tutor_index ? 0 : 1,
  };
  const totalGaps = deficits.questions + deficits.oral + deficits.handbook + deficits.tutor;

  useEffect(() => {
    const fetchRun = async () => {
      const { data } = await (supabase as any).from('autofix_runs')
        .select('*').eq('package_id', packageId).eq('status', 'running')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      setAutofixRun(data);
    };
    fetchRun();
    const iv = setInterval(fetchRun, 10000);
    return () => clearInterval(iv);
  }, [packageId]);

  const handleDryRun = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-gap-close', {
        body: { package_id: packageId, course_id: courseId, curriculum_id: curriculumId, target_score: targetScore, dry_run: true },
      });
      if (error) throw error;
      setDryRunResult(data);
    } catch (e: any) {
      toast.error(`Preview fehlgeschlagen: ${e.message}`);
    } finally { setLoading(false); }
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-gap-close', {
        body: { package_id: packageId, course_id: courseId, curriculum_id: curriculumId, target_score: targetScore },
      });
      if (error) throw error;
      toast.success(`Auto-Fix gestartet (Runde ${data?.round || 1})`);
      setDryRunResult(null);
      onRefresh();
    } catch (e: any) {
      toast.error(`Auto-Fix fehlgeschlagen: ${e.message}`);
    } finally { setLoading(false); }
  };

  const handleStop = async () => {
    if (!autofixRun?.id) return;
    await (supabase as any).from('autofix_runs').update({ status: 'stopped', stop_reason: 'Manuell gestoppt' }).eq('id', autofixRun.id);
    setAutofixRun(null);
    toast.info('Auto-Fix gestoppt');
    onRefresh();
  };

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Wrench className="h-4 w-4 text-warning" /> Auto-Gap-Closer</span>
          <Badge variant="outline" className="text-xs">Score: {score}/100 → Ziel: {targetScore}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Fragen', gap: deficits.questions, icon: ClipboardCheck },
            { label: 'Oral', gap: deficits.oral, icon: MessageSquare },
            { label: 'Handbuch', gap: deficits.handbook, icon: FileText },
            { label: 'Tutor', gap: deficits.tutor, icon: Bot },
          ].map(d => (
            <div key={d.label} className={cn("rounded-lg border px-3 py-2 text-center",
              d.gap === 0 ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5")}>
              <d.icon className={cn("h-3.5 w-3.5 mx-auto mb-1", d.gap === 0 ? "text-success" : "text-warning")} />
              <p className="text-xs font-medium">{d.label}</p>
              <p className={cn("text-sm font-bold", d.gap === 0 ? "text-success" : "text-warning")}>{d.gap === 0 ? '✓' : `-${d.gap}`}</p>
            </div>
          ))}
        </div>

        {autofixRun && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin text-primary" /> Auto-Fix läuft</span>
              <Badge variant="outline" className="text-[10px]">Runde {autofixRun.current_round}/{autofixRun.max_rounds}</Badge>
            </div>
            {autofixRun.last_score != null && (
              <div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">Letzter Score:</span><span className="font-bold">{autofixRun.last_score}/100</span></div>
            )}
            <Button variant="outline" size="sm" onClick={handleStop} className="text-xs h-7 text-destructive border-destructive/30">
              <StopCircle className="h-3 w-3 mr-1" /> Stoppen
            </Button>
          </div>
        )}

        {dryRunResult?.plan && (
          <div className="bg-muted/30 border border-border/30 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium">Fix-Plan (Preview):</p>
            {dryRunResult.plan.actions?.map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{a.job_type.replace(/_/g, ' ')}</span>
                <Badge variant="outline" className="text-[10px]">{a.count}× · {a.scope}</Badge>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">Geschätzt: {dryRunResult.plan.estimated_jobs} Jobs</p>
          </div>
        )}

        {!autofixRun && totalGaps > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleDryRun} disabled={loading} className="text-xs h-8">
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Shield className="h-3 w-3 mr-1" />} Preview
            </Button>
            <Button size="sm" onClick={handleStart} disabled={loading} className="text-xs h-8">
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />} Lücken automatisch schließen
            </Button>
            <select value={targetScore} onChange={e => setTargetScore(Number(e.target.value))} className="text-xs h-8 rounded border border-border bg-background px-2">
              <option value={60}>Ziel: 60</option><option value={75}>Ziel: 75</option><option value={85}>Ziel: 85</option><option value={90}>Ziel: 90</option><option value={95}>Ziel: 95</option>
            </select>
          </div>
        )}

        {totalGaps === 0 && (
          <p className="text-xs text-success flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Alle Lücken geschlossen – bereit für Publish</p>
        )}
      </CardContent>
    </Card>
  );
}
