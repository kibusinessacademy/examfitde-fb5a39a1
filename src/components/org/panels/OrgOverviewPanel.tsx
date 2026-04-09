import { OrgContext } from '@/hooks/useOrgConsole';
import { KpiCard, CommandKpiStrip } from '@/components/admin/enterprise/shared/CommandKpiStrip';
import { Users, Armchair, CreditCard, AlertTriangle, Activity, Link2, Upload, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SeatUsageBar } from '@/components/admin/enterprise/shared/StatusBadge';

interface Props {
  orgId: string;
  context: OrgContext | null | undefined;
}

export default function OrgOverviewPanel({ orgId, context }: Props) {
  if (!context) return null;

  const members = context.members || [];
  const seats = context.seats || [];
  const summary = context.seat_summary || {};
  const activeSeats = summary['active'] || summary['ACTIVE'] || 0;
  const totalSeats = seats.length;

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <CommandKpiStrip>
        <KpiCard label="Aktive Nutzer" value={members.length} icon={<Users className="h-4 w-4 text-primary" />} tone="neutral" />
        <KpiCard label="Aktive Seats" value={activeSeats} icon={<Armchair className="h-4 w-4 text-success" />} tone="green" />
        <KpiCard label="Seats gesamt" value={totalSeats} icon={<Armchair className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard
          label="Seat-Auslastung"
          value={totalSeats > 0 ? `${Math.round((activeSeats / totalSeats) * 100)}%` : '–'}
          icon={<Activity className="h-4 w-4 text-warning" />}
          tone={totalSeats > 0 && activeSeats / totalSeats > 0.9 ? 'red' : totalSeats > 0 && activeSeats / totalSeats > 0.7 ? 'yellow' : 'green'}
        />
        <KpiCard label="Entitäten" value={context.entities?.length || 0} icon={<CreditCard className="h-4 w-4 text-primary" />} />
      </CommandKpiStrip>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Seat Usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Seat-Auslastung</CardTitle>
          </CardHeader>
          <CardContent>
            <SeatUsageBar used={activeSeats} total={Math.max(totalSeats, 1)} />
            <p className="text-xs text-muted-foreground mt-2">
              {activeSeats} von {totalSeats} Seats belegt
            </p>
          </CardContent>
        </Card>

        {/* Integration Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Integrationen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5"><Link2 className="h-3 w-3" /> SSO</span>
              <span className="text-muted-foreground">–</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5"><Link2 className="h-3 w-3" /> SCIM</span>
              <span className="text-muted-foreground">–</span>
            </div>
          </CardContent>
        </Card>

        {/* Privacy Access */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Datenschutz</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-xs">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Scope: <strong>{context.privacy_access?.scope || 'ANONYMIZED'}</strong></span>
            </div>
            <div className="flex items-center gap-2 text-xs mt-1">
              <span>Status: <strong>{context.privacy_access?.status || 'NONE'}</strong></span>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Schnellaktionen</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              <Upload className="h-3 w-3" /> Nutzer importieren
            </Button>
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              <Armchair className="h-3 w-3" /> Seat zuweisen
            </Button>
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              <Link2 className="h-3 w-3" /> SSO testen
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
