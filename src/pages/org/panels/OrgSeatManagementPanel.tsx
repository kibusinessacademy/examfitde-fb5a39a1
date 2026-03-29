import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, Users, UserPlus, UserMinus } from "lucide-react";
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
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aktive Seats</CardDescription>
            <CardTitle className="text-3xl">{overview?.used_seats ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Freie Seats</CardDescription>
            <CardTitle className="text-3xl">{overview?.available_seats ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Gesamt Seats</CardDescription>
            <CardTitle className="text-3xl">{overview?.total_seats ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aktive Lizenzen</CardDescription>
            <CardTitle className="text-3xl">{overview?.total_active_licenses ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Seat Assignment */}
      {activeLicenses.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Seat zuweisen
            </CardTitle>
            <CardDescription>
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
                className="sm:w-[280px]"
              />
              <Button
                onClick={handleAssign}
                disabled={assignSeat.isPending || !selectedLicense || !assignUserId.trim()}
              >
                {assignSeat.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <UserPlus className="h-4 w-4 mr-1" />}
                Zuweisen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Licenses */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Lizenzen</CardTitle>
          <CardDescription>{activeLicenses.length} aktive Lizenzen</CardDescription>
        </CardHeader>
        <CardContent>
          {activeLicenses.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Keine aktiven Lizenzen.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produkt</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead>Gültig bis</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeLicenses.map(l => (
                  <TableRow key={l.license_id}>
                    <TableCell className="font-medium">{l.product_title || "–"}</TableCell>
                    <TableCell>
                      {l.seats_used} / {l.seats_total}
                      <span className="text-muted-foreground ml-1">({l.seats_available} frei)</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {l.valid_until ? new Date(l.valid_until).toLocaleDateString("de-DE") : "∞"}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-green-100 text-green-800">{l.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5" />
            Zugewiesene Lernende
          </CardTitle>
          <CardDescription>{activeMembers.length} aktive Seats</CardDescription>
        </CardHeader>
        <CardContent>
          {activeMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Noch keine Seats vergeben.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Produkt</TableHead>
                  <TableHead>Zugewiesen am</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeMembers.map(m => (
                  <TableRow key={m.seat_id}>
                    <TableCell className="font-mono text-xs">{m.user_id?.slice(0, 8)}…</TableCell>
                    <TableCell>{m.product_title || "–"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(m.claimed_at).toLocaleDateString("de-DE")}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-green-100 text-green-800">aktiv</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(m.license_id, m.user_id)}
                        disabled={revokeSeat.isPending}
                        className="text-destructive hover:text-destructive"
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
