import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  Activity, AlertTriangle, CheckCircle2, Pause, Play, 
  ArrowUpRight, Shield, Brain, TrendingUp
} from 'lucide-react';

const councilMeta: Record<string, { title: string; description: string; kpis: string[]; automations: string[] }> = {
  education: {
    title: 'Education Council',
    description: 'Steuert Kursqualität, Didaktik und Lernpfade. Ziel: Score ≥ 92 für alle Lektionen.',
    kpis: ['Ø Kurs-Quality-Score', 'Lessons < 92', 'Kompetenz-Abdeckung', 'MiniCheck Pass-Rate'],
    automations: ['Auto-Improve Agent', 'Kompetenz-Scaffolding', 'Claude Validation'],
  },
  exam: {
    title: 'Exam Council',
    description: 'Verwaltet Prüfungsfragen, Blueprints und Exam-Simulationen.',
    kpis: ['Blueprint Coverage', 'Varianten-Pool', 'Ø Bestehensquote', 'Schwierigkeitsverteilung'],
    automations: ['Blueprint-Generator', 'Varianten-Engine', 'Difficulty Balancer'],
  },
  marketing: {
    title: 'Marketing & Sales Council',
    description: 'Steuert Wachstum über datengetriebene Experimente und ROI-Optimierung.',
    kpis: ['CAC', 'LTV', 'Conversion Rate', 'Monatsbudget-Verbrauch'],
    automations: ['Content-Pipeline (DeepSeek)', 'A/B-Test Engine', 'Kill-Switch Monitor'],
  },
  product: {
    title: 'Product Council',
    description: 'Orchestriert die Produkterstellung vom Curriculum bis zum fertigen Kurs.',
    kpis: ['Pipeline-Status', 'Time-to-Publish', 'Quality Gate Pass-Rate', 'Offene Scaffolds'],
    automations: ['Product Orchestrator', 'Quality Gate Chain', 'Auto-Publish'],
  },
  tech: {
    title: 'Tech & Platform Council',
    description: 'Überwacht Systemgesundheit, Performance und Sicherheit.',
    kpis: ['Error Rate', 'Avg Response Time', 'Queue Backlog', 'Uptime'],
    automations: ['Self-Healing Engine', 'Job Maintenance', 'Health Checks'],
  },
  legal: {
    title: 'Legal & Compliance Council',
    description: 'Sichert AZAV-Konformität, DSGVO und IHK-Standards.',
    kpis: ['AZAV Score', 'RLS Guard Status', 'Audit Readiness', 'Compliance Checks'],
    automations: ['Compliance Scanner', 'RLS Guard Monitor', 'Evidence Pack Generator'],
  },
  analytics: {
    title: 'Analytics Council',
    description: 'Aggregiert Business Intelligence und Learner Analytics.',
    kpis: ['Umsatz MTD', 'Aktive Nutzer', 'Churn Rate', 'NPS'],
    automations: ['KPI Aggregator', 'Anomaly Detection', 'Report Generator'],
  },
  operations: {
    title: 'Operations Council',
    description: 'Verwaltet AI-Worker, Budgets und operative Prozesse.',
    kpis: ['AI-Kosten MTD', 'Worker Auslastung', 'Budget-Verbrauch %', 'Fehlerrate'],
    automations: ['Budget Controller', 'Worker Governor', 'Cost Optimizer'],
  },
};

export default function CouncilPage() {
  const { councilId } = useParams<{ councilId: string }>();
  const council = councilMeta[councilId || ''] || {
    title: 'Council',
    description: 'Council-Seite',
    kpis: [],
    automations: [],
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Brain className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-display font-bold text-foreground">{council.title}</h1>
            <Badge variant="outline" className="bg-success/10 text-success border-success/30">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Aktiv
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm max-w-2xl">{council.description}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Pause className="h-4 w-4 mr-1" /> Pausieren
          </Button>
          <Button variant="destructive" size="sm">
            <Shield className="h-4 w-4 mr-1" /> Kill-Switch
          </Button>
        </div>
      </div>

      {/* A) Status & KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {council.kpis.map((kpi, i) => (
          <Card key={kpi} className="glass-card">
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{kpi}</p>
              <div className="flex items-end gap-2 mt-1">
                <span className="text-2xl font-bold text-foreground">
                  {['94.2', '3', '98%', '87%'][i] || '—'}
                </span>
                <span className="text-xs text-success flex items-center mb-1">
                  <TrendingUp className="h-3 w-3 mr-0.5" /> +2.1%
                </span>
              </div>
              <Progress value={[94, 15, 98, 87][i]} className="mt-2 h-1.5" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* B) Aktive Automationen */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Aktive Automationen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {council.automations.map((auto) => (
              <div key={auto} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  <span className="text-sm font-medium text-foreground">{auto}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">Running</Badge>
                  <Button variant="ghost" size="sm">
                    <Pause className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* C) Empfehlungen */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> Empfehlungen
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { text: '3 Lektionen unter Quality-Threshold (< 92)', impact: 'Hoch', risk: 'Mittel' },
              { text: 'Blueprint-Varianten-Pool unter Minimum', impact: 'Mittel', risk: 'Niedrig' },
            ].map((rec, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-warning/5 border border-warning/20">
                <div>
                  <p className="text-sm font-medium text-foreground">{rec.text}</p>
                  <div className="flex gap-3 mt-1">
                    <span className="text-xs text-muted-foreground">Impact: <strong className="text-warning">{rec.impact}</strong></span>
                    <span className="text-xs text-muted-foreground">Risiko: <strong>{rec.risk}</strong></span>
                  </div>
                </div>
                <Button size="sm" variant="outline">
                  <ArrowUpRight className="h-3 w-3 mr-1" /> Drill-down
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* D) Aktionen */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">Aktionen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button size="sm"><Play className="h-4 w-4 mr-1" /> Automation starten</Button>
            <Button size="sm" variant="outline"><Pause className="h-4 w-4 mr-1" /> Pausieren</Button>
            <Button size="sm" variant="outline"><ArrowUpRight className="h-4 w-4 mr-1" /> Eskalieren</Button>
            <Button size="sm" variant="secondary"><Shield className="h-4 w-4 mr-1" /> Manuell übersteuern</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
