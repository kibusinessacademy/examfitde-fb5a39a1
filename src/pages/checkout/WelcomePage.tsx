import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { CheckCircle2, ArrowRight, Sparkles, Brain, Timer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useTrackGrowthEvent } from "@/hooks/useTrackGrowthEvent";
import { TrackingEvents } from "@/lib/tracking/track";

/**
 * Post-Purchase Activation Landing — Cut 1a
 *
 * Ziel: „Erster Lernmoment in <60 Sekunden". Statt generischem Dashboard
 * landet der Käufer hier mit klarer Primärhandlung (diagnostischer MiniCheck /
 * Prüfungsmodus / 3-Min Quick-Win). Aktiviert telemetrisch den Activation-Funnel
 * (post_purchase_landing_view → activation_started → first_learning_action).
 */
export default function WelcomePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { track } = useTrackGrowthEvent();
  const orderId = searchParams.get("order_id");

  const [grantCurriculumId, setGrantCurriculumId] = useState<string | null>(null);
  const [grantPackageId, setGrantPackageId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(true);
  const trackedView = useRef(false);

  // 1) Mark landing-view + checkout_completed once
  useEffect(() => {
    if (trackedView.current || !user) return;
    trackedView.current = true;
    if (orderId) TrackingEvents.checkoutCompleted("", orderId);
    track("post_purchase_landing_view" as any, {
      packageId: grantPackageId,
      curriculumId: grantCurriculumId,
      metadata: { order_id: orderId },
    });
  }, [user, orderId, grantPackageId, grantCurriculumId, track]);

  // 2) Resolve newest active grant (handles webhook delay with short polling)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      const { data } = await supabase
        .from("learner_course_grants")
        .select("curriculum_id, metadata")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("granted_at", { ascending: false })
        .limit(1);

      if (cancelled) return;
      const row = data?.[0];
      if (row?.curriculum_id) {
        setGrantCurriculumId(row.curriculum_id);
        const pkgId = (row.metadata as any)?.package_id ?? null;
        setGrantPackageId(pkgId);
        setWaiting(false);
        return;
      }
      if (attempts < 8) setTimeout(tick, 1500);
      else setWaiting(false);
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const startAction = (
    kind: "diagnostic_minicheck" | "exam_mode" | "quick_win",
    target: string,
  ) => {
    track("activation_started" as any, {
      packageId: grantPackageId,
      curriculumId: grantCurriculumId,
      metadata: { order_id: orderId, action: kind },
    });
    navigate(target);
  };

  const primary = useMemo(
    () => ({
      label: "Diagnose starten (3 Min.)",
      to: grantCurriculumId
        ? `/exam-trainer?curriculum=${grantCurriculumId}&mode=diagnostic`
        : "/dashboard",
      kind: "diagnostic_minicheck" as const,
    }),
    [grantCurriculumId],
  );

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
      </main>
    );
  }

  if (!user) {
    // Edge case: Stripe success_url ohne Session — Auth-Gate mit Resume.
    const redirect = `/willkommen${orderId ? `?order_id=${orderId}` : ""}`;
    navigate(`/auth?redirect=${encodeURIComponent(redirect)}`, { replace: true });
    return null;
  }

  return (
    <main
      data-density="comfortable"
      className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12 bg-background overflow-hidden"
    >
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

      <div className="mx-auto w-full max-w-lg space-y-6 text-center animate-fade-in">
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-mint-500/20 animate-pulse-subtle" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-mint-500 shadow-elev-3">
            <CheckCircle2 className="h-9 w-9 text-petrol-900" strokeWidth={2.5} />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-4xl font-display font-bold tracking-tight text-text-primary">
            Willkommen — los geht's!
          </h1>
          <p className="text-text-secondary leading-relaxed">
            Dein Zugang ist aktiv. Starte jetzt deine erste Prüfungsaufgabe und sieh
            in 3 Minuten, wo du stehst.
          </p>
        </div>

        {waiting ? (
          <Card variant="raised" className="rounded-2xl p-6 text-left shadow-elev-2">
            <div className="flex items-center gap-3 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Wir schalten deinen Kurs gerade frei…</span>
            </div>
          </Card>
        ) : (
          <Card variant="raised" className="rounded-2xl p-2 text-left shadow-elev-2">
            <ActionRow
              icon={<Brain className="h-5 w-5" />}
              title="Diagnose-MiniCheck"
              hint="3 Minuten · Wo stehst du heute?"
              onClick={() => startAction(primary.kind, primary.to)}
              primary
            />
            <ActionRow
              icon={<Sparkles className="h-5 w-5" />}
              title="Direkt in den Prüfungsmodus"
              hint="Erste echte Prüfungsfrage lösen"
              onClick={() =>
                startAction(
                  "exam_mode",
                  grantCurriculumId
                    ? `/exam-trainer?curriculum=${grantCurriculumId}`
                    : "/exam-trainer",
                )
              }
            />
            <ActionRow
              icon={<Timer className="h-5 w-5" />}
              title="3-Min Quick-Win"
              hint="Eine Lesson abschließen, Streak starten"
              onClick={() => startAction("quick_win", "/dashboard")}
            />
          </Card>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Button
            variant="petrol"
            size="xl"
            className="w-full group"
            onClick={() => startAction(primary.kind, primary.to)}
            disabled={waiting}
          >
            {primary.label}
            <ArrowRight className="h-4 w-4 transition-transform duration-base ease-out-expo group-hover:translate-x-0.5" />
          </Button>
          <Link
            to="/dashboard"
            className="text-xs text-text-tertiary hover:text-text-primary underline-offset-4 hover:underline"
          >
            Lieber zur Übersicht
          </Link>
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

function ActionRow({
  icon,
  title,
  hint,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors " +
        (primary
          ? "bg-mint-500/10 hover:bg-mint-500/15"
          : "hover:bg-surface-muted/60")
      }
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-petrol-900/5 text-petrol-900">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="text-xs text-text-tertiary">{hint}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-text-tertiary" />
    </button>
  );
}
