import { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, AlertTriangle, Clock, UserX, Mail,
  Bell, MessageSquare, Tag, ArrowRight
} from 'lucide-react';
import PageExplainer from '@/components/admin/PageExplainer';

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { path: '/admin/growth', label: 'Churn' },
  { path: '/admin/growth/nudges', label: 'Nudge Engine' },
  { path: '/admin/growth/feedback', label: 'Feedback' },
];

/* ── Churn Dashboard ── */
function ChurnDashboard() {
  const [predictions, setPredictions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('churn_predictions')
        .select('*')
        .order('risk_score', { ascending: false })
        .limit(50);
      setPredictions(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;

  const highRisk = predictions.filter(p => (p.risk_score || 0) > 70);
  const medRisk = predictions.filter(p => (p.risk_score || 0) > 40 && (p.risk_score || 0) <= 70);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Hohes Risiko</p>
            <p className="text-2xl font-bold text-destructive">{highRisk.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Mittleres Risiko</p>
            <p className="text-2xl font-bold text-warning">{medRisk.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Überwacht</p>
            <p className="text-2xl font-bold text-foreground">{predictions.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        {predictions.map(p => {
          const score = p.risk_score || 0;
          const signals = p.signals || {};
          return (
            <Card key={p.id} className={cn("border-l-4",
              score > 70 ? 'border-l-destructive' : score > 40 ? 'border-l-warning' : 'border-l-success'
            )}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <UserX className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground truncate">
                        User {p.user_id?.substring(0, 8)}…
                      </span>
                      <Badge variant="outline" className={cn("text-[10px]",
                        score > 70 ? 'bg-destructive/10 text-destructive' :
                        score > 40 ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
                      )}>
                        {score}% Risiko
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {signals.days_inactive && (
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {signals.days_inactive}T inaktiv</span>
                      )}
                      {signals.low_completion && (
                        <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Niedrige Abschlussrate</span>
                      )}
                      {p.last_activity_at && (
                        <span>Letzte Aktivität: {new Date(p.last_activity_at).toLocaleDateString('de-DE')}</span>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {p.recommended_action || 'Beobachten'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {predictions.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <UserX className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground mb-1">Keine Churn-Vorhersagen</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Churn-Vorhersagen werden automatisch erstellt, sobald Nutzer auf der Plattform aktiv sind und das System genügend Verhaltensdaten gesammelt hat (min. 7 Tage Aktivität).
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ── Nudge Engine ── */
function NudgeEngine() {
  const [actions, setActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('growth_actions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      setActions(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;

  const templateIcons: Record<string, React.ElementType> = {
    email: Mail, 'in-app': Bell, reminder: Clock,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {['proposed', 'approved', 'sent'].map(status => (
          <Card key={status}>
            <CardContent className="py-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{status}</p>
              <p className="text-2xl font-bold text-foreground">{actions.filter(a => a.status === status).length}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Regeln: 3T inaktiv → Erinnerung · Integrität &lt;70% → Lernhinweis · Prüfung in 14T → Motivation
        </p>
        {actions.map(a => {
          const Icon = templateIcons[a.channel] || Bell;
          return (
            <Card key={a.id}>
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{a.action_type || a.nudge_type || 'Nudge'}</p>
                    <p className="text-xs text-muted-foreground truncate">{a.message || '–'}</p>
                  </div>
                </div>
                <Badge variant="outline" className={cn("text-xs",
                  a.status === 'sent' ? 'bg-success/10 text-success' :
                  a.status === 'approved' ? 'bg-primary/10 text-primary' : ''
                )}>{a.status}</Badge>
              </CardContent>
            </Card>
          );
        })}
        {actions.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Bell className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground mb-1">Nudge Engine inaktiv</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Nudges werden automatisch generiert, sobald Churn-Vorhersagen vorliegen. Regeln: 3 Tage inaktiv → Erinnerung, Integrität &lt;70% → Lernhinweis, Prüfung in 14 Tagen → Motivation.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ── Feedback Inbox ── */
function FeedbackInbox() {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      setFeedback(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {feedback.map(f => (
          <Card key={f.id}>
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{f.subject || f.title || 'Feedback'}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{f.message || f.description || '–'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {f.tags && (
                    <div className="flex items-center gap-1">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">{Array.isArray(f.tags) ? f.tags.join(', ') : f.tags}</span>
                    </div>
                  )}
                  <Badge variant="outline" className="text-xs">{f.status || 'offen'}</Badge>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {new Date(f.created_at).toLocaleDateString('de-DE')}
              </p>
            </CardContent>
          </Card>
        ))}
        {feedback.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <MessageSquare className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground mb-1">Kein Feedback vorhanden</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Feedback und Support-Tickets erscheinen hier, sobald Nutzer über die Plattform Anfragen stellen. Ticket-Typen: Verständnisfragen, Technik, Prüfungsangst, Lernstrategie, Abrechnung.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function GrowthPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname === t.path)?.path ||
    tabs.find(t => location.pathname.startsWith(t.path) && t.path !== '/admin/growth')?.path ||
    tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Wachstum & CRM</h1>
        <p className="text-sm text-muted-foreground">Churn-Prävention, Nudge Engine, Feedback</p>
      </div>

      <PageExplainer
        title="Wie funktioniert Wachstum & CRM?"
        description="Proaktive Kundenbindung und Wachstumssteuerung. Das Churn-Dashboard zeigt gefährdete Nutzer mit Risiko-Score und Signalen (Inaktivität, niedrige Abschlussrate). Die Nudge Engine sendet automatisierte Interventionen."
        workflow={[
          { label: 'Leitstelle' },
          { label: 'Studio' },
          { label: 'Quality' },
          { label: 'Ops' },
          { label: 'Business' },
          { label: 'Growth', active: true },
          { label: 'Scale' },
        ]}
        actions={[
          '"Churn" – Risiko-Dashboard: Nutzer sortiert nach Abwanderungsrisiko (0–100%). Signale: Inaktivitätstage, Abschlussrate',
          '"Nudge Engine" – Automatische Aktionen: E-Mail, In-App-Benachrichtigungen. Regeln: 3T inaktiv, Integrität <70%, Prüfung in 14T',
          '"Feedback" – Support-Tickets und Nutzerfeedback zentral einsehen und bearbeiten',
        ]}
        tips={[
          'Nutzer mit Score > 70% sind Hochrisiko und brauchen sofortige Intervention',
          'Nudges durchlaufen den Status: proposed → approved → sent',
          'Feedback-Tags helfen beim Erkennen wiederkehrender Probleme',
        ]}
      />

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Routes>
        <Route index element={<ChurnDashboard />} />
        <Route path="nudges" element={<NudgeEngine />} />
        <Route path="feedback" element={<FeedbackInbox />} />
      </Routes>
    </div>
  );
}
