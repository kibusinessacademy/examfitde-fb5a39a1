import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Shield, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Loader2, Activity, Clock, Zap, BookOpen
} from 'lucide-react';

interface SLOMetric {
  engine: string;
  p50_ms: number;
  p95_ms: number;
  error_rate: number;
  total_requests: number;
  slo_met: boolean;
  measured_at: string;
}

interface SyntheticTest {
  curriculum_id: string;
  status: string;
  score: number;
  question_count: number;
  coverage_score: number;
  latency_ms: number;
  metadata: { title?: string };
  created_at: string;
}

interface Runbook {
  trigger_event: string;
  title: string;
  severity: string;
  steps: string[];
  last_triggered_at: string | null;
  trigger_count: number;
}

export default function ProductionSafetyNet() {
  const [slos, setSlos] = useState<SLOMetric[]>([]);
  const [tests, setTests] = useState<SyntheticTest[]>([]);
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [sloRes, testRes, rbRes] = await Promise.all([
        (supabase as any).from('slo_metrics').select('*').order('measured_at', { ascending: false }).limit(20),
        (supabase as any).from('synthetic_test_results').select('*').order('created_at', { ascending: false }).limit(20),
        (supabase as any).from('runbook_entries').select('*').eq('is_active', true).order('severity'),
      ]);
      if (sloRes.data) setSlos(sloRes.data);
      if (testRes.data) setTests(testRes.data);
      if (rbRes.data) setRunbooks(rbRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  // Dedupe SLOs to latest per engine
  const latestSLOs = new Map<string, SLOMetric>();
  for (const s of slos) {
    if (!latestSLOs.has(s.engine)) latestSLOs.set(s.engine, s);
  }

  // Dedupe tests to latest per curriculum
  const latestTests = new Map<string, SyntheticTest>();
  for (const t of tests) {
    if (!latestTests.has(t.curriculum_id)) latestTests.set(t.curriculum_id, t);
  }

  const allSLOsMet = [...latestSLOs.values()].every(s => s.slo_met);
  const allTestsPassed = [...latestTests.values()].every(t => t.status === 'passed');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Production Safety Net</h2>
          <Badge variant={allSLOsMet && allTestsPassed ? 'default' : 'destructive'} className="text-[10px]">
            {allSLOsMet && allTestsPassed ? '✓ All Green' : '⚠ Issues'}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* SLO Status Grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" /> SLO Status (letzte Stunde)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {latestSLOs.size === 0 ? (
            <p className="text-xs text-muted-foreground">Noch keine SLO-Daten. Der daily-test-runner sammelt diese automatisch.</p>
          ) : (
            <div className="space-y-2">
              {[...latestSLOs.entries()].map(([engine, m]) => (
                <div key={engine} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                  {m.slo_met ? (
                    <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                  )}
                  <span className="text-xs text-foreground flex-1 truncate">{engine}</span>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>p95: <span className={cn("font-mono", m.p95_ms > 8000 ? "text-destructive" : "text-foreground")}>{m.p95_ms}ms</span></span>
                    <span>Err: <span className={cn("font-mono", m.error_rate > 0.03 ? "text-destructive" : "text-foreground")}>{(m.error_rate * 100).toFixed(1)}%</span></span>
                    <span>{m.total_requests} req</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Synthetic Tests */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4" /> Synthetische Tests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {latestTests.size === 0 ? (
            <p className="text-xs text-muted-foreground">Noch keine Testergebnisse.</p>
          ) : (
            <div className="space-y-2">
              {[...latestTests.entries()].map(([currId, t]) => (
                <div key={currId} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                  {t.status === 'passed' ? (
                    <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                  )}
                  <span className="text-xs text-foreground flex-1 truncate">
                    {t.metadata?.title || currId.slice(0, 8)}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{t.question_count} Fragen</span>
                    <span>Q:{t.score?.toFixed(1)}</span>
                    <span>Cov:{t.coverage_score}%</span>
                    <span>{t.latency_ms}ms</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Runbooks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Runbooks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {runbooks.map((rb, i) => (
              <details key={i} className="group">
                <summary className="flex items-center gap-2 cursor-pointer py-1.5">
                  <Badge variant={rb.severity === 'error' ? 'destructive' : 'outline'} className="text-[9px]">
                    {rb.severity}
                  </Badge>
                  <span className="text-xs text-foreground">{rb.title}</span>
                  {rb.last_triggered_at && (
                    <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(rb.last_triggered_at).toLocaleDateString('de-DE')}
                      <span>({rb.trigger_count}×)</span>
                    </span>
                  )}
                </summary>
                <ol className="mt-2 ml-6 space-y-1 text-xs text-muted-foreground list-decimal">
                  {(Array.isArray(rb.steps) ? rb.steps : JSON.parse(rb.steps as unknown as string)).map((step: string, j: number) => (
                    <li key={j}>{step}</li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
