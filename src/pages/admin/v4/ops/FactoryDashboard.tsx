import { useEffect, useState, useCallback } from 'react';
import { Loader2, Factory } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loading, MiniKPI } from './OpsShared';

export default function FactoryDashboard() {
  const [specs, setSpecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('product_factory_specs').select('*, certification_catalog(title)')
      .order('updated_at', { ascending: false });
    setSpecs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runOrchestrator = async () => {
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/factory-orchestrator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ manual: true }),
      });
      const data = await res.json();
      toast.success(`Orchestrator: ${data.actions_count ?? 0} Aktionen`);
      load();
    } catch { toast.error('Orchestrator-Fehler'); }
    setRunning(false);
  };

  if (loading) return <Loading />;

  const enabled = specs.filter(s => s.enabled).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 flex-1">
          <MiniKPI label="Factory Specs" value={specs.length} />
          <MiniKPI label="Aktiviert" value={enabled} />
          <MiniKPI label="Deaktiviert" value={specs.length - enabled} />
        </div>
        <Button onClick={runOrchestrator} disabled={running} className="ml-4">
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Factory className="h-4 w-4 mr-2" />}
          Orchestrator jetzt
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Factory className="h-4 w-4" /> Product Factory Specs ({specs.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Zertifizierung</th>
                  <th className="text-center py-2 px-3">Aktiv</th>
                  <th className="text-left py-2 px-3">Module</th>
                  <th className="text-left py-2 px-3">Aktualisiert</th>
                </tr>
              </thead>
              <tbody>
                {specs.map((s: any) => {
                  const spec = s.spec || {};
                  const modules = Object.entries(spec).filter(([, v]: any) => v?.enabled).map(([k]) => k);
                  return (
                    <tr key={s.certification_id} className="border-b border-border/30">
                      <td className="py-2 px-3 font-medium truncate max-w-[200px]">{s.certification_catalog?.title || s.certification_id?.slice(0, 8)}</td>
                      <td className="py-2 px-3 text-center">
                        <Button size="sm" variant="ghost" className="h-6 w-8 p-0 text-xs" onClick={async () => {
                          await (supabase as any).from('product_factory_specs').update({ enabled: !s.enabled, updated_at: new Date().toISOString() }).eq('certification_id', s.certification_id);
                          load();
                        }}>{s.enabled ? '✅' : '❌'}</Button>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {modules.map(m => <Badge key={m} variant="outline" className="text-[9px]">{m}</Badge>)}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{new Date(s.updated_at).toLocaleDateString('de-DE')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
