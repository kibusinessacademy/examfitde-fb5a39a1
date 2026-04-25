/**
 * Footer Newsletter Optin (DOI)
 * ----------------------------------
 * Submits to `newsletter-doi-request` which creates a token, sends
 * the confirmation mail and registers an `optin_submit` funnel event.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { trackFunnel } from "@/lib/conversionTracking";
import { CheckCircle2, Loader2 } from "lucide-react";

export interface NewsletterOptinFormProps {
  source?: string;
  curriculumId?: string | null;
  className?: string;
}

export function NewsletterOptinForm({
  source = "footer_optin",
  curriculumId = null,
  className,
}: NewsletterOptinFormProps) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr("Bitte gib eine gültige E-Mail an.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "newsletter-doi-request",
        { body: { email, source, curriculum_id: curriculumId } }
      );
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "Fehler");
      trackFunnel("optin_submit", { metadata: { source } });
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unbekannter Fehler.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className={className}>
        <p className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="w-4 h-4" />
          Bitte bestätige deine E-Mail. Wir haben dir einen Link geschickt.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="email"
          placeholder="deine@email.de"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={busy}
          aria-label="E-Mail-Adresse für Newsletter"
        />
        <Button type="submit" disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Anmelden"}
        </Button>
      </div>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
      <p className="text-[11px] text-muted-foreground mt-1">
        Du erhältst eine Bestätigungs-Mail. Abmeldung jederzeit möglich.
      </p>
    </form>
  );
}
