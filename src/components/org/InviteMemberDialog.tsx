import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useOrgLicenseList } from "@/hooks/useOrgDashboard";
import { useCreateOrgInvite } from "@/hooks/useOrgConsoleData";
import { buildInviteUrl } from "@/lib/orgConsoleApi";
import { toast } from "sonner";
import { Copy, Send, CheckCircle2, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  defaultLicenseId?: string;
}

interface InviteResult {
  email: string;
  ok: boolean;
  token?: string;
  error?: string;
}

export function InviteMemberDialog({ open, onOpenChange, orgId, defaultLicenseId }: Props) {
  const { data: licenses } = useOrgLicenseList(orgId);
  const activeLicenses = (licenses ?? []).filter((l) => l.status === "active" && l.seats_available > 0);

  const [licenseId, setLicenseId] = useState<string>(defaultLicenseId ?? "");
  const [singleEmail, setSingleEmail] = useState("");
  const [bulkEmails, setBulkEmails] = useState("");
  const [role, setRole] = useState("learner");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[]>([]);

  const { mutateAsync: createInvite } = useCreateOrgInvite(orgId);

  const effectiveLicenseId = licenseId || activeLicenses[0]?.license_id || "";

  async function inviteOne(email: string): Promise<InviteResult> {
    try {
      const r = await createInvite({ licenseId: effectiveLicenseId, email, role });
      if (r.ok) return { email, ok: true, token: r.invite_token };
      return { email, ok: false, error: r.error };
    } catch (e: any) {
      return { email, ok: false, error: e?.message ?? "unknown" };
    }
  }

  async function handleSingleInvite() {
    if (!singleEmail.trim() || !effectiveLicenseId) {
      toast.error("Bitte E-Mail und Lizenz wählen.");
      return;
    }
    setBusy(true);
    const r = await inviteOne(singleEmail.trim().toLowerCase());
    setResults([r]);
    setBusy(false);
    if (r.ok) {
      toast.success(`Einladung für ${r.email} erstellt`);
      setSingleEmail("");
    } else {
      toast.error(`Fehler: ${r.error}`);
    }
  }

  async function handleBulkInvite() {
    const emails = bulkEmails
      .split(/[\s,;\n]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"));
    if (emails.length === 0 || !effectiveLicenseId) {
      toast.error("Bitte gültige E-Mails und Lizenz angeben.");
      return;
    }
    setBusy(true);
    const out: InviteResult[] = [];
    for (const email of emails) {
      out.push(await inviteOne(email));
    }
    setResults(out);
    setBusy(false);
    const ok = out.filter((r) => r.ok).length;
    toast.success(`${ok}/${out.length} Einladungen erstellt`);
    if (ok > 0) setBulkEmails("");
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(buildInviteUrl(token));
    toast.success("Einladungs-Link kopiert");
  }

  function close() {
    setResults([]);
    setSingleEmail("");
    setBulkEmails("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mitarbeiter einladen</DialogTitle>
          <DialogDescription>
            Generiert Einladungs-Links, die der Empfänger zur Annahme nutzt. Sitz wird erst beim
            Akzeptieren belegt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm">Lizenz</Label>
            <Select value={effectiveLicenseId} onValueChange={setLicenseId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Lizenz wählen…" />
              </SelectTrigger>
              <SelectContent>
                {activeLicenses.length === 0 && (
                  <div className="px-3 py-4 text-sm text-text-tertiary">
                    Keine Lizenz mit freien Sitzen.
                  </div>
                )}
                {activeLicenses.map((l) => (
                  <SelectItem key={l.license_id} value={l.license_id}>
                    <div className="flex items-center gap-2">
                      <span>{l.product_title ?? "Lizenz"}</span>
                      <Badge variant="outline" className="text-xs">
                        {l.seats_available} frei
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm">Rolle nach Annahme</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="learner">Lernender</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs defaultValue="single">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="single">Einzeln</TabsTrigger>
              <TabsTrigger value="bulk">Bulk-Import</TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="space-y-3 mt-3">
              <Input
                type="email"
                placeholder="name@firma.de"
                value={singleEmail}
                onChange={(e) => setSingleEmail(e.target.value)}
                disabled={busy}
              />
              <Button
                onClick={handleSingleInvite}
                disabled={busy || !singleEmail.trim() || !effectiveLicenseId}
                className="gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Einladung erstellen
              </Button>
            </TabsContent>
            <TabsContent value="bulk" className="space-y-3 mt-3">
              <Textarea
                rows={6}
                placeholder="E-Mails einfügen (eine pro Zeile, Komma oder Semikolon getrennt)"
                value={bulkEmails}
                onChange={(e) => setBulkEmails(e.target.value)}
                disabled={busy}
              />
              <Button
                onClick={handleBulkInvite}
                disabled={busy || !bulkEmails.trim() || !effectiveLicenseId}
                className="gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Bulk-Einladungen erstellen
              </Button>
            </TabsContent>
          </Tabs>

          {results.length > 0 && (
            <div className="border border-border rounded-lg divide-y divide-border">
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    {r.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-status-success shrink-0" />
                    ) : (
                      <span className="h-4 w-4 rounded-full bg-status-danger shrink-0" />
                    )}
                    <span className="truncate">{r.email}</span>
                    {!r.ok && (
                      <Badge variant="destructive" className="text-xs">
                        {r.error}
                      </Badge>
                    )}
                  </div>
                  {r.ok && r.token && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyLink(r.token!)}
                      className="gap-1.5 shrink-0"
                    >
                      <Copy className="h-3.5 w-3.5" /> Link
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
