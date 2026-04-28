import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, Users, UserPlus, UserMinus, Key, CheckCircle2, CircleSlash, Layers } from "lucide-react";
import { useOrgDashboardOverview, useOrgLicenseList, useOrgSeatMembers, useAssignOrgSeat, useRevokeOrgSeat } from "@/hooks/useOrgDashboard";
import { toast } from "sonner";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

interface Props {
  organizationId: string;
}

export default function OrgSeatManagementPanel({ organizationId }: Props) {
  const { data: overview, isLoading: loadingOverview } = useOrgDashboardOverview(organizationId);
  const { data: licenses, isLoading: loadingLicenses } = useOrgLicenseList(organizationId);
  const { data: members, isLoading: loadingMembers } = useOrgSeatMembers(organizationId);
  const assignSeat = useAssignOrgSeat();
  const revokeSeat = useRevokeOrgSeat();

  const [assignUserId, setAssignUserId] = useState("");
  const [selectedLicense, setSelectedLicense] = useState<string>("");

  const activeLicenses = (licenses || []).filter(l => l.status === "active");
  const activeMembers = (members || []).filter(m => m.seat_status === "active");

  const handleAssign = async () => {
    if (!selectedLicense || !assignUserId.trim()) {
      toast.error("Lizenz und User-ID eingeben");
      return;
    }
    try {
      await assignSeat.mutateAsync({ licenseId: selectedLicense, userId: assignUserId.trim() });
      toast.success("Seat zugewiesen");
      setAssignUserId("");
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Zuweisen");
    }
  };

  const handleRevoke = async (licenseId: string, userId: string) => {
    try {
      await revokeSeat.mutateAsync({ licenseId, userId });
      toast.success("Seat entzogen");
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Entziehen");
    }
  };

  if (loadingOverview || loadingLicenses || loadingMembers) {
    return (
      <div data-density="comfortable" className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-petrol-600" />
      </div>
    );
  }

  const usedSeats = overview?.used_seats ?? 0;
  const totalSeats = overview?.total_seats ?? 0;
  const utilizationPct = totalSeats > 0 ? Math.round((usedSeats / totalSeats) * 100) : 0;

  return (
    <div data-density="comfortable" className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SeatKpiCard
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          label="Aktive Seats"
          value={usedSeats}
          accent="text-text-primary"
          subtitle={totalSeats > 0 ? `${utilizationPct}% Auslastung` : undefined}
        />
        <SeatKpiCard
          icon={<CircleSlash className="h-4 w-4 text-petrol-600 dark:text-mint-400" />}
          label="Freie Seats"
          value={overview?.available_seats ?? 0}
          accent="text-petrol-700 dark:text-mint-400"
        />
        <SeatKpiCard
          icon={<Layers className="h-4 w-4 text-text-tertiary" />}
          label="Gesamt Seats"
          value={totalSeats}
          accent="text-text-primary"
        />
        <SeatKpiCard
          icon={<Key className="h-4 w-4 text-petrol-600 dark:text-mint-400" />}
          label="Aktive Lizenzen"
          value={overview?.total_active_licenses ?? 0}
          accent="text-text-primary"
        />
      </div>

      {/* Seat Assignment */}
      {activeLicenses.length > 0 && (
        <Card variant="raised">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 font-display text-text-primary">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-mint-100 dark:bg-petrol-900/40">
                <UserPlus className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
              </div>
              Seat zuweisen
            </CardTitle>
            <CardDescription className="text-text-secondary">
              Weisen Sie einem Lernenden einen Seat zu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <Select value={selectedLicense} onValueChange={setSelectedLicense}>
                <SelectTrigger className="sm:w-[260px]">
                  <SelectValue placeholder="Lizenz wählen" />
                </SelectTrigger>
                <SelectContent>
                  {activeLicenses.map(l => (
                    <SelectItem key={l.license_id} value={l.license_id}>
                      {l.product_title || "Produkt"} ({l.seats_available} frei)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="User-ID (UUID)"
                value={assignUserId}
                onChange={(e) => setAssignUserId(e.target.value)}
                className="sm:w-[280px] font-mono text-xs"
              />
              <Button
                variant="petrol"
                onClick={handleAssign}
                disabled={assignSeat.isPending || !selectedLicense || !assignUserId.trim()}
              >
                {assignSeat.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <UserPlus className="h-4 w-4 mr-1.5" />}
                Zuweisen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Licenses */}
      <Card variant="raised">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-display text-text-primary">Lizenzen</CardTitle>
          <CardDescription className="text-text-secondary tabular-nums">{activeLicenses.length} aktive Lizenzen</CardDescription>
        </CardHeader>
        <CardContent>
          {activeLicenses.length === 0 ? (
            <div className="py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken">
                <Key className="h-5 w-5 text-text-tertiary" />
              </div>
              <p className="text-sm text-text-secondary">Keine aktiven Lizenzen.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border-subtle">
                  <TableHead className="text-text-tertiary font-medium">Produkt</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Seats</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Gültig bis</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeLicenses.map(l => (
                  <TableRow key={l.license_id} className="border-border-subtle hover:bg-surface-hover/50 transition-colors">
                    <TableCell className="font-medium text-text-primary">{l.product_title || "–"}</TableCell>
                    <TableCell className="tabular-nums text-text-primary">
                      {l.seats_used} / {l.seats_total}
                      <span className="text-text-tertiary ml-1">({l.seats_available} frei)</span>
                    </TableCell>
                    <TableCell className="text-sm text-text-secondary tabular-nums">
                      {l.valid_until ? new Date(l.valid_until).toLocaleDateString("de-DE") : "∞"}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-success-bg-subtle text-success border-0 capitalize">{l.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card variant="raised">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2 font-display text-text-primary">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-petrol-50 dark:bg-petrol-900/30">
              <Users className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            </div>
            Zugewiesene Lernende
          </CardTitle>
          <CardDescription className="text-text-secondary tabular-nums">{activeMembers.length} aktive Seats</CardDescription>
        </CardHeader>
        <CardContent>
          {activeMembers.length === 0 ? (
            <div className="py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-mint-100 dark:bg-petrol-900/40">
                <Users className="h-5 w-5 text-petrol-600 dark:text-mint-400" />
              </div>
              <p className="text-sm text-text-secondary">Noch keine Seats vergeben.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border-subtle">
                  <TableHead className="text-text-tertiary font-medium">User</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Produkt</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Zugewiesen am</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Status</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeMembers.map(m => (
                  <TableRow key={m.seat_id} className="border-border-subtle hover:bg-surface-hover/50 transition-colors">
                    <TableCell className="font-mono text-xs text-text-secondary">{m.user_id?.slice(0, 8)}…</TableCell>
                    <TableCell className="text-text-primary">{m.product_title || "–"}</TableCell>
                    <TableCell className="text-sm text-text-secondary tabular-nums">
                      {new Date(m.claimed_at).toLocaleDateString("de-DE")}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-success-bg-subtle text-success border-0">aktiv</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(m.license_id, m.user_id)}
                        disabled={revokeSeat.isPending}
                        className="text-danger hover:text-danger hover:bg-danger-bg-subtle"
                      >
                        <UserMinus className="h-4 w-4 mr-1" />
                        Entziehen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SeatKpiCard({ icon, label, value, accent, subtitle }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
  subtitle?: string;
}) {
  return (
    <Card variant="raised" className="hover:shadow-elev-2 transition-shadow duration-base">
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5 text-text-secondary font-medium">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className={`text-3xl font-display tabular-nums ${accent}`}>
          {value}
        </CardTitle>
        {subtitle && (
          <p className="text-xs text-text-tertiary tabular-nums">{subtitle}</p>
        )}
      </CardHeader>
    </Card>
  );
}
