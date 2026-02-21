import { useEffect, useState, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loading, MiniKPI } from './OpsShared';

export default function QualityCouncilDashboard() {
  const [reports, setReports] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [repRes, rulesRes] = await Promise.all([
      (supabase as any).from('package_quality_reports').select('*, course_packages(title)').order('created_at', { ascending: false }).limit(30),
      (supabase as any).from('quality_rules').select('*').order('rule_key'),
    ]);
    setReports(repRes.data || []);
    setRules(rulesRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const passed = reports.filter(r => r.status === 'pass').length;
  const warned = reports.filter(r => r.status === 'warn').length;
  const failed = reports.filter(r => r.status === 'fail').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="Reports" value={reports.length} />
        <MiniKPI label="Pass" value={passed} />
        <MiniKPI label="Warn" value={warned} alert={warned > 0} />
        <MiniKPI label="Fail" value={failed} alert={failed > 0} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Quality Reports</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Paket</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-right py-2 px-3">Score</th>
                  <th className="text-left py-2 px-3">Erstellt</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r: any) => (
                  <tr key={r.package_id} className={cn("border-b border-border/30", r.status === 'fail' && 'bg-destructive/5')}>
                    <td className="py-2 px-3 font-medium truncate max-w-[200px]">{r.course_packages?.title || r.package_id?.slice(0, 8)}</td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className={cn("text-[10px]",
                        r.status === 'pass' ? 'bg-emerald-500/10 text-emerald-600' :
                        r.status === 'warn' ? 'bg-yellow-500/10 text-yellow-600' :
                        'bg-destructive/10 text-destructive'
                      )}>{r.status}</Badge>
                    </td>
                    <td className="py-2 px-3 text-right font-bold">{r.score}</td>
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

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Quality Rules ({rules.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Rule</th>
                  <th className="text-left py-2 px-3">Severity</th>
                  <th className="text-center py-2 px-3">Aktiv</th>
                  <th className="text-center py-2 px-3">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/30">
                    <td className="py-2 px-3 font-mono">{r.rule_key}</td>
                    <td className="py-2 px-3">
                      <Button size="sm" variant="ghost" className="h-6 p-1 text-[10px]" onClick={async () => {
                        const newSev = r.severity === 'block' ? 'warn' : 'block';
                        await (supabase as any).from('quality_rules').update({ severity: newSev }).eq('id', r.id);
                        toast.success(`${r.rule_key} → ${newSev}`);
                        load();
                      }}>
                        <Badge variant="outline" className={cn("text-[10px]",
                          r.severity === 'block' ? 'bg-destructive/10 text-destructive' : 'bg-yellow-500/10 text-yellow-600'
                        )}>{r.severity}</Badge>
                      </Button>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <Button size="sm" variant="ghost" className="h-6 w-8 p-0 text-xs" onClick={async () => {
                        await (supabase as any).from('quality_rules').update({ enabled: !r.enabled }).eq('id', r.id);
                        load();
                      }}>
                        {r.enabled ? '✅' : '❌'}
                      </Button>
                    </td>
                    <td className="py-2 px-3 text-center text-muted-foreground text-[10px]">Klick zum Ändern</td>
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
