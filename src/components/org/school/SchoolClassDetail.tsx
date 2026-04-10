import { useSchoolClassDetail } from '@/hooks/useOrgConsole';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ArrowLeft, Users, TrendingUp, AlertTriangle, Clock } from 'lucide-react';

interface Props {
  classId: string;
  onBack: () => void;
}

const RISK_COLORS: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive border-destructive/20',
  medium: 'bg-warning/10 text-warning-foreground border-warning/20',
  low: 'bg-accent/10 text-accent-foreground border-accent/20',
  not_started: 'bg-muted text-muted-foreground border-border',
};

const RISK_LABELS: Record<string, string> = {
  high: 'Hoch',
  medium: 'Mittel',
  low: 'Niedrig',
  not_started: 'Nicht gestartet',
};

export default function SchoolClassDetail({ classId, onBack }: Props) {
  const { data, isLoading, error } = useSchoolClassDetail(classId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Zurück
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Klassendetails konnten nicht geladen werden.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { kpis, students, instructors, readiness_distribution, activity_summary } = data;
  const classInfo = data.class;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Zurück
        </Button>
        <div>
          <h2 className="text-lg font-semibold">{classInfo?.name}</h2>
          <p className="text-sm text-muted-foreground">
            {classInfo?.curriculum_title ?? 'Kein Curriculum'} · {classInfo?.academic_year ?? '–'}
          </p>
        </div>
        <Badge variant={classInfo?.status === 'active' ? 'default' : 'secondary'} className="ml-auto">
          {classInfo?.status}
        </Badge>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Users} label="Schüler" value={kpis?.student_count ?? 0} />
        <KpiCard icon={TrendingUp} label="Ø Prüfungsreife" value={`${Math.round(kpis?.avg_readiness_score ?? 0)}%`} />
        <KpiCard icon={TrendingUp} label="Ø Fortschritt" value={`${Math.round(kpis?.avg_progress_pct ?? 0)}%`} />
        <KpiCard icon={AlertTriangle} label="High Risk" value={kpis?.high_risk_count ?? 0} color="destructive" />
      </div>

      {/* Readiness Distribution + Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Risiko-Verteilung</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {(['high', 'medium', 'low', 'not_started'] as const).map(level => (
                <div key={level} className={`rounded-lg border p-3 ${RISK_COLORS[level]}`}>
                  <div className="text-lg font-bold">{readiness_distribution?.[level] ?? 0}</div>
                  <div className="text-xs">{RISK_LABELS[level]}</div>
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
              <ActivityRow icon={Clock} label="Letzte 7 Tage" value={activity_summary?.active_last_7_days ?? 0} />
              <ActivityRow icon={Clock} label="Letzte 14 Tage" value={activity_summary?.active_last_14_days ?? 0} />
              <ActivityRow icon={AlertTriangle} label="Inaktiv > 14 Tage" value={activity_summary?.inactive_over_14_days ?? 0} warn />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Students Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schüler</CardTitle>
          <CardDescription>{students?.length ?? 0} Lernende in dieser Klasse</CardDescription>
        </CardHeader>
        <CardContent>
          {!students?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">Keine Schüler zugeordnet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Prüfungsreife</TableHead>
                    <TableHead>Fortschritt</TableHead>
                    <TableHead>Risiko</TableHead>
                    <TableHead>Letzte Aktivität</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((s: any) => (
                    <TableRow key={s.user_id}>
                      <TableCell>
                        <div>
                          <span className="font-medium text-sm">{s.full_name ?? 'Unbekannt'}</span>
                          <span className="block text-xs text-muted-foreground">{s.email ?? ''}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{s.readiness_score ?? 0}%</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${Math.min(s.progress_pct ?? 0, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{s.progress_pct ?? 0}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${RISK_COLORS[s.risk_level] ?? ''}`}>
                          {RISK_LABELS[s.risk_level] ?? s.risk_level ?? '–'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.inactive_days != null ? (
                          s.inactive_days > 14
                            ? <span className="text-destructive">{s.inactive_days}d inaktiv</span>
                            : `vor ${s.inactive_days}d`
                        ) : '–'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instructors */}
      {instructors?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lehrkräfte</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {instructors.map((i: any) => (
                <div key={i.assignment_id ?? i.user_id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <span className="font-medium text-sm">{i.full_name ?? 'Unbekannt'}</span>
                    <span className="block text-xs text-muted-foreground">{i.email ?? ''}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{i.assignment_type ?? i.role ?? 'instructor'}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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
