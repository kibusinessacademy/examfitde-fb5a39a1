import { useState, useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreditCard, Calendar, Loader2 } from 'lucide-react';
import { useAdminLicenses, type AdminLicense } from '@/hooks/useAdminLicenses';
import { StatusBadge, SeatUsageBar, SourceBadge } from './shared/StatusBadge';
import { KpiCard, CommandKpiStrip } from './shared/CommandKpiStrip';
import { EmptyState } from './shared/EmptyState';

export default function LicensesPanel() {
  const { data: licenses, isLoading } = useAdminLicenses();
  const [selected, setSelected] = useState<AdminLicense | null>(null);

  const kpis = useMemo(() => {
    if (!licenses) return null;
    const active = licenses.filter(l => l.status === 'active');
    const totalSeats = active.reduce((s, l) => s + l.seats_total, 0);
    const usedSeats = active.reduce((s, l) => s + l.seats_used, 0);
    const expiring = active.filter(l => {
      if (!l.ends_at) return false;
      const days = (new Date(l.ends_at).getTime() - Date.now()) / 86400000;
      return days > 0 && days <= 30;
    });
    return {
      active: active.length,
      expiring: expiring.length,
      totalSeats,
      usedSeats,
      freeSeats: totalSeats - usedSeats,
    };
  }, [licenses]);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('de-DE') : '∞';

  return (
    <div className="space-y-4">
      {kpis && (
        <CommandKpiStrip>
          <KpiCard label="Aktive Lizenzen" value={kpis.active} icon={<CreditCard className="h-4 w-4 text-primary" />} tone="green" />
          <KpiCard label="Läuft ab (30d)" value={kpis.expiring} icon={<Calendar className="h-4 w-4 text-warning" />} tone={kpis.expiring > 0 ? 'yellow' : 'neutral'} />
          <KpiCard label="Seats gesamt" value={kpis.totalSeats} icon={<CreditCard className="h-4 w-4 text-muted-foreground" />} />
          <KpiCard label="Seats belegt" value={kpis.usedSeats} icon={<CreditCard className="h-4 w-4 text-success" />} />
          <KpiCard label="Seats frei" value={kpis.freeSeats} icon={<CreditCard className="h-4 w-4 text-primary" />} tone={kpis.freeSeats > 0 ? 'green' : 'neutral'} />
        </CommandKpiStrip>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : !licenses?.length ? (
        <EmptyState
          icon={<CreditCard className="h-6 w-6 text-muted-foreground" />}
          title="Noch keine Lizenzen vorhanden"
          description="Lege eine manuelle Lizenz an oder starte einen Checkout."
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Organisation</TableHead>
                <TableHead className="text-xs hidden sm:table-cell">Produkt</TableHead>
                <TableHead className="text-xs">Seats</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Laufzeit</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Status</TableHead>
                <TableHead className="text-xs hidden lg:table-cell">Quelle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licenses.map(lic => (
                <TableRow key={lic.license_id} className="cursor-pointer" onClick={() => setSelected(lic)}>
                  <TableCell className="py-2">
                    <div className="text-sm font-medium truncate max-w-[180px]">{lic.org_name || '–'}</div>
                    <div className="text-[10px] text-muted-foreground sm:hidden truncate">{lic.product_title}</div>
                  </TableCell>
                  <TableCell className="py-2 text-xs hidden sm:table-cell truncate max-w-[180px]">{lic.product_title || '–'}</TableCell>
                  <TableCell className="py-2"><SeatUsageBar used={lic.seats_used} total={lic.seats_total} /></TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground hidden md:table-cell">{formatDate(lic.starts_at)} – {formatDate(lic.ends_at)}</TableCell>
                  <TableCell className="py-2 hidden md:table-cell"><StatusBadge status={lic.status} /></TableCell>
                  <TableCell className="py-2 hidden lg:table-cell">{lic.source_type ? <SourceBadge source={lic.source_type} /> : '–'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Lizenzdetails</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Übersicht</CardTitle></CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Organisation</span><span className="font-medium">{selected.org_name || '–'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Produkt</span><span>{selected.product_title || '–'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Lizenz-ID</span><span className="font-mono text-[10px]">{selected.license_id.slice(0, 8)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={selected.status} /></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Quelle</span><span>{selected.source_type || '–'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Laufzeit</span><span>{formatDate(selected.starts_at)} – {formatDate(selected.ends_at)}</span></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Seat-Auslastung</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 mb-3">
                    <div className="text-center">
                      <div className="text-lg font-bold">{selected.seats_total}</div>
                      <div className="text-[10px] text-muted-foreground">Gesamt</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-success">{selected.seats_used}</div>
                      <div className="text-[10px] text-muted-foreground">Belegt</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-primary">{selected.seats_available}</div>
                      <div className="text-[10px] text-muted-foreground">Frei</div>
                    </div>
                  </div>
                  <SeatUsageBar used={selected.seats_used} total={selected.seats_total} />
                </CardContent>
              </Card>
              {selected.source_ref && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Referenz</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-xs font-mono text-muted-foreground break-all">{selected.source_ref}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
