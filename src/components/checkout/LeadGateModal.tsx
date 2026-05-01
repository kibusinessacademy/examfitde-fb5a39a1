/**
 * LeadGateModal — Soft-Nudge vor Checkout.
 *
 * Regel: NIEMALS hart blockieren. Primary = Diagnose, Secondary = direkt kaufen.
 * Tracking: lead_gate_shown (mount), lead_gate_start_diagnosis, lead_gate_skip_to_checkout.
 */
import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTrackGrowthEvent } from "@/hooks/useTrackGrowthEvent";

export interface LeadGateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageId?: string | null;
  curriculumId?: string | null;
  persona?: string | null;
  productSlug?: string | null;
  /** Where to send the user when they choose Diagnose. */
  diagnoseHref: string;
  /** Continue with checkout (skip the gate). */
  onSkipToCheckout: () => void;
  /** Optional source label, e.g. "persona_landing". */
  source?: string;
}

export function LeadGateModal({
  open,
  onOpenChange,
  packageId,
  curriculumId,
  persona,
  productSlug,
  diagnoseHref,
  onSkipToCheckout,
  source,
}: LeadGateModalProps) {
  const { track } = useTrackGrowthEvent();
  const shownRef = useRef(false);

  useEffect(() => {
    if (open && !shownRef.current) {
      shownRef.current = true;
      track("lead_gate_shown", {
        packageId: packageId ?? null,
        persona: persona ?? null,
        curriculumId: curriculumId ?? null,
        sourcePage: typeof window !== "undefined" ? window.location.pathname : null,
        metadata: {
          product_slug: productSlug ?? null,
          source: source ?? null,
        },
      });
    }
    if (!open) {
      shownRef.current = false;
    }
  }, [open, packageId, persona, curriculumId, productSlug, source, track]);

  const handleDiagnose = () => {
    track("lead_gate_start_diagnosis", {
      packageId: packageId ?? null,
      persona: persona ?? null,
      curriculumId: curriculumId ?? null,
      sourcePage: typeof window !== "undefined" ? window.location.pathname : null,
      metadata: {
        product_slug: productSlug ?? null,
        source: source ?? null,
        target: diagnoseHref,
      },
    });
    onOpenChange(false);
    if (typeof window !== "undefined") {
      window.location.href = diagnoseHref;
    }
  };

  const handleSkip = () => {
    track("lead_gate_skip_to_checkout", {
      packageId: packageId ?? null,
      persona: persona ?? null,
      curriculumId: curriculumId ?? null,
      sourcePage: typeof window !== "undefined" ? window.location.pathname : null,
      metadata: {
        product_slug: productSlug ?? null,
        source: source ?? null,
      },
    });
    onOpenChange(false);
    onSkipToCheckout();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Erst Prüfungsreife prüfen?</DialogTitle>
          <DialogDescription>
            In 2 Minuten wissen wir, wo du stehst — und welcher Lernweg dich am
            schnellsten zur Prüfung bringt. Das spart Zeit und Geld.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button onClick={handleDiagnose} className="w-full" size="lg">
            Diagnose starten (kostenlos)
          </Button>
          <Button
            onClick={handleSkip}
            variant="ghost"
            className="w-full"
            size="sm"
          >
            Trotzdem direkt kaufen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
