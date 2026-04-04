import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle className="h-8 w-8 text-primary" />
        </div>

        <h1 className="text-3xl font-bold">Kauf erfolgreich!</h1>

        <p className="text-muted-foreground">
          Dein Zugang ist ab sofort aktiv. Du kannst jetzt direkt mit deinem
          Prüfungstraining starten.
        </p>

        <div className="rounded-2xl border bg-card p-6 text-left">
          <h2 className="mb-3 font-semibold">Was passiert jetzt?</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>Dein Zugang ist für 12 Monate freigeschaltet</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>Alle Module stehen dir sofort zur Verfügung</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>Bestätigung per E-Mail ist unterwegs</span>
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            className="w-full"
            onClick={() => navigate("/dashboard")}
          >
            Jetzt Training starten
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
          >
            Zur Startseite
          </Button>
        </div>

        {orderId && (
          <p className="text-xs text-muted-foreground">
            Bestell-Nr.: {orderId.slice(0, 8)}…
          </p>
        )}
      </div>
    </main>
  );
}
