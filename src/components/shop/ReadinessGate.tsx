import { useResolvePaywall } from '@/hooks/useResolvePaywall';
import { useStartCheckout } from '@/hooks/useStartCheckout';
import { useTrackGrowthEvent } from '@/hooks/useTrackGrowthEvent';
import { PaywallModal } from '@/components/shop/PaywallModal';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';

interface ReadinessGateProps {
  productId: string;
  readinessScore: number;
  threshold?: number;
  experimentKey?: string;
  children: React.ReactNode;
}

/**
 * Readiness-triggered paywall gate.
 * Shows aggressive paywall when readiness score is below threshold.
 */
export function ReadinessGate({
  productId,
  readinessScore,
  threshold = 40,
  experimentKey = 'pricing_q3_2026',
  children,
}: ReadinessGateProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isLowReadiness = readinessScore < threshold;
  const { track } = useTrackGrowthEvent();
  const trackedRef = useRef(false);

  const { data: paywall, isLoading } = useResolvePaywall(
    isLowReadiness ? productId : null,
    {
      experimentKey,
      triggerContext: 'readiness_low',
    }
  );

  const checkout = useStartCheckout();

  useEffect(() => {
    if (paywall && !paywall.has_access && isLowReadiness && !trackedRef.current) {
      trackedRef.current = true;
      track('paywall_view', {
        product_id: productId,
        experiment_key: experimentKey,
        trigger_context: 'readiness_low',
        readiness_score: readinessScore,
        variant_key: paywall.variant?.variant_key,
      });
    }
  }, [paywall, isLowReadiness, productId, experimentKey, readinessScore, track]);

  // Not low readiness or has access → show children
  if (!isLowReadiness || paywall?.has_access || isLoading || !user) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <PaywallModal
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            track('dismissed', {
              product_id: productId,
              trigger_context: 'readiness_low',
              readiness_score: readinessScore,
            });
          }
        }}
        paywall={paywall ?? null}
        onCheckout={() => {
          checkout.mutate({
            productId,
            experimentKey,
            variantKey: paywall?.variant?.variant_key,
            triggerContext: 'readiness_low',
          });
        }}
        onLogin={() => navigate('/auth')}
        isAuthenticated={!!user}
      />
    </>
  );
}
