import { useState } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useOrgLicenseList,
  useOrgSeatMembers,
  useAssignOrgSeat,
  useRevokeOrgSeat,
  type OrgLicense,
  type OrgSeatMember,
} from "@/hooks/useOrgDashboard";
import { useOrgMembers } from "@/hooks/useOrgConsoleData";
import { useOrgConsoleContext } from "@/hooks/useOrgConsole";
import { toast } from "sonner";
import { KeyRound, Calendar, UserPlus, UserMinus, Package } from "lucide-react";
import { InviteMemberDialog } from "@/components/org/InviteMemberDialog";

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
}

function LicenseCard({
  license,
  seats,
  members,
  canEdit,
  onInviteToLicense,
  onAssign,
  onRevoke,
}: {
  license: OrgLicense;
  seats: OrgSeatMember[];
  members: ReturnType<typeof useOrgMembers>["data"];
  canEdit: boolean;
  onInviteToLicense: (licenseId: string) => void;
  onAssign: (licenseId: string, userId: string) => void;
  onRevoke: (licenseId: string, userId: string) => void;
}) {
  const [selectUser, setSelectUser] = useState<string>("");
  const seatsHere = seats.filter((s) => s.license_id === license.license_id && s.seat_status === "active");
  const assignedUserIds = new Set(seatsHere.map((s) => s.user_id));
  const candidates = (members ?? []).filter(
    (m) => m.status === "active" && !assignedUserIds.has(m.user_id)
  );

  const pct = license.seats_total > 0 ? Math.round((license.seats_used / license.seats_total) * 100) : 0;

  return (
    <Card className="p-5 shadow-elev-1 hover:shadow-elev-2 transition-shadow border-border">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-text-tertiary shrink-0" />
            <h3 className="font-semibold text-text-primary truncate">
              {license.product_title ?? "Lizenz"}
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Badge
              variant={license.status === "active" ? "secondary" : "outline"}
              className="text-[10px]"
            >
              {license.status}
            </Badge>
            <Calendar className="h-3 w-3" />
            <span>bis {fmtDate(license.valid_until)}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-text-primary">
            {license.seats_used}<span className="text-text-tertiary">/{license.seats_total}</span>
          </div>
          <div className="text-xs text-text-tertiary">Sitze belegt</div>
        </div>
      </div>

      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden mb-4">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      {canEdit && (
        <div className="flex gap-2 mb-4">
          <Select value={selectUser} onValueChange={setSelectUser}>
            <SelectTrigger className="flex-1 h-9">
              <SelectValue placeholder="Mitarbeiter wählen…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-tertiary">
                  Keine verfügbaren Mitarbeiter
                </div>
              ) : (
                candidates.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name || m.email}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!selectUser || license.seats_available <= 0}
            onClick={() => {
              onAssign(license.license_id, selectUser);
              setSelectUser("");
            }}
            className="gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Zuweisen
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onInviteToLicense(license.license_id)}
          >
            Einladen
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
          Belegt von ({seatsHere.length})
        </div>
        {seatsHere.length === 0 ? (
          <div className="text-sm text-text-tertiary py-2">Noch keine Mitarbeiter zugewiesen.</div>
        ) : (
          seatsHere.map((s) => {
            const m = members?.find((mm) => mm.user_id === s.user_id);
            return (
              <div
                key={s.seat_id}
                className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-surface-1/50"
              >
                <span className="truncate">{m?.full_name || m?.email || s.user_id.slice(0, 8)}</span>
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-status-danger hover:bg-status-danger-bg-subtle"
                    title="Sitz freigeben"
                    onClick={() => onRevoke(license.license_id, s.user_id)}
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

export default function OrgLicensesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: ctx } = useOrgConsoleContext();
  const myRole = (ctx?.orgs?.find((o) => o.id === orgId)?.my_role ?? "").toLowerCase();
  const canEdit = ["owner", "admin", "manager"].includes(myRole);

  const { data: licenses, isLoading } = useOrgLicenseList(orgId);
  const { data: seats } = useOrgSeatMembers(orgId);
  const { data: members } = useOrgMembers(orgId);
  const { mutateAsync: assign } = useAssignOrgSeat();
  const { mutateAsync: revoke } = useRevokeOrgSeat();

  const [inviteLicenseId, setInviteLicenseId] = useState<string | null>(null);
  const [revokeArgs, setRevokeArgs] = useState<{ licenseId: string; userId: string } | null>(null);

  async function handleAssign(licenseId: string, userId: string) {
    try {
      await assign({ licenseId, userId });
      toast.success("Sitz zugewiesen");
    } catch (e: any) {
      toast.error(`Fehler: ${e?.message}`);
    }
  }

  async function handleRevoke() {
    if (!revokeArgs) return;
    try {
      await revoke(revokeArgs);
      toast.success("Sitz freigegeben");
    } catch (e: any) {
      toast.error(`Fehler: ${e?.message}`);
    } finally {
      setRevokeArgs(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Lizenzen & Sitze</h1>
        <p className="text-sm text-text-secondary mt-1">
          Weise einzelne Lernende den gekauften Lizenzen zu. Freie Sitze können jederzeit neu belegt
          werden.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : !licenses || licenses.length === 0 ? (
        <Card className="p-12 text-center border-border shadow-elev-1">
          <KeyRound className="h-12 w-12 mx-auto mb-4 text-text-tertiary" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">Noch keine Lizenz</h3>
          <p className="text-sm text-text-secondary mb-4">
            Erwirb eine Unternehmens-Lizenz, um Sitze an deine Mitarbeiter zu verteilen.
          </p>
          <Button asChild>
            <a href="/berufski/corporate">Lizenz erwerben</a>
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {licenses.map((lic) => (
            <LicenseCard
              key={lic.license_id}
              license={lic}
              seats={seats ?? []}
              members={members}
              canEdit={canEdit}
              onInviteToLicense={setInviteLicenseId}
              onAssign={handleAssign}
              onRevoke={(licenseId, userId) => setRevokeArgs({ licenseId, userId })}
            />
          ))}
        </div>
      )}

      {orgId && inviteLicenseId && (
        <InviteMemberDialog
          open={!!inviteLicenseId}
          onOpenChange={(o) => !o && setInviteLicenseId(null)}
          orgId={orgId}
          defaultLicenseId={inviteLicenseId}
        />
      )}

      <AlertDialog open={!!revokeArgs} onOpenChange={(o) => !o && setRevokeArgs(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sitz freigeben?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Mitarbeiter verliert sofort den Zugriff auf diesen Kurs. Der Sitz wird frei und kann
              neu vergeben werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-status-danger hover:bg-status-danger/90"
            >
              Freigeben
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
