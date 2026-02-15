import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

type Rule = {
  id: string;
  intent: string;
  provider: string;
  model: string;
  priority: number;
  is_fallback: boolean;
  enabled: boolean;
  budget_cap_eur: number | null;
  max_output_tokens: number | null;
  temperature: number | null;
  notes: string | null;
};

export default function RoutingTab() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error: err } = await supabase
        .from('model_routing_rules')
        .select('*')
        .order('intent')
        .order('priority', { ascending: true });

      if (!mounted) return;
      if (err) setError(err.message);
      setRules((data as Rule[]) ?? []);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    return <Card className="p-4"><p className="text-sm text-destructive">{error}</p></Card>;
  }

  // Group by intent
  const grouped: Record<string, Rule[]> = {};
  for (const r of rules) {
    grouped[r.intent] ??= [];
    grouped[r.intent].push(r);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">DB-First Model Routing (SSOT)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            {rules.length} Regeln · {Object.keys(grouped).length} Intents · Änderungen via DB, kein Re-Deploy nötig
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Intent</th>
                  <th className="py-2 pr-3 font-medium">Provider</th>
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium text-center">Prio</th>
                  <th className="py-2 pr-3 font-medium text-center">Fallback</th>
                  <th className="py-2 pr-3 font-medium text-right">Max Tokens</th>
                  <th className="py-2 pr-3 font-medium text-right">Temp</th>
                  <th className="py-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-mono text-xs">{r.intent}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className="text-[10px]">{r.provider}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.model}</td>
                    <td className="py-2 pr-3 text-center tabular-nums">{r.priority}</td>
                    <td className="py-2 pr-3 text-center">{r.is_fallback ? '🔄' : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.max_output_tokens ?? '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.temperature != null ? r.temperature : '—'}</td>
                    <td className="py-2 text-center">
                      {r.enabled ? (
                        <Badge variant="default" className="text-[10px]">aktiv</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">aus</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {rules.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Keine Routing-Regeln</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
