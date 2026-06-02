import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { Send, Copy, Mail, X, Clock, CheckCircle2, Ban, UserPlus, AlertTriangle, KeyRound } from "lucide-react";
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
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : pending.length === 0 ? (
          <Card className="p-10 text-center border-border shadow-elev-1">
            <Mail className="h-10 w-10 mx-auto mb-3 text-text-tertiary" />
            <p className="text-sm text-text-secondary">Keine offenen Einladungen.</p>
            {canEdit && (
              <Button
                size="sm"
                className="mt-4 gap-2"
                onClick={() => setInviteOpen(true)}
              >
                <Send className="h-4 w-4" /> Erste Einladung verschicken
              </Button>
            )}
          </Card>
        ) : (
          <div className="space-y-2">
            {pending.map((inv) => {
              const meta = STATUS_META[inv.status];
              const Icon = meta.icon;
              const exp = expiryTone(inv.expires_at);
              return (
                <Card key={inv.id} className="p-4 shadow-elev-1 border-border hover:shadow-elev-2 transition-shadow">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="h-10 w-10 rounded-full bg-surface-2 flex items-center justify-center shrink-0">
                        <Mail className="h-4 w-4 text-text-tertiary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-text-primary truncate">{inv.email}</div>
                        <div className="text-xs flex gap-2 flex-wrap items-center">
                          {inv.product_title && <span className="text-text-tertiary">{inv.product_title}</span>}
                          <span className="text-text-tertiary">· Rolle: {inv.role}</span>
                          <span className={`inline-flex items-center gap-1 ${exp.tone}`} title={fmt(inv.expires_at)}>
                            {exp.urgent && <AlertTriangle className="h-3 w-3" />}
                            · {exp.label}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
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
                          disabled={revoking}
                          onClick={() => setRevokeTarget(inv)}
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
            {history.slice(0, HISTORY_LIMIT).map((inv) => {
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
            {history.length > HISTORY_LIMIT && (
              <div className="p-3 text-center text-xs text-text-tertiary bg-surface-1/50">
                {history.length - HISTORY_LIMIT} weitere Einträge nicht angezeigt — Aktivitätslog für vollständige Historie nutzen.
              </div>
            )}
          </Card>
        </section>
      )}

      {orgId && (
        <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} orgId={orgId} />
      )}

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Einladung zurückziehen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Einladungs-Link für <strong>{revokeTarget?.email}</strong> wird sofort ungültig.
              {revokeTarget?.product_title && (
                <> Der reservierte Sitz für <strong>{revokeTarget.product_title}</strong> wird wieder freigegeben.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevoke}
              className="bg-status-danger hover:bg-status-danger/90"
            >
              Zurückziehen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
