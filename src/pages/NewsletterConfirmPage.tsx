import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { trackFunnel } from "@/lib/conversionTracking";

export default function NewsletterConfirmPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setState("err");
      setMsg("Kein Token in der URL.");
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "newsletter-doi-confirm",
          { body: { token } }
        );
        if (error) throw error;
        if ((data as any)?.ok) {
          setState("ok");
          setMsg((data as any).email ?? "");
          trackFunnel("doi_confirmed", { metadata: { source: "doi_link" } });
        } else {
          setState("err");
          setMsg((data as any)?.error ?? "Token ungültig oder abgelaufen.");
        }
      } catch (e) {
        setState("err");
        setMsg(e instanceof Error ? e.message : "Unbekannter Fehler.");
      }
    })();
  }, [token]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Newsletter-Bestätigung</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {state === "loading" && (
            <>
              <Loader2 className="w-10 h-10 mx-auto animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">Bestätigung läuft …</p>
            </>
          )}
          {state === "ok" && (
            <>
              <CheckCircle2 className="w-12 h-12 mx-auto text-green-600" />
              <p className="font-medium">Vielen Dank!</p>
              <p className="text-sm text-muted-foreground">
                Deine Anmeldung {msg ? `für ${msg} ` : ""}wurde bestätigt. Du
                erhältst in Kürze deine erste E-Mail.
              </p>
            </>
          )}
          {state === "err" && (
            <>
              <XCircle className="w-12 h-12 mx-auto text-red-600" />
              <p className="font-medium">Bestätigung fehlgeschlagen</p>
              <p className="text-sm text-muted-foreground">{msg}</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
