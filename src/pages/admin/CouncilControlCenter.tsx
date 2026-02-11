import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  GraduationCap, Bot, FileText, TrendingUp, Package, Palette,
  Server, Scale, DollarSign, Users, BarChart3, Settings,
  AlertTriangle, CheckCircle, XCircle, Pause, Play, Shield,
  Activity, MessageSquare, Gavel, Eye, RefreshCw,
  ThumbsUp, ThumbsDown, Minus
} from 'lucide-react';
import { toast } from 'sonner';

const COUNCIL_ICONS: Record<string, React.ElementType> = {
  education: GraduationCap, 'ai-tutor': Bot, exam: FileText,
  marketing: TrendingUp, product: Package, 'ui-ux': Palette,
  tech: Server, legal: Scale, finance: DollarSign,
  partner: Users, analytics: BarChart3, operations: Settings,
};

interface Council { id: string; name: string; mission: string; status: string; budget_eur_monthly: number; budget_spent_eur: number; }
interface CouncilKPI { id: string; council_id: string; kpi_name: string; kpi_value: number | null; target_value: number | null; unit: string; status: string; }
interface Escalation { id: string; source_council_id: string; target_council_id: string | null; escalation_type: string; severity: string; title: string; status: string; created_at: string; }
interface KillSwitch { id: string; council_id: string; rule_name: string; kpi_name: string; operator: string; threshold: number; action: string; is_active: boolean; last_triggered_at: string | null; trigger_count: number; }

interface ContentVersion {
  id: string;
  course_id: string;
  lesson_id: string;
  step_key: string;
  created_by_agent: string;
  status: string;
  council_round: number;
  quality_score: number | null;
  created_at: string;
}

interface CouncilVerdict {
  id: string;
  content_version_id: string;
  final_decision: string;
  consensus_score: number;
  decided_at: string;
}

interface CouncilMessage {
  id: string;
  content_version_id: string;
  agent_name: string;
  message_type: string;
  message_json: Record<string, unknown>;
  created_at: string;
}

