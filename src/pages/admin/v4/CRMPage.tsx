import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Users, AlertTriangle, TrendingDown, Activity, Search,
  Gauge, Brain, Flame, Clock, UserCheck, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLearnerProfiles, useChurnPredictions, useLearnerSegments } from '@/hooks/useCRM';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

function LearnersTab() {
  const [riskFilter, setRiskFilter] = useState('all');
  const [search, setSearch] = useState('');
  const { data: learners = [], isLoading } = useLearnerProfiles({ riskFilter, search });

  const highRisk = learners.filter(l => (l.churn_risk_score || 0) >= 0.7).length;
  const avgReadiness = learners.length
    ? Math.round(learners.reduce((s, l) => s + (l.exam_readiness_score || 0), 0) / learners.length * 100)
    : 0;
  const inactive = learners.filter(l => {
    if (!l.last_activity_at) return true;
    const d = Date.now() - new Date(l.last_activity_at).getTime();
    return d > 7 * 24 * 60 * 60 * 1000;
  }).length;

  const getRiskColor = (score: number | null) => {
    if (!score) return 'text-muted-foreground';
    if (score >= 0.7) return 'text-destructive';
    if (score >= 0.3) return 'text-yellow-600';
    return 'text-emerald-600';
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Lerner gesamt</p>
          <p className="text-2xl font-bold">{learners.length}</p>
        </CardContent></Card>
        <Card className="border-destructive/30"><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Hohes Churn-Risiko</p>
          <p className="text-2xl font-bold text-destructive">{highRisk}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ø Prüfungsreife</p>
          <p className="text-2xl font-bold">{avgReadiness}%</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Inaktiv &gt;7d</p>
          <p className="text-2xl font-bold text-yellow-600">{inactive}</p>
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Lerner suchen…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Risiko-Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="high">Hohes Risiko</SelectItem>
            <SelectItem value="medium">Mittleres Risiko</SelectItem>
            <SelectItem value="low">Niedriges Risiko</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">Lerner</th>
                <th className="text-left py-3 px-4">Lernstil</th>
                <th className="text-left py-3 px-4">Prüfungsreife</th>
                <th className="text-left py-3 px-4">Churn-Risiko</th>
                <th className="text-left py-3 px-4">Streak</th>
                <th className="text-left py-3 px-4">Letzte Aktivität</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : learners.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Keine Lerner gefunden</td></tr>
              ) : learners.map(l => (
                <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-xs">{l.display_name || l.user_id.slice(0, 8)}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-1.5">
                      <Brain className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs capitalize">{l.learning_style || '—'}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(l.exam_readiness_score || 0) * 100}%` }} />
                      </div>
                      <span className="text-xs">{Math.round((l.exam_readiness_score || 0) * 100)}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={cn("text-xs font-medium", getRiskColor(l.churn_risk_score))}>
                      {l.churn_risk_score != null ? `${Math.round(l.churn_risk_score * 100)}%` : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-1">
                      <Flame className="h-3 w-3 text-orange-500" />
                      <span className="text-xs">{l.streak_current || 0}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-xs text-muted-foreground">
                    {l.last_activity_at
                      ? format(new Date(l.last_activity_at), 'dd.MM.yy HH:mm', { locale: de })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function ChurnTab() {
  const { data: predictions = [], isLoading } = useChurnPredictions();

  const critical = predictions.filter(p => p.risk_level === 'critical').length;
  const high = predictions.filter(p => p.risk_level === 'high').length;
  const actionPending = predictions.filter(p => !p.action_taken).length;

  const riskVariant = (level: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (level === 'critical') return 'destructive';
    if (level === 'high') return 'destructive';
    if (level === 'medium') return 'secondary';
    return 'outline';
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-destructive/30"><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Kritisch</p>
          <p className="text-2xl font-bold text-destructive">{critical}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Hoch</p>
          <p className="text-2xl font-bold text-yellow-600">{high}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Aktion ausstehend</p>
          <p className="text-2xl font-bold text-orange-500">{actionPending}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">User</th>
                <th className="text-left py-3 px-4">Risiko</th>
                <th className="text-left py-3 px-4">Level</th>
                <th className="text-left py-3 px-4">Empfohlene Aktion</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Erkannt</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : predictions.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Keine Vorhersagen</td></tr>
              ) : predictions.map(p => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 px-4 text-xs font-mono">{p.user_id.slice(0, 8)}…</td>
                  <td className="py-2.5 px-4">
                    <span className="text-xs font-bold">{Math.round(p.risk_score * 100)}%</span>
                  </td>
                  <td className="py-2.5 px-4">
                    <Badge variant={riskVariant(p.risk_level)} className="text-[10px] capitalize">{p.risk_level}</Badge>
                  </td>
                  <td className="py-2.5 px-4 text-xs">{p.recommended_action || '—'}</td>
                  <td className="py-2.5 px-4">
                    {p.action_taken
                      ? <Badge variant="outline" className="text-[10px] text-emerald-600 bg-emerald-500/10">{p.action_taken}</Badge>
                      : <Badge variant="outline" className="text-[10px] text-yellow-600 bg-yellow-500/10">Ausstehend</Badge>}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-muted-foreground">
                    {format(new Date(p.predicted_at), 'dd.MM.yy', { locale: de })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function SegmentsTab() {
  const { data: segments = [], isLoading } = useLearnerSegments();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">{segments.length} Segmente</Badge>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground text-sm">Laden…</div>
      ) : segments.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">
          Keine Segmente angelegt. Segmente werden automatisch durch das CRM-System erstellt.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {segments.map(seg => (
            <Card key={seg.id} className="hover:bg-muted/30 transition-colors">
              <CardContent className="py-4 px-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color || 'hsl(var(--primary))' }} />
                  <span className="font-medium text-sm">{seg.name}</span>
                  {seg.is_dynamic && <Badge variant="outline" className="text-[10px]">Dynamisch</Badge>}
                </div>
                {seg.description && <p className="text-xs text-muted-foreground">{seg.description}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main CRM Overview
// ═══════════════════════════════════════════════════════════
export default function CRMPage() {
  const location = useLocation();
  const subPath = location.pathname.replace('/admin/crm', '').replace(/^\//, '');

  const tabs = [
    { path: '/admin/crm', label: 'Lerner', icon: Users, key: '' },
    { path: '/admin/crm/churn', label: 'Churn Risk', icon: TrendingDown, key: 'churn' },
    { path: '/admin/crm/segments', label: 'Segmente', icon: UserCheck, key: 'segments' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">CRM</h1>
        <p className="text-sm text-muted-foreground mt-1">Lerner-Profile · Churn-Erkennung · Segmente</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = subPath === tab.key;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px",
                isActive
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {tab.label}
            </Link>
          );
        })}
      </div>

      {subPath === '' && <LearnersTab />}
      {subPath === 'churn' && <ChurnTab />}
      {subPath === 'segments' && <SegmentsTab />}
    </div>
  );
}
