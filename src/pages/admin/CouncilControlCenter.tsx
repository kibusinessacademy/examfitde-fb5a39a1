import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  GraduationCap, Bot, FileText, TrendingUp, Package, Palette, 
  Server, Scale, DollarSign, Users, BarChart3, Settings,
  AlertTriangle, CheckCircle, XCircle, Pause, Play, Shield,
  ArrowUpRight, Activity
} from 'lucide-react';
import { toast } from 'sonner';

const COUNCIL_ICONS: Record<string, any> = {
  education: GraduationCap,
  'ai-tutor': Bot,
  exam: FileText,
  marketing: TrendingUp,
  product: Package,
  'ui-ux': Palette,
  tech: Server,
  legal: Scale,
  finance: DollarSign,
  partner: Users,
  analytics: BarChart3,
  operations: Settings,
};

interface Council {
  id: string;
  name: string;
  mission: string;
  status: string;
  budget_eur_monthly: number;
  budget_spent_eur: number;
}

interface CouncilKPI {
  id: string;
  council_id: string;
  kpi_name: string;
  kpi_value: number | null;
  target_value: number | null;
  unit: string;
  status: string;
}

interface Escalation {
  id: string;
  source_council_id: string;
  target_council_id: string | null;
  escalation_type: string;
  severity: string;
  title: string;
  status: string;
  created_at: string;
}

interface KillSwitch {
  id: string;
  council_id: string;
  rule_name: string;
  kpi_name: string;
  operator: string;
  threshold: number;
  action: string;
  is_active: boolean;
  last_triggered_at: string | null;
  trigger_count: number;
}

