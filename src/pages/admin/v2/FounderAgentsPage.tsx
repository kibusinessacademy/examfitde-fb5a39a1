import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, AlertTriangle, TrendingUp, Compass, Rocket, Cpu } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';

type AgentKey = 'launch_forecast' | 'founder_copilot' | 'build_strategy' | 'revenue_readiness' | 'ai_capability';

const STATUS_BG: Record<string, string> = {
  green: 'bg-status-success-bg-subtle text-status-success-fg border-status-success-fg/30',
  amber: 'bg-status-warning-bg-subtle text-status-warning-fg border-status-warning-fg/30',
  red:   'bg-status-error-bg-subtle text-status-error-fg border-status-error-fg/30',
};

export default function FounderAgentsPage() {
  const { toast } = useToast();
  const [active, setActive] = useState<AgentKey>('launch_forecast');
  const [loading, setLoading] = useState<AgentKey | null>(null);
  const [results, setResults] = useState<Partial<Record<AgentKey, any>>>({});
  const [question, setQuestion] = useState('');

  const run = async (agent: AgentKey, payload: Record<string, unknown> = {}) => {
    setLoading(agent);
    try {
      const { data, error } = await supabase.functions.invoke('admin-founder-agents', {
        body: { agent, ...payload },
      });
      if (error) throw error;
      setResults((r) => ({ ...r, [agent]: data }));
    } catch (e) {
      toast({ title: 'Agent-Fehler', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      <div className="mb-6 flex items-center gap-3">
        <Sparkles className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Founder Agents</h1>
          <p className="text-sm text-muted-foreground">
            5 persönliche AI-Agenten: Launch-Risiken · Strategie · Build-Pfad · Revenue-Lücken · AI-Capability.
            Read-only — keine Mutationen. Signale deterministisch, Synthese via Lovable AI.
          </p>
        </div>
      </div>

      <Tabs value={active} onValueChange={(v) => setActive(v as AgentKey)}>
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="launch_forecast"><AlertTriangle className="h-4 w-4 mr-1" />Forecast</TabsTrigger>
          <TabsTrigger value="founder_copilot"><Compass className="h-4 w-4 mr-1" />Copilot</TabsTrigger>
          <TabsTrigger value="build_strategy"><Rocket className="h-4 w-4 mr-1" />Strategy</TabsTrigger>
          <TabsTrigger value="revenue_readiness"><TrendingUp className="h-4 w-4 mr-1" />Revenue</TabsTrigger>
          <TabsTrigger value="ai_capability"><Cpu className="h-4 w-4 mr-1" />AI-Cap</TabsTrigger>
        </TabsList>

        {/* Launch Forecast */}
        <TabsContent value="launch_forecast" className="mt-4">
          <AgentShell
            title="Launch Readiness Forecast"
            description="Prognose: woran scheitert das Projekt wahrscheinlich? (90-Tage-Horizont)"
            onRun={() => run('launch_forecast')}
            loading={loading === 'launch_forecast'}
            data={results.launch_forecast}
          >
            {results.launch_forecast?.forecast && (
              <div className="space-y-3">
                <Badge className={STATUS_BG[results.launch_forecast.forecast.overall]}>
                  Overall: {results.launch_forecast.forecast.overall.toUpperCase()}
                </Badge>
                <div className="space-y-2">
                  {results.launch_forecast.forecast.risks.map((r: any, i: number) => (
                    <div key={i} className="border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{r.factor}</span>
                        <Badge variant="outline">{Math.round(r.probability * 100)}%</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{r.evidence}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AgentShell>
        </TabsContent>

        {/* Founder Copilot */}
        <TabsContent value="founder_copilot" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Founder Copilot</CardTitle>
              <CardDescription>Persönlicher AI-Berater — Priorisierung, GTM, Pricing, Launchplan, Risiken.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Deine Frage (leer lassen für 'wichtigster Hebel diese Woche')…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
              />
              <Button onClick={() => run('founder_copilot', question.trim() ? { question } : {})} disabled={loading === 'founder_copilot'}>
                {loading === 'founder_copilot' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Beraten lassen
              </Button>
              {results.founder_copilot?.answer && (
                <div className="prose prose-sm dark:prose-invert max-w-none border-l-2 border-primary pl-4">
                  <ReactMarkdown>{results.founder_copilot.answer}</ReactMarkdown>
                </div>
              )}
              {results.founder_copilot && !results.founder_copilot.answer && (
                <p className="text-sm text-status-warning-fg">AI-Antwort nicht verfügbar — LOVABLE_API_KEY oder Gateway-Problem.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Build Strategy */}
        <TabsContent value="build_strategy" className="mt-4">
          <AgentShell
            title="Build Strategy Generator"
            description="Welche Build-Strategy passt zum aktuellen Projekt-State?"
            onRun={() => run('build_strategy')}
            loading={loading === 'build_strategy'}
            data={results.build_strategy}
          >
            {results.build_strategy?.strategy && (
              <div className="space-y-3">
                <div className="border-2 border-primary rounded-lg p-4 bg-primary/5">
                  <Badge className="bg-primary text-primary-foreground mb-2">Empfohlen</Badge>
                  <h3 className="text-lg font-bold text-foreground">{results.build_strategy.strategy.recommended.strategy}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{results.build_strategy.strategy.recommended.reason}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Alternativen (rang-sortiert)</p>
                  {results.build_strategy.strategy.alternatives.map((a: any, i: number) => (
                    <div key={i} className="flex justify-between border-b border-border py-2">
                      <span className="text-sm text-foreground">{a.strategy}</span>
                      <span className="text-xs text-muted-foreground">{a.reason || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AgentShell>
        </TabsContent>

        {/* Revenue Readiness */}
        <TabsContent value="revenue_readiness" className="mt-4">
          <AgentShell
            title="Revenue Readiness System"
            description="9-Punkt-Audit: Stripe · Pricing · Checkout · Leads · Analytics · Email · CRM · Funnel · SEO."
            onRun={() => run('revenue_readiness')}
            loading={loading === 'revenue_readiness'}
            data={results.revenue_readiness}
          >
            {results.revenue_readiness?.readiness && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Badge className={STATUS_BG[results.revenue_readiness.readiness.overall]}>
                    Score: {results.revenue_readiness.readiness.score}/100
                  </Badge>
                </div>
                <div className="space-y-1">
                  {results.revenue_readiness.readiness.checks.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between border border-border rounded p-2">
                      <span className="text-sm text-foreground">{c.key}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{c.detail}</span>
                        <Badge className={STATUS_BG[c.status]}>{c.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AgentShell>
        </TabsContent>

        {/* AI Capability */}
        <TabsContent value="ai_capability" className="mt-4">
          <AgentShell
            title="AI Capability Planner"
            description="Welche AI-Module sind nötig — und welche sind overengineered?"
            onRun={() => run('ai_capability')}
            loading={loading === 'ai_capability'}
            data={results.ai_capability}
          >
            {results.ai_capability?.capability && (
              <div className="space-y-3">
                <Badge className={STATUS_BG[
                  results.ai_capability.capability.governance_level === 'controlled' ? 'green' :
                  results.ai_capability.capability.governance_level === 'medium' ? 'amber' : 'red'
                ]}>
                  Governance: {results.ai_capability.capability.governance_level}
                </Badge>
                <div className="space-y-1">
                  {results.ai_capability.capability.modules.map((m: any, i: number) => (
                    <div key={i} className="flex items-center justify-between border border-border rounded p-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{m.module}</span>
                        {m.needed && !m.present && <Badge variant="destructive" className="text-xs">GAP</Badge>}
                        {m.present && <Badge variant="outline" className="text-xs">aktiv</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-3">
                        <span>cost: {m.cost}</span>
                        <span className="hidden md:inline">gov: {m.governance}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </AgentShell>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AgentShell({ title, description, onRun, loading, data, children }: {
  title: string; description: string; onRun: () => void; loading: boolean; data: any; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={onRun} disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {data ? 'Erneut analysieren' : 'Analyse starten'}
        </Button>
        {children}
        {data?.narrative && (
          <div className="prose prose-sm dark:prose-invert max-w-none border-l-2 border-primary pl-4 mt-4">
            <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI-Synthese
            </h4>
            <ReactMarkdown>{data.narrative}</ReactMarkdown>
          </div>
        )}
        {data && !data.narrative && (
          <p className="text-xs text-muted-foreground">AI-Narrative nicht verfügbar — nur deterministische Signale.</p>
        )}
        {data?.signals && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Rohdaten anzeigen</summary>
            <pre className="mt-2 p-2 bg-muted rounded overflow-auto">{JSON.stringify(data.signals, null, 2)}</pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