export default function CouncilControlCenter() {
  const [councils, setCouncils] = useState<Council[]>([]);
  const [kpis, setKpis] = useState<CouncilKPI[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [killSwitches, setKillSwitches] = useState<KillSwitch[]>([]);
  const [versions, setVersions] = useState<ContentVersion[]>([]);
  const [verdicts, setVerdicts] = useState<CouncilVerdict[]>([]);
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [councilsRes, kpisRes, escalationsRes, ksRes, versionsRes, verdictsRes] = await Promise.all([
      supabase.from('councils').select('*').order('name'),
      supabase.from('council_kpis').select('*'),
      supabase.from('council_escalations').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(20),
      supabase.from('council_kill_switches').select('*').order('council_id'),
      supabase.from('content_versions' as never).select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('council_verdicts' as never).select('*').order('decided_at', { ascending: false }).limit(100),
    ]);
    setCouncils((councilsRes.data as Council[]) || []);
    setKpis((kpisRes.data as CouncilKPI[]) || []);
    setEscalations((escalationsRes.data as Escalation[]) || []);
    setKillSwitches((ksRes.data as KillSwitch[]) || []);
    setVersions((versionsRes.data as ContentVersion[]) || []);
    setVerdicts((verdictsRes.data as CouncilVerdict[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const fetchMessages = async (versionId: string) => {
    if (expandedVersion === versionId) { setExpandedVersion(null); return; }
    const { data } = await supabase
      .from('council_messages' as never)
      .select('*')
      .eq('content_version_id', versionId)
      .order('created_at', { ascending: true });
    setMessages((data as CouncilMessage[]) || []);
    setExpandedVersion(versionId);
  };

  const toggleCouncilStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    const { error } = await supabase.from('councils').update({ status: newStatus }).eq('id', id);
    if (error) { toast.error('Fehler beim Ändern'); return; }
    toast.success(`Council ${newStatus === 'active' ? 'aktiviert' : 'pausiert'}`);
    fetchAll();
  };

  const statusColor = (s: string) => s === 'active' ? 'default' : s === 'paused' ? 'secondary' : 'destructive';
  const severityColor = (s: string) => s === 'critical' || s === 'high' ? 'destructive' : s === 'medium' ? 'secondary' : 'outline';
  const kpiStatusIcon = (s: string) => s === 'on_track' ? <CheckCircle className="h-4 w-4 text-green-500" /> : s === 'at_risk' ? <AlertTriangle className="h-4 w-4 text-yellow-500" /> : <XCircle className="h-4 w-4 text-red-500" />;

  const decisionBadge = (d: string) => {
    if (d === 'approved') return <Badge className="bg-green-500/15 text-green-600 border-green-500/30"><ThumbsUp className="h-3 w-3 mr-1" />Approved</Badge>;
    if (d === 'rejected') return <Badge variant="destructive"><ThumbsDown className="h-3 w-3 mr-1" />Rejected</Badge>;
    return <Badge variant="secondary"><Minus className="h-3 w-3 mr-1" />Revise</Badge>;
  };

  const versionStatusBadge = (s: string) => {
    const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      proposed: { variant: 'outline', label: 'Proposed' },
      under_review: { variant: 'secondary', label: 'Under Review' },
      revise: { variant: 'secondary', label: 'Revision' },
      rejected: { variant: 'destructive', label: 'Rejected' },
      approved: { variant: 'default', label: 'Approved' },
    };
    const cfg = map[s] || { variant: 'outline' as const, label: s };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  const activeCount = councils.filter(c => c.status === 'active').length;
  const openEscalations = escalations.length;
  const totalBudget = councils.reduce((s, c) => s + (c.budget_eur_monthly || 0), 0);
  const totalSpent = councils.reduce((s, c) => s + (c.budget_spent_eur || 0), 0);

  // Deliberation stats
  const approvedCount = versions.filter(v => v.status === 'approved').length;
  const pendingCount = versions.filter(v => ['proposed', 'under_review'].includes(v.status)).length;
  const rejectedCount = versions.filter(v => v.status === 'rejected').length;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Council Control Center</h1>
          <p className="text-muted-foreground mt-1">Deliberative Architektur – Councils, Versioning & Publish Gate</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll}>
          <RefreshCw className="h-4 w-4 mr-2" />Aktualisieren
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Aktive Councils</p>
            <p className="text-2xl font-bold text-foreground">{activeCount}/{councils.length}</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Eskalationen</p>
            <p className="text-2xl font-bold text-foreground">{openEscalations}</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Budget</p>
            <p className="text-2xl font-bold text-foreground">{totalSpent.toFixed(0)}/{totalBudget}€</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-border/50 border-green-500/30">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Approved</p>
            <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-border/50 border-yellow-500/30">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-border/50 border-red-500/30">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Rejected</p>
            <p className="text-2xl font-bold text-destructive">{rejectedCount}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="deliberation">
        <TabsList>
          <TabsTrigger value="deliberation"><Gavel className="h-4 w-4 mr-1" />Deliberation ({versions.length})</TabsTrigger>
          <TabsTrigger value="councils">Councils ({councils.length})</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
          <TabsTrigger value="escalations">Eskalationen ({openEscalations})</TabsTrigger>
          <TabsTrigger value="kill-switches">Kill-Switches</TabsTrigger>
        </TabsList>

        {/* ─── Deliberation Tab ─── */}
        <TabsContent value="deliberation">
          <Card className="glass-card border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Content Versioning & Council Verdicts
              </CardTitle>
              <CardDescription>GPT-4.1 generiert → Claude Sonnet 4 validiert → Verdict → Publish Gate</CardDescription>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Gavel className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Noch keine Council-Deliberationen</p>
                  <p className="text-sm mt-1">Starte die Council Pipeline um Inhalte zu reviewen.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {versions.map(v => {
                    const verdict = verdicts.find(vd => vd.content_version_id === v.id);
                    const isExpanded = expandedVersion === v.id;
                    return (
                      <div key={v.id} className="border border-border/50 rounded-lg overflow-hidden">
                        <div
                          className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => fetchMessages(v.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{v.step_key}</code>
                              {versionStatusBadge(v.status)}
                              <Badge variant="outline" className="text-xs">
                                <Bot className="h-3 w-3 mr-1" />{v.created_by_agent}
                              </Badge>
                              <Badge variant="outline" className="text-xs">Round {v.council_round}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              Lesson: {v.lesson_id.slice(0, 8)}… | Score: {v.quality_score ?? '–'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {verdict && decisionBadge(verdict.final_decision)}
                            {v.quality_score != null && (
                              <div className="w-20">
                                <Progress value={v.quality_score} className="h-1.5" />
                              </div>
                            )}
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>

                        {/* Expanded: Debate Thread */}
                        {isExpanded && (
                          <div className="border-t border-border/50 bg-muted/10 p-4 space-y-3">
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                              <MessageSquare className="h-4 w-4" />Debate Thread
                            </h4>
                            {messages.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Keine Messages vorhanden.</p>
                            ) : (
                              messages.map(m => (
                                <div
                                  key={m.id}
                                  className={`p-3 rounded-lg border text-sm ${
                                    m.message_type === 'verdict'
                                      ? 'border-primary/30 bg-primary/5'
                                      : m.message_type === 'critique'
                                      ? 'border-orange-500/30 bg-orange-500/5'
                                      : m.message_type === 'proposal'
                                      ? 'border-blue-500/30 bg-blue-500/5'
                                      : 'border-border/50'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <Badge variant="outline" className="text-xs">{m.agent_name}</Badge>
                                    <Badge variant="secondary" className="text-xs">{m.message_type}</Badge>
                                    <span className="text-xs text-muted-foreground ml-auto">
                                      {new Date(m.created_at).toLocaleString('de-DE')}
                                    </span>
                                  </div>
                                  <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground max-h-40 overflow-y-auto">
                                    {JSON.stringify(m.message_json, null, 2)}
                                  </pre>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Councils Tab ─── */}
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

        {/* ─── KPIs ─── */}
        <TabsContent value="kpis">
          <Card className="glass-card border-border/50">
            <CardHeader><CardTitle>Alle Council-KPIs</CardTitle></CardHeader>
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

        {/* ─── Escalations ─── */}
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
                      <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
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

        {/* ─── Kill Switches ─── */}
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
