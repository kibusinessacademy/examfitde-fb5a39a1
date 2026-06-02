import { useState } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useOrgInvites, useRevokeOrgInvite } from "@/hooks/useOrgConsoleData";
import { useOrgConsoleContext } from "@/hooks/useOrgConsole";
import { buildInviteUrl, type OrgInviteRow } from "@/lib/orgConsoleApi";
import { toast } from "sonner";
import { Send, Copy, Mail, X, Clock, CheckCircle2, Ban, UserPlus, AlertTriangle } from "lucide-react";
import { InviteMemberDialog } from "@/components/org/InviteMemberDialog";

const STATUS_META: Record<string, { label: string; icon: any; tone: string }> = {
  pending: { label: "Offen", icon: Clock, tone: "bg-status-warning-bg-subtle text-status-warning" },
  accepted: { label: "Angenommen", icon: CheckCircle2, tone: "bg-status-success-bg-subtle text-status-success" },
  revoked: { label: "Zurückgezogen", icon: Ban, tone: "bg-surface-2 text-text-tertiary" },
  expired: { label: "Abgelaufen", icon: X, tone: "bg-status-danger-bg-subtle text-status-danger" },
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

export default function OrgInvitesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: ctx } = useOrgConsoleContext();
  const myRole = (ctx?.orgs?.find((o) => o.id === orgId)?.my_role ?? "").toLowerCase();
  const canEdit = ["owner", "admin", "manager"].includes(myRole);

  const { data: invites, isLoading } = useOrgInvites(orgId);
  const { mutateAsync: revoke, isPending: revoking } = useRevokeOrgInvite(orgId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<OrgInviteRow | null>(null);

  function copyLink(token: string) {
    navigator.clipboard.writeText(buildInviteUrl(token));
    toast.success("Einladungs-Link kopiert");
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    try {
      const r = await revoke(revokeTarget.id);
      if (r.ok) toast.success("Einladung zurückgezogen");
      else toast.error(`Fehler: ${r.error}`);
    } catch (e: any) {
      toast.error(`Fehler: ${e?.message}`);
    } finally {
      setRevokeTarget(null);
    }
  }

  /** Returns tone class + label based on hours until expiry. */
  function expiryTone(iso: string): { tone: string; urgent: boolean; label: string } {
    const ms = new Date(iso).getTime() - Date.now();
    const h = ms / 3_600_000;
    if (h <= 0) return { tone: "text-status-danger", urgent: true, label: `abgelaufen am ${fmt(iso)}` };
    if (h < 48) return { tone: "text-status-warning", urgent: true, label: `läuft in ${Math.max(1, Math.round(h))} h ab` };
    const d = Math.round(h / 24);
    return { tone: "text-text-tertiary", urgent: false, label: `läuft in ${d} Tg ab` };
  }

  const pending = (invites ?? []).filter((i) => i.status === "pending");
  const history = (invites ?? []).filter((i) => i.status !== "pending");
  const HISTORY_LIMIT = 50;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Einladungen</h1>
          <p className="text-sm text-text-secondary mt-1">
            Verwalte offene und beendete Einladungen.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" /> Neue Einladung
          </Button>
        )}
      </div>

      <section>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Offene Einladungen ({pending.length})
        </h2>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : pending.length === 0 ? (
          <Card className="p-8 text-center border-border shadow-elev-1">
            <Mail className="h-8 w-8 mx-auto mb-2 text-text-tertiary" />
            <p className="text-sm text-text-secondary">Keine offenen Einladungen.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {pending.map((inv) => {
              const meta = STATUS_META[inv.status];
              const Icon = meta.icon;
              return (
                <Card key={inv.id} className="p-4 shadow-elev-1 border-border hover:shadow-elev-2 transition-shadow">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="h-10 w-10 rounded-full bg-surface-2 flex items-center justify-center shrink-0">
                        <Mail className="h-4 w-4 text-text-tertiary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-text-primary truncate">{inv.email}</div>
                        <div className="text-xs text-text-tertiary flex gap-2 flex-wrap items-center">
                          {inv.product_title && <span>{inv.product_title}</span>}
                          <span>· Rolle: {inv.role}</span>
                          <span>· läuft {fmt(inv.expires_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`gap-1 ${meta.tone}`} variant="secondary">
                        <Icon className="h-3 w-3" /> {meta.label}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyLink(inv.invite_token)}
                        className="gap-1.5"
                      >
                        <Copy className="h-3.5 w-3.5" /> Link
                      </Button>
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-status-danger hover:bg-status-danger-bg-subtle"
                          title="Zurückziehen"
                          onClick={() => handleRevoke(inv.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            Historie ({history.length})
          </h2>
          <Card className="shadow-elev-1 border-border overflow-hidden divide-y divide-border">
            {history.slice(0, 50).map((inv) => {
              const meta = STATUS_META[inv.status] ?? STATUS_META.expired;
              const Icon = meta.icon;
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-surface-1/50"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Icon className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                    <span className="truncate">{inv.email}</span>
                    {inv.product_title && (
                      <span className="text-xs text-text-tertiary truncate">· {inv.product_title}</span>
                    )}
                  </div>
                  <Badge className={`gap-1 ${meta.tone}`} variant="secondary">
                    {meta.label}
                  </Badge>
                  <span className="text-xs text-text-tertiary tabular-nums shrink-0">
                    {fmt(inv.accepted_at ?? inv.created_at)}
                  </span>
                </div>
              );
            })}
          </Card>
        </section>
      )}

      {orgId && (
        <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} orgId={orgId} />
      )}
    </div>
  );
}
