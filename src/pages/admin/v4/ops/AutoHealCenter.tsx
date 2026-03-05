import { useEffect, useState } from 'react';
import { Gauge, ShieldCheck, Play, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loading, MiniKPI } from './OpsShared';
import { toast } from 'sonner';

interface HealResult {
  package_id: string;
  curriculum_id: string;
  blueprint_count: number;
  question_count: number;
  hollow_reason: string;
  jobs_cancelled: number;
  steps_reset: string[];
}

interface HealResponse {
  ok: boolean;
  dry_run: boolean;
  scanned_packages: number;
  healed: HealResult[];
  healed_count: number;
  error?: string;
}

export default function AutoHealCenter() {
  const [runs, setRuns] = useState<any[]>([]);
  const [policy, setPolicy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [healResult, setHealResult] = useState<HealResponse | null>(null);
  const [healLoading, setHealLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('admin-auto-heal-status');
        if (error) throw error;
        setRuns(data?.runs || []);
        setPolicy(data?.policy || null);
      } catch (e: any) {
        console.error('Failed to load auto-heal status:', e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const runHeal = async (dryRun: boolean) => {
    setHealLoading(true);
    setHealResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('safe-global-heal', {
        body: { dry_run: dryRun, min_questions: 50 },
      });
      if (error) throw error;
      setHealResult(data as HealResponse);
      if (data?.healed_count > 0) {
        toast.success(`${dryRun ? '[DRY RUN] ' : ''}${data.healed_count} Pakete ${dryRun ? 'erkannt' : 'geheilt'}`);
      } else {
        toast.info('Keine HOLLOW-Pakete gefunden – Pipeline ist sauber.');
      }
    } catch (e: any) {
      toast.error(`Heal fehlgeschlagen: ${e.message}`);
    } finally {
      setHealLoading(false);
    }
  };

  if (loading) return <Loading />;

  const active = runs.filter(r => r.status === 'running');
  const frozen = runs.filter(r => r.status === 'frozen');
  const stopped = runs.filter(r => r.status === 'stopped');
  const succeeded = runs.filter(r => r.status === 'succeeded');
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayCost = runs
    .filter(r => new Date(r.updated_at) >= todayStart)
    .reduce((s, r) => s + (r.budget_used_eur || 0), 0);

  return (
    <div className="space-y-6">
      {/* Safe Global Heal Controls */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Safe Global Heal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Scannt alle aktiven Pakete auf HOLLOW-Steps (done ohne Artefakte), Zombie-Steps und blockierte QG-Jobs.
            Resettet nur die kaputte Exam-Kette – kein Fortschritt geht verloren.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={healLoading}
              onClick={() => runHeal(true)}
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              Dry Run (Scan)
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={healLoading}
              onClick={() => runHeal(false)}
            >
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Heal ausführen
            </Button>
          </div>

          {healResult && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant={healResult.dry_run ? 'secondary' : 'default'} className="text-[10px]">
                  {healResult.dry_run ? 'DRY RUN' : 'EXECUTED'}
                </Badge>
                <span className="text-muted-foreground">
                  {healResult.scanned_packages} Pakete gescannt · {healResult.healed_count} HOLLOW gefunden
                </span>
              </div>
              {healResult.healed.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-1.5 px-2">Paket</th>
                        <th className="text-left py-1.5 px-2">Grund</th>
                        <th className="text-left py-1.5 px-2">Blueprints</th>
                        <th className="text-left py-1.5 px-2">Fragen</th>
                        <th className="text-left py-1.5 px-2">Jobs cancelled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {healResult.healed.map((h) => (
                        <tr key={h.package_id} className="border-b border-border/30">
                          <td className="py-1.5 px-2 font-mono">{h.package_id.substring(0, 8)}</td>
                          <td className="py-1.5 px-2 text-destructive truncate max-w-[250px]">{h.hollow_reason}</td>
                          <td className="py-1.5 px-2">{h.blueprint_count}</td>
                          <td className="py-1.5 px-2">{h.question_count}</td>
                          <td className="py-1.5 px-2">{h.jobs_cancelled}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {policy && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Auto-Heal Policy v{policy.version}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div><p className="text-muted-foreground">Modus</p><p className="font-medium">{policy.policy_json?.autoHeal?.mode || 'NIGHTLY'}</p></div>
              <div><p className="text-muted-foreground">Max Rounds</p><p className="font-medium">{policy.policy_json?.autoHeal?.loop?.maxRounds || 3}</p></div>
              <div><p className="text-muted-foreground">Budget Limit</p><p className="font-medium">€{policy.policy_json?.guardrails?.budgetCircuitBreaker?.dailyBudgetEur || 15}/Tag</p></div>
              <div><p className="text-muted-foreground">Target Score</p><p className="font-medium">{policy.policy_json?.checks?.integrity?.targets?.defaultTargetScore || 85}</p></div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniKPI label="Aktiv" value={active.length} alert={active.length > 3} />
        <MiniKPI label="Frozen" value={frozen.length} alert={frozen.length > 0} />
        <MiniKPI label="Stopped" value={stopped.length} />
        <MiniKPI label="Succeeded" value={succeeded.length} />
        <MiniKPI label="Kosten heute" value={`€${todayCost.toFixed(2)}`} sub="/ €15" alert={todayCost >= 12} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Autofix Runs</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Paket</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Score</th>
                  <th className="text-left py-2 px-3">Runde</th>
                  <th className="text-left py-2 px-3">Budget</th>
                  <th className="text-left py-2 px-3">Stop-Grund</th>
                  <th className="text-left py-2 px-3">Erstellt</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className={cn("border-b border-border/30",
                    r.status === 'frozen' && 'bg-blue-500/5',
                    r.status === 'stopped' && 'bg-destructive/5',
                  )}>
                    <td className="py-2 px-3 font-mono">{r.package_id?.substring(0, 8)}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className={cn("text-[10px]",
                        r.status === 'running' ? 'bg-primary/10 text-primary' :
                        r.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-600' :
                        r.status === 'frozen' ? 'bg-blue-500/10 text-blue-600' :
                        r.status === 'stopped' || r.status === 'failed' ? 'bg-destructive/10 text-destructive' : ''
                      )}>{r.status}</Badge>
                    </td>
                    <td className="py-2 px-3 font-medium">{r.last_score ?? '–'}</td>
                    <td className="py-2 px-3">{r.current_round}/{r.max_rounds}</td>
                    <td className="py-2 px-3">€{(r.budget_used_eur || 0).toFixed(2)}/€{r.budget_eur}</td>
                    <td className="py-2 px-3 text-muted-foreground truncate max-w-[200px]">{r.stop_reason || '–'}</td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
