import { useState } from "react";
import { requestIdentifiedAccess } from "@/lib/orgApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Shield, CheckCircle, Clock, XCircle, AlertTriangle } from "lucide-react";

const STATUS_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  APPROVED: { icon: CheckCircle, color: "text-green-600", label: "Genehmigt" },
  REQUESTED: { icon: Clock, color: "text-yellow-600", label: "Angefragt" },
  DENIED: { icon: XCircle, color: "text-red-600", label: "Abgelehnt" },
  EXPIRED: { icon: AlertTriangle, color: "text-orange-600", label: "Abgelaufen" },
  NONE: { icon: Shield, color: "text-muted-foreground", label: "Kein Zugriff" },
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
    <div className="space-y-4">
      {/* Current Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5" /> Datenschutz & Zugriffsrechte
          </CardTitle>
          <CardDescription>
            Steuert den Umfang der Daten in Berichten (anonymisiert / pseudonymisiert / identifizierend).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground mb-1">Status</div>
              <div className="flex items-center gap-2">
                <StatusIcon className={`h-5 w-5 ${cfg.color}`} />
                <span className="font-semibold">{cfg.label}</span>
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground mb-1">Scope</div>
              <Badge variant={scope === "IDENTIFIED" ? "default" : "secondary"}>{scope}</Badge>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground mb-1">Gültig bis</div>
              <span className="font-medium text-sm">
                {approvedUntil ? new Date(approvedUntil).toLocaleDateString("de-DE") : "–"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Request Form */}
      {canRequest && status !== "APPROVED" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Identifizierten Zugang anfragen</CardTitle>
            <CardDescription>
              Ermöglicht detaillierte Berichte mit pseudonymisierten oder identifizierten Learner-Daten.
              Die Anfrage muss von einem Admin genehmigt werden.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Begründung (optional)</label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Warum benötigen Sie identifizierenden Zugang?"
                rows={3}
              />
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleRequest} disabled={requesting}>
                {requesting ? "Anfrage wird gesendet…" : "Zugang anfragen"}
              </Button>
              {success && (
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> Anfrage gesendet
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {status === "APPROVED" && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            <CheckCircle className="mx-auto h-8 w-8 text-green-500 mb-2" />
            Der identifizierende Zugang ist aktiv bis {approvedUntil ? new Date(approvedUntil).toLocaleDateString("de-DE") : "unbefristet"}.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
