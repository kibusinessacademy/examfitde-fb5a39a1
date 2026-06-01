import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useOrgMembers, useUpdateOrgMemberRole, useRemoveOrgMember } from "@/hooks/useOrgConsoleData";
import { useOrgConsoleContext } from "@/hooks/useOrgConsole";
import { toast } from "sonner";
import { Search, UserMinus, Crown, Shield, ShieldCheck, GraduationCap, UserPlus } from "lucide-react";
import { InviteMemberDialog } from "@/components/org/InviteMemberDialog";
import type { OrgMemberRow } from "@/lib/orgConsoleApi";

const ROLE_META: Record<string, { label: string; icon: any; tone: string }> = {
  owner: { label: "Inhaber", icon: Crown, tone: "bg-status-info-bg-subtle text-status-info" },
  admin: { label: "Admin", icon: ShieldCheck, tone: "bg-status-info-bg-subtle text-status-info" },
  manager: { label: "Manager", icon: Shield, tone: "bg-status-warning-bg-subtle text-status-warning" },
  learner: { label: "Lernender", icon: GraduationCap, tone: "bg-surface-2 text-text-secondary" },
};

function MemberAvatar({ m }: { m: OrgMemberRow }) {
  const initial = (m.full_name ?? m.email ?? "?").trim().slice(0, 2).toUpperCase();
  return (
    <Avatar className="h-9 w-9">
      {m.avatar_url && <AvatarImage src={m.avatar_url} alt={m.full_name ?? m.email ?? ""} />}
      <AvatarFallback className="text-xs">{initial}</AvatarFallback>
    </Avatar>
  );
}

export default function OrgTeamPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: ctx } = useOrgConsoleContext();
  const currentOrg = ctx?.orgs?.find((o) => o.id === orgId);
  const myRole = (currentOrg?.my_role ?? "").toLowerCase();
  const canEdit = ["owner", "admin"].includes(myRole);

  const { data: members, isLoading } = useOrgMembers(orgId);
  const { mutateAsync: updateRole, isPending: updating } = useUpdateOrgMemberRole(orgId);
  const { mutateAsync: removeMember } = useRemoveOrgMember(orgId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMemberRow | null>(null);
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return (members ?? [])
      .filter((m) => m.status === "active")
      .filter((m) => (roleFilter === "all" ? true : m.role === roleFilter))
      .filter((m) => {
        if (!filter) return true;
        const f = filter.toLowerCase();
        return (
          (m.email ?? "").toLowerCase().includes(f) || (m.full_name ?? "").toLowerCase().includes(f)
        );
      });
  }, [members, filter, roleFilter]);

  async function handleRoleChange(m: OrgMemberRow, newRole: string) {
    try {
      const res = await updateRole({ userId: m.user_id, newRole: newRole as any });
      if (!res.ok) {
        toast.error(`Rolle nicht geändert: ${res.error}`);
      } else {
        toast.success(`Rolle aktualisiert: ${ROLE_META[newRole]?.label ?? newRole}`);
      }
    } catch (e: any) {
      toast.error(`Fehler: ${e?.message ?? "unbekannt"}`);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    try {
      await removeMember(removeTarget.user_id);
      toast.success(`${removeTarget.email ?? "Mitarbeiter"} aus der Organisation entfernt`);
    } catch (e: any) {
      toast.error(`Entfernen fehlgeschlagen: ${e?.message}`);
    } finally {
      setRemoveTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Mitarbeiter</h1>
          <p className="text-sm text-text-secondary mt-1">
            Verwalte aktive Mitarbeiter, Rollen und Zugriffe.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" /> Mitarbeiter einladen
          </Button>
        )}
      </div>

      <Card className="p-4 shadow-elev-1 border-border">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Name oder E-Mail suchen…"
              className="pl-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Rolle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Rollen</SelectItem>
              <SelectItem value="owner">Inhaber</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="learner">Lernende</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-text-tertiary ml-auto">
            {filtered.length} {filtered.length === 1 ? "Person" : "Personen"}
          </span>
        </div>
      </Card>

      <Card className="shadow-elev-1 border-border overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <UserPlus className="h-10 w-10 mx-auto mb-3 text-text-tertiary" />
            <p className="text-text-secondary text-sm">
              {members?.length ? "Keine Treffer." : "Noch keine Mitarbeiter in dieser Organisation."}
            </p>
            {canEdit && !members?.length && (
              <Button className="mt-4" onClick={() => setInviteOpen(true)}>
                Ersten Mitarbeiter einladen
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="hidden md:grid grid-cols-[1fr,180px,120px,90px] gap-4 px-5 py-2.5 bg-surface-1 text-xs font-medium text-text-tertiary uppercase tracking-wide">
              <div>Mitarbeiter</div>
              <div>Rolle</div>
              <div>Aktive Kurse</div>
              <div className="text-right">Aktion</div>
            </div>
            {filtered.map((m) => {
              const meta = ROLE_META[m.role] ?? ROLE_META.learner;
              const Icon = meta.icon;
              return (
                <div
                  key={m.membership_id}
                  className="grid grid-cols-[1fr,auto] md:grid-cols-[1fr,180px,120px,90px] gap-4 px-5 py-3.5 items-center hover:bg-surface-1/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MemberAvatar m={m} />
                    <div className="min-w-0">
                      <div className="font-medium text-text-primary truncate">
                        {m.full_name || m.email || "Unbekannt"}
                      </div>
                      {m.full_name && m.email && (
                        <div className="text-xs text-text-tertiary truncate">{m.email}</div>
                      )}
                    </div>
                  </div>
                  <div className="hidden md:block">
                    {canEdit && m.role !== "owner" ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => handleRoleChange(m, v)}
                        disabled={updating}
                      >
                        <SelectTrigger className="h-8 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="learner">Lernender</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          {myRole === "owner" && <SelectItem value="owner">Inhaber</SelectItem>}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge className={`gap-1 ${meta.tone}`} variant="secondary">
                        <Icon className="h-3 w-3" /> {meta.label}
                      </Badge>
                    )}
                  </div>
                  <div className="hidden md:block">
                    <Badge variant="outline" className="tabular-nums">
                      {m.seats_count}
                    </Badge>
                  </div>
                  <div className="flex justify-end gap-1">
                    {canEdit && m.role !== "owner" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Entfernen"
                        onClick={() => setRemoveTarget(m)}
                        className="h-8 w-8 text-status-danger hover:bg-status-danger-bg-subtle"
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {orgId && (
        <InviteMemberDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          orgId={orgId}
        />
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mitarbeiter entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeTarget?.full_name || removeTarget?.email}</strong> verliert sofort den
              Zugriff auf alle Kurse dieser Organisation. Sitze werden freigegeben und können neu
              zugewiesen werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-status-danger hover:bg-status-danger/90"
            >
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
