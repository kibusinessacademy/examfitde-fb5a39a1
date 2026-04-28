import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle2, ArrowRight, Mail, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TrackingEvents } from "@/lib/tracking/track";

export default function CheckoutSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get("order_id");
  const [tracked, setTracked] = useState(false);

  useEffect(() => {
    if (orderId && !tracked) {
      TrackingEvents.checkoutCompleted("", orderId);
      setTracked(true);
    }
  }, [orderId, tracked]);

  const benefits = [
    { icon: Clock, text: "Dein Zugang ist für 12 Monate freigeschaltet" },
    { icon: Sparkles, text: "Alle Module stehen dir sofort zur Verfügung" },
    { icon: Mail, text: "Bestätigung per E-Mail ist unterwegs" },
  ];

  return (
    <main
      data-density="comfortable"
      className="relative flex min-h-screen items-center justify-center px-4 py-12 bg-background overflow-hidden"
    >
      {/* Celebratory background glow */}
      <div
        className="absolute inset-0 -z-10 opacity-70"
        style={{
          background:
            "radial-gradient(ellipse at center, hsl(168 64% 90%) 0%, transparent 60%)",
        }}
        aria-hidden
      />
      <div
        className="absolute inset-0 -z-10 opacity-0 dark:opacity-50"
        style={{
          background:
            "radial-gradient(ellipse at center, hsl(168 64% 25%) 0%, transparent 60%)",
        }}
        aria-hidden
      />

      <div className="mx-auto max-w-md space-y-6 text-center animate-fade-in">
        {/* Success badge — Mint identity */}
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-mint-500/20 animate-pulse-subtle" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-mint-500 shadow-elev-3">
            <CheckCircle2 className="h-9 w-9 text-petrol-900" strokeWidth={2.5} />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-4xl font-display font-bold tracking-tight text-text-primary">
            Kauf erfolgreich!
          </h1>
          <p className="text-text-secondary leading-relaxed">
            Dein Zugang ist ab sofort aktiv. Du kannst jetzt direkt mit deinem
            Prüfungstraining starten.
          </p>
        </div>

        {/* Benefits card */}
        <Card variant="raised" className="rounded-2xl p-6 text-left shadow-elev-2">
          <h2 className="mb-4 font-display font-semibold text-text-primary">
            Was passiert jetzt?
          </h2>
          <ul className="space-y-3 text-sm">
            {benefits.map((b) => (
              <li key={b.text} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-bg-subtle">
                  <b.icon className="h-3.5 w-3.5 text-success" />
                </div>
                <span className="text-text-secondary leading-snug">{b.text}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Primary CTA — Petrol identity */}
        <div className="flex flex-col gap-2">
          <Button
            variant="petrol"
            size="xl"
            className="w-full group"
            onClick={() => navigate("/dashboard")}
          >
            Jetzt Training starten
            <ArrowRight className="h-4 w-4 transition-transform duration-base ease-out-expo group-hover:translate-x-0.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="text-text-tertiary hover:text-text-primary"
          >
            Zur Startseite
          </Button>
        </div>

        {orderId && (
          <p className="text-xs text-text-quaternary font-mono">
            Bestell-Nr.: {orderId.slice(0, 8)}…
          </p>
        )}
      </div>
    </main>
  );
}
