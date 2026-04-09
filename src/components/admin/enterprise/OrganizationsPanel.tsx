import { useState, useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Building2, Users, CreditCard } from 'lucide-react';
import { useAdminOrganizations, type AdminOrganization } from '@/hooks/useAdminLicenses';
import { SeatUsageBar } from './shared/StatusBadge';
import { KpiCard, CommandKpiStrip } from './shared/CommandKpiStrip';
import { EmptyState } from './shared/EmptyState';

export default function OrganizationsPanel() {
  const { data: orgs, isLoading } = useAdminOrganizations();
  const [selected, setSelected] = useState<AdminOrganization | null>(null);

  const kpis = useMemo(() => {
    if (!orgs) return null;
    const withLicense = orgs.filter(o => o.active_licenses > 0);
    const totalSeats = orgs.reduce((s, o) => s + o.total_seats, 0);
    const usedSeats = orgs.reduce((s, o) => s + o.used_seats, 0);
    return {
      total: orgs.length,
      withLicense: withLicense.length,
      totalSeats,
      freeSeats: totalSeats - usedSeats,
    };
  }, [orgs]);

  return (
    <div className="space-y-4">
      {kpis && (
        <CommandKpiStrip>
          <KpiCard label="Organisationen" value={kpis.total} icon={<Building2 className="h-4 w-4 text-primary" />} />
          <KpiCard label="Mit Lizenz" value={kpis.withLicense} icon={<CreditCard className="h-4 w-4 text-success" />} tone="green" />
          <KpiCard label="Seats gesamt" value={kpis.totalSeats} icon={<Users className="h-4 w-4 text-muted-foreground" />} />
          <KpiCard label="Seats frei" value={kpis.freeSeats} icon={<Users className="h-4 w-4 text-primary" />} />
        </CommandKpiStrip>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : !orgs?.length ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6 text-muted-foreground" />}
          title="Noch keine Organisationen angelegt"
          description="Organisationen werden automatisch über SCIM, Bulk Import oder Stripe angelegt."
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs hidden sm:table-cell">Typ</TableHead>
                <TableHead className="text-xs">Mitglieder</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Lizenzen</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Seats</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map(org => (
                <TableRow key={org.org_id} className="cursor-pointer" onClick={() => setSelected(org)}>
                  <TableCell className="py-2">
                    <div className="text-sm font-medium truncate max-w-[200px]">{org.name}</div>
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground hidden sm:table-cell capitalize">{org.org_type || '–'}</TableCell>
                  <TableCell className="py-2 text-xs">{org.member_count}</TableCell>
                  <TableCell className="py-2 text-xs hidden md:table-cell">{org.active_licenses}</TableCell>
                  <TableCell className="py-2 hidden md:table-cell"><SeatUsageBar used={org.used_seats} total={org.total_seats} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Organisation: {selected?.name}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Übersicht</CardTitle></CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{selected.name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Typ</span><span className="capitalize">{selected.org_type || '–'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Mitglieder</span><span>{selected.member_count}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Aktive Lizenzen</span><span>{selected.active_licenses}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Erstellt</span><span>{new Date(selected.created_at).toLocaleDateString('de-DE')}</span></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Seat-Auslastung</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 mb-3">
                    <div className="text-center">
                      <div className="text-lg font-bold">{selected.total_seats}</div>
                      <div className="text-[10px] text-muted-foreground">Gesamt</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-success">{selected.used_seats}</div>
                      <div className="text-[10px] text-muted-foreground">Belegt</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-primary">{selected.total_seats - selected.used_seats}</div>
                      <div className="text-[10px] text-muted-foreground">Frei</div>
                    </div>
                  </div>
                  <SeatUsageBar used={selected.used_seats} total={selected.total_seats} />
                </CardContent>
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