export default function CouncilControlCenter() {
  const [councils, setCouncils] = useState<Council[]>([]);
  const [kpis, setKpis] = useState<CouncilKPI[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [killSwitches, setKillSwitches] = useState<KillSwitch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [councilsRes, kpisRes, escalationsRes, ksRes] = await Promise.all([
      supabase.from('councils').select('*').order('name'),
      supabase.from('council_kpis').select('*'),
      supabase.from('council_escalations').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(20),
      supabase.from('council_kill_switches').select('*').order('council_id'),
    ]);
    setCouncils((councilsRes.data as any[]) || []);
    setKpis((kpisRes.data as any[]) || []);
    setEscalations((escalationsRes.data as any[]) || []);
    setKillSwitches((ksRes.data as any[]) || []);
    setLoading(false);
  };

  const toggleCouncilStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    const { error } = await supabase.from('councils').update({ status: newStatus }).eq('id', id);
    if (error) { toast.error('Fehler beim Ändern'); return; }
    toast.success(`Council ${newStatus === 'active' ? 'aktiviert' : 'pausiert'}`);
    fetchAll();
  };

  const statusColor = (s: string) => s === 'active' ? 'default' : s === 'paused' ? 'secondary' : 'destructive';
  const severityColor = (s: string) => s === 'critical' ? 'destructive' : s === 'high' ? 'destructive' : s === 'medium' ? 'secondary' : 'outline';
  const kpiStatusIcon = (s: string) => s === 'on_track' ? <CheckCircle className="h-4 w-4 text-green-500" /> : s === 'at_risk' ? <AlertTriangle className="h-4 w-4 text-yellow-500" /> : <XCircle className="h-4 w-4 text-red-500" />;

  const activeCount = councils.filter(c => c.status === 'active').length;
  const openEscalations = escalations.length;
  const totalBudget = councils.reduce((s, c) => s + (c.budget_eur_monthly || 0), 0);
  const totalSpent = councils.reduce((s, c) => s + (c.budget_spent_eur || 0), 0);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold">Council Control Center</h1>
        <p className="text-muted-foreground mt-1">Executive Dashboard – Alle Councils auf einen Blick</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Aktive Councils</p>
            <p className="text-3xl font-bold text-foreground">{activeCount}/{councils.length}</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Offene Eskalationen</p>
            <p className="text-3xl font-bold text-foreground">{openEscalations}</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Monatsbudget</p>
            <p className="text-3xl font-bold text-foreground">{totalBudget} €</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Budget verbraucht</p>
            <p className="text-3xl font-bold text-foreground">{totalSpent.toFixed(0)} €</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="councils">
        <TabsList>
          <TabsTrigger value="councils">Councils ({councils.length})</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
          <TabsTrigger value="escalations">Eskalationen ({openEscalations})</TabsTrigger>
          <TabsTrigger value="kill-switches">Kill-Switches</TabsTrigger>
        </TabsList>

        {/* Councils Overview */}
        <TabsContent value="councils">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {councils.map(c => {
              const Icon = COUNCIL_ICONS[c.id] || Activity;
              const councilKpis = kpis.filter(k => k.council_id === c.id);
              return (
                <Card key={c.id} className="glass-card border-border/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{c.name}</CardTitle>
                          <Badge variant={statusColor(c.status)} className="mt-1 text-xs">{c.status}</Badge>
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => toggleCouncilStatus(c.id, c.status)}>
                        {c.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground">{c.mission}</p>
                    {c.budget_eur_monthly > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Budget</span>
                        <span>{c.budget_spent_eur || 0} / {c.budget_eur_monthly} €</span>
                      </div>
                    )}
                    {councilKpis.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-border/50">
                        {councilKpis.slice(0, 3).map(k => (
                          <div key={k.id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground truncate mr-2">{k.kpi_name}</span>
                            <span className="flex items-center gap-1">
                              {k.kpi_value ?? '–'} / {k.target_value}{k.unit}
                              {kpiStatusIcon(k.status)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* KPIs */}
        <TabsContent value="kpis">
          <Card className="glass-card border-border/50">
            <CardHeader>
              <CardTitle>Alle Council-KPIs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-muted-foreground font-medium">Council</th>
                      <th className="text-left py-2 px-3 text-muted-foreground font-medium">KPI</th>
                      <th className="text-right py-2 px-3 text-muted-foreground font-medium">Aktuell</th>
                      <th className="text-right py-2 px-3 text-muted-foreground font-medium">Ziel</th>
                      <th className="text-center py-2 px-3 text-muted-foreground font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpis.map(k => (
                      <tr key={k.id} className="border-b border-border/30">
                        <td className="py-2 px-3">{k.council_id}</td>
                        <td className="py-2 px-3">{k.kpi_name}</td>
                        <td className="py-2 px-3 text-right font-mono">{k.kpi_value ?? '–'}</td>
                        <td className="py-2 px-3 text-right font-mono">{k.target_value}{k.unit}</td>
                        <td className="py-2 px-3 text-center">{kpiStatusIcon(k.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Escalations */}
        <TabsContent value="escalations">
          <Card className="glass-card border-border/50">
            <CardHeader>
              <CardTitle>Offene Eskalationen</CardTitle>
              <CardDescription>Council-übergreifende Konflikte & Risiken</CardDescription>
            </CardHeader>
            <CardContent>
              {escalations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Keine offenen Eskalationen</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {escalations.map(e => (
                    <div key={e.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50">
                      <AlertTriangle className="h-5 w-5 text-warning mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{e.title}</span>
                          <Badge variant={severityColor(e.severity)} className="text-xs">{e.severity}</Badge>
                          <Badge variant="outline" className="text-xs">{e.escalation_type}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Von: {e.source_council_id} {e.target_council_id && `→ ${e.target_council_id}`}
                        </p>
                      </div>
                      <Button size="sm" variant="outline">Lösen</Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Kill Switches */}
        <TabsContent value="kill-switches">
          <Card className="glass-card border-border/50">
            <CardHeader>
              <CardTitle>Kill-Switch Regeln</CardTitle>
              <CardDescription>Automatische Notbremsen bei KPI-Verletzung</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {killSwitches.map(ks => (
                  <div key={ks.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${ks.is_active ? 'bg-green-500' : 'bg-muted'}`} />
                      <div>
                        <p className="text-sm font-medium">{ks.rule_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {ks.council_id} · {ks.kpi_name} {ks.operator} {ks.threshold} → {ks.action}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {ks.trigger_count > 0 && (
                        <Badge variant="secondary" className="text-xs">{ks.trigger_count}× ausgelöst</Badge>
                      )}
                      <Badge variant={ks.is_active ? 'default' : 'secondary'} className="text-xs">
                        {ks.is_active ? 'Aktiv' : 'Inaktiv'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
