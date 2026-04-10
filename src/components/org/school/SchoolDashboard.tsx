import { useState } from 'react';
import { useSchoolDashboard } from '@/hooks/useOrgConsole';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Users, GraduationCap, BookOpen, Building2, School } from 'lucide-react';
import SchoolClassDetail from './SchoolClassDetail';

interface SchoolDashboardProps {
  orgId: string;
  orgName: string;
  capabilities: Record<string, boolean>;
}

export default function SchoolDashboard({ orgId, orgName, capabilities }: SchoolDashboardProps) {
  const { data, isLoading, error } = useSchoolDashboard(orgId);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

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
          Schul-Dashboard konnte nicht geladen werden.
        </CardContent>
      </Card>
    );
  }

  if (selectedClassId) {
    return (
      <SchoolClassDetail
        classId={selectedClassId}
        onBack={() => setSelectedClassId(null)}
      />
    );
  }

  const { kpis, classes, instructors, linked_orgs } = data;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard icon={BookOpen} label="Klassen" value={kpis?.total_classes ?? 0} sub={`${kpis?.active_classes ?? 0} aktiv`} />
        <KpiCard icon={Users} label="Lernende" value={kpis?.total_students ?? 0} />
        <KpiCard icon={GraduationCap} label="Lehrkräfte" value={kpis?.total_instructors ?? 0} />
        <KpiCard icon={School} label="Curricula" value={kpis?.total_curricula ?? 0} />
        <KpiCard icon={Building2} label="Verknüpfungen" value={linked_orgs?.length ?? 0} />
      </div>

      {/* Classes Table */}
      {capabilities?.view_classes !== false && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Klassen</CardTitle>
            <CardDescription>{classes?.length ?? 0} Klassen insgesamt</CardDescription>
          </CardHeader>
          <CardContent>
            {!classes?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">Noch keine Klassen angelegt.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Klasse</TableHead>
                    <TableHead>Curriculum</TableHead>
                    <TableHead>Schuljahr</TableHead>
                    <TableHead className="text-right">Schüler</TableHead>
                    <TableHead className="text-right">Lehrkräfte</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classes.map((c: any) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedClassId(c.id)}
                    >
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.curriculum_title ?? '–'}</TableCell>
                      <TableCell className="text-sm">{c.academic_year ?? '–'}</TableCell>
                      <TableCell className="text-right">{c.student_count ?? 0}</TableCell>
                      <TableCell className="text-right">{c.instructor_count ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant={c.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                          {c.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Linked Orgs */}
      {linked_orgs?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verknüpfte Organisationen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {linked_orgs.map((lo: any) => (
                <div key={lo.link_id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <span className="font-medium text-sm">{lo.partner_org_name ?? 'Unbekannt'}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{lo.partner_org_type}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{lo.link_type}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardDescription>{label}</CardDescription>
        </div>
        <CardTitle className="text-2xl">{value}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardHeader>
    </Card>
  );
}
