import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert, RefreshCw, CheckCircle2 } from "lucide-react";

type Resolved = {
  ok: boolean;
  error?: string;
  license_id?: string;
  org_name?: string;
  product_name?: string;
  seat_count?: number;
  expires_at?: string;
  license_valid_until?: string | null;
  used_at?: string;
};

export default function RenewPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<Resolved | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ ok: false, error: "missing_token" });
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc("org_resolve_renewal_token", { p_token: token });
      if (error) setState({ ok: false, error: error.message });
      else setState(data as unknown as Resolved);
      setLoading(false);
    })();
  }, [token]);

  async function startRenewal() {
    if (!token || !state?.ok) return;
    setRedirecting(true);
    try {
      await supabase.rpc("org_consume_renewal_token", { p_token: token });
      const { data, error } = await supabase.functions.invoke("create-product-checkout", {
        body: {
          license_id: state.license_id,
          renewal_token: token,
          source: "self_service_renewal",
        },
      });
      if (error) throw error;
      const url = (data as any)?.url;
      if (url) window.location.href = url;
      else setRedirecting(false);
    } catch {
      setRedirecting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Lizenz verlängern
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lade Verlängerungs-Link…
            </div>
          )}
          {!loading && state && !state.ok && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-destructive">
                <ShieldAlert className="h-4 w-4" />
                <span className="font-medium">Link ungültig</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {state.error === "expired" && "Dieser Verlängerungs-Link ist abgelaufen."}
                {state.error === "already_used" && "Dieser Link wurde bereits verwendet."}
                {state.error === "not_found" && "Wir konnten diesen Link nicht finden."}
                {state.error === "missing_token" && "Es wurde kein Token mitgeschickt."}
                {!["expired","already_used","not_found","missing_token"].includes(state.error ?? "") &&
                  "Bitte fordere einen neuen Link bei deinem Org-Admin an."}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/org">Zum Org-Dashboard</Link>
              </Button>
            </div>
          )}
          {!loading && state?.ok && (
            <div className="space-y-3">
              <div className="rounded-md border p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Organisation</span>
                  <span className="font-medium">{state.org_name ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Produkt</span>
                  <span className="font-medium">{state.product_name ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sitzplätze</span>
                  <Badge variant="secondary">{state.seat_count ?? 0}</Badge>
                </div>
                {state.license_valid_until && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Aktuelles Ende</span>
                    <span>{new Date(state.license_valid_until).toLocaleDateString("de-DE")}</span>
                  </div>
                )}
              </div>
              <Button
                onClick={startRenewal}
                disabled={redirecting}
                className="w-full"
                size="lg"
              >
                {redirecting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Weiterleitung…</>
                ) : (
                  <><CheckCircle2 className="h-4 w-4 mr-2" /> Jetzt verlängern</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Du wirst zum sicheren Checkout weitergeleitet.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
