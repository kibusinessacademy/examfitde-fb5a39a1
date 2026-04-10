import { useInstitutionDashboard } from '@/hooks/useOrgConsole';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, School, Building2, BookOpen, Users, GraduationCap, AlertTriangle, TrendingUp, Clock } from 'lucide-react';

interface InstitutionDashboardProps {
  orgId: string;
  orgName: string;
  orgType: string;
}

const RISK_COLORS: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive border-destructive/20',
  medium: 'bg-warning/10 text-warning-foreground border-warning/20',
  low: 'bg-accent/10 text-accent-foreground border-accent/20',
  not_started: 'bg-muted text-muted-foreground border-border',
};

export default function InstitutionDashboard({ orgId, orgName, orgType }: InstitutionDashboardProps) {
  const { data, isLoading, error } = useInstitutionDashboard(orgId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {orgType}-Dashboard konnte nicht geladen werden.
        </CardContent>
      </Card>
    );
  }

  const { kpis, linked_orgs, curricula, risk_distribution, recent_activity } = data;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={School} label="Schulen" value={kpis?.linked_schools_count ?? 0} />
        <KpiCard icon={Building2} label="Unternehmen" value={kpis?.linked_companies_count ?? 0} />
        <KpiCard icon={BookOpen} label="Curricula" value={kpis?.active_curricula_count ?? 0} />
        <KpiCard icon={Users} label="Lernende" value={kpis?.active_learners_count ?? 0} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard icon={GraduationCap} label="Klassen" value={kpis?.active_classes_count ?? 0} />
        <KpiCard icon={TrendingUp} label="Ø Prüfungsreife" value={`${Math.round(kpis?.avg_readiness_score ?? 0)}%`} />
        <KpiCard icon={AlertTriangle} label="High Risk" value={kpis?.high_risk_count ?? 0} color="destructive" />
      </div>

      {/* Linked Orgs: Schools + Companies */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OrgListCard
          title="Verknüpfte Schulen"
          icon={School}
          orgs={linked_orgs?.schools ?? []}
          emptyText="Keine Schulen verknüpft"
        />
        <OrgListCard
          title="Verknüpfte Unternehmen"
          icon={Building2}
          orgs={linked_orgs?.companies ?? []}
          emptyText="Keine Unternehmen verknüpft"
        />
      </div>

      {/* Curricula Table */}
      {curricula?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Curricula</CardTitle>
            <CardDescription>{curricula.length} aktive Curricula im Governance-Bereich</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Curriculum</TableHead>
                  <TableHead className="text-right">Klassen</TableHead>
                  <TableHead className="text-right">Lernende</TableHead>
                  <TableHead className="text-right">Ø Prüfungsreife</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {curricula.map((c: any) => (
                  <TableRow key={c.curriculum_id}>
                    <TableCell className="font-medium">{c.title ?? 'Unbekannt'}</TableCell>
                    <TableCell className="text-right">{c.active_classes}</TableCell>
                    <TableCell className="text-right">{c.active_learners}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono">{Math.round(c.avg_readiness_score ?? 0)}%</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Risk Distribution + Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Risiko-Verteilung</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: 'high', label: 'Hoch' },
                { key: 'medium', label: 'Mittel' },
                { key: 'low', label: 'Niedrig' },
                { key: 'not_started', label: 'Nicht gestartet' },
              ] as const).map(({ key, label }) => (
                <div key={key} className={`rounded-lg border p-3 ${RISK_COLORS[key]}`}>
                  <div className="text-lg font-bold">{risk_distribution?.[key] ?? 0}</div>
                  <div className="text-xs">{label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Aktivität</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <ActivityRow icon={Clock} label="Letzte 7 Tage" value={recent_activity?.active_last_7_days ?? 0} />
              <ActivityRow icon={Clock} label="Letzte 14 Tage" value={recent_activity?.active_last_14_days ?? 0} />
              <ActivityRow icon={AlertTriangle} label="Inaktiv > 14 Tage" value={recent_activity?.inactive_over_14_days ?? 0} warn />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${color === 'destructive' ? 'text-destructive' : 'text-muted-foreground'}`} />
          <CardDescription>{label}</CardDescription>
        </div>
        <CardTitle className={`text-2xl ${color === 'destructive' ? 'text-destructive' : ''}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function OrgListCard({ title, icon: Icon, orgs, emptyText }: { title: string; icon: any; orgs: any[]; emptyText: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">{title}</CardTitle>
        </div>
        <CardDescription>{orgs.length} verknüpft</CardDescription>
      </CardHeader>
      <CardContent>
        {orgs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">{emptyText}</p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {orgs.map((o: any) => (
              <div key={o.org_id} className="flex items-center justify-between rounded border px-3 py-2">
                <span className="text-sm font-medium">{o.name}</span>
                <Badge variant="outline" className="text-[10px]">{o.link_type}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ icon: Icon, label, value, warn }: { icon: any; label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm">
        <Icon className={`h-3.5 w-3.5 ${warn ? 'text-destructive' : 'text-muted-foreground'}`} />
        <span>{label}</span>
      </div>
      <span className={`font-mono text-sm font-medium ${warn && value > 0 ? 'text-destructive' : ''}`}>{value}</span>
    </div>
  );
}
