import { useState } from "react";
import { requestIdentifiedAccess } from "@/lib/orgApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Shield, CheckCircle, Clock, XCircle, AlertTriangle } from "lucide-react";

const STATUS_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  APPROVED: { icon: CheckCircle, color: "text-success", bg: "bg-success-bg-subtle", label: "Genehmigt" },
  REQUESTED: { icon: Clock, color: "text-warning", bg: "bg-warning-bg-subtle", label: "Angefragt" },
  DENIED: { icon: XCircle, color: "text-danger", bg: "bg-danger-bg-subtle", label: "Abgelehnt" },
  EXPIRED: { icon: AlertTriangle, color: "text-warning", bg: "bg-warning-bg-subtle", label: "Abgelaufen" },
  NONE: { icon: Shield, color: "text-text-tertiary", bg: "bg-surface-sunken", label: "Kein Zugriff" },
};

interface Props {
  organizationId: string;
  privacyAccess: any;
  myRole: string;
}

export default function OrgPrivacyPanel({ organizationId, privacyAccess, myRole }: Props) {
  const [reason, setReason] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [success, setSuccess] = useState(false);

  const status = privacyAccess?.status ?? "NONE";
  const scope = privacyAccess?.scope ?? "ANONYMIZED";
  const approvedUntil = privacyAccess?.approved_until;
  const canRequest = ["OWNER", "MANAGER"].includes(myRole ?? "");

  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.NONE;
  const StatusIcon = cfg.icon;

  async function handleRequest() {
    setRequesting(true);
    setSuccess(false);
    try {
      await requestIdentifiedAccess({
        organization_id: organizationId,
        scope: "IDENTIFIED",
        reason: reason || undefined,
      });
      setSuccess(true);
      setReason("");
    } catch (e) {
      console.error("Privacy request failed", e);
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div data-density="comfortable" className="space-y-5">
      {/* Current Status */}
      <Card variant="raised">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2 font-display text-text-primary">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-petrol-50 dark:bg-petrol-900/30">
              <Shield className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
            </div>
            Datenschutz & Zugriffsrechte
          </CardTitle>
          <CardDescription className="text-text-secondary">
            Steuert den Umfang der Daten in Berichten (anonymisiert / pseudonymisiert / identifizierend).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border-subtle bg-surface p-4">
              <div className="text-xs font-medium text-text-tertiary mb-2">Status</div>
              <div className="flex items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${cfg.bg}`}>
                  <StatusIcon className={`h-4 w-4 ${cfg.color}`} />
                </div>
                <span className="font-semibold text-text-primary">{cfg.label}</span>
              </div>
            </div>
            <div className="rounded-xl border border-border-subtle bg-surface p-4">
              <div className="text-xs font-medium text-text-tertiary mb-2">Scope</div>
              <Badge variant={scope === "IDENTIFIED" ? "default" : "secondary"} className="font-medium">{scope}</Badge>
            </div>
            <div className="rounded-xl border border-border-subtle bg-surface p-4">
              <div className="text-xs font-medium text-text-tertiary mb-2">Gültig bis</div>
              <span className="font-medium text-sm text-text-primary tabular-nums">
                {approvedUntil ? new Date(approvedUntil).toLocaleDateString("de-DE") : "–"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Request Form */}
      {canRequest && status !== "APPROVED" && (
        <Card variant="raised">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-display text-text-primary">Identifizierten Zugang anfragen</CardTitle>
            <CardDescription className="text-text-secondary">
              Ermöglicht detaillierte Berichte mit pseudonymisierten oder identifizierten Learner-Daten.
              Die Anfrage muss von einem Admin genehmigt werden.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-text-tertiary block mb-1.5">Begründung (optional)</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Warum benötigen Sie identifizierenden Zugang?"
                rows={3}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="petrol" onClick={handleRequest} disabled={requesting}>
                {requesting ? "Anfrage wird gesendet…" : "Zugang anfragen"}
              </Button>
              {success && (
                <span className="text-sm text-success flex items-center gap-1.5 font-medium">
                  <CheckCircle className="h-4 w-4" /> Anfrage gesendet
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {status === "APPROVED" && (
        <Card variant="raised" className="bg-success-bg-subtle/30 border-success/20">
          <CardContent className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg-subtle">
              <CheckCircle className="h-6 w-6 text-success" />
            </div>
            <p className="text-sm text-text-primary font-medium">
              Identifizierender Zugang aktiv
            </p>
            <p className="text-xs text-text-secondary mt-1 tabular-nums">
              bis {approvedUntil ? new Date(approvedUntil).toLocaleDateString("de-DE") : "unbefristet"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
