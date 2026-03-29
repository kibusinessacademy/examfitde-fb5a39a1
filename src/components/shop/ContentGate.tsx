import { useEffect, useRef } from 'react';
import { useResolvePaywall } from '@/hooks/useResolvePaywall';
import { useStartCheckout } from '@/hooks/useStartCheckout';
import { useTrackGrowthEvent } from '@/hooks/useTrackGrowthEvent';
import { PaywallModal } from '@/components/shop/PaywallModal';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

interface ContentGateProps {
  productId: string;
  experimentKey?: string;
  triggerContext?: 'content_gate' | 'readiness_low';
  children: React.ReactNode;
  /** If true, shows paywall inline instead of blocking */
  softGate?: boolean;
}

/**
 * Content gate wrapper. Resolves paywall and blocks access if no entitlement.
 * Automatically tracks paywall_view on first render.
 */
export function ContentGate({
  productId,
  experimentKey = 'pricing_q3_2026',
  triggerContext = 'content_gate',
  children,
  softGate = false,
}: ContentGateProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: paywall, isLoading } = useResolvePaywall(productId, {
    experimentKey,
    triggerContext,
  });
  const checkout = useStartCheckout();
  const { track } = useTrackGrowthEvent();
  const trackedRef = useRef(false);

  // Track paywall_view once when shown
  useEffect(() => {
    if (paywall && !paywall.has_access && !trackedRef.current) {
      trackedRef.current = true;
      track('paywall_view', {
        product_id: productId,
        experiment_key: experimentKey,
        variant_key: paywall.variant?.variant_key,
        trigger_context: triggerContext,
      });
    }
  }, [paywall, productId, experimentKey, triggerContext, track]);

  const handleCheckout = () => {
    checkout.mutate({
      productId,
      experimentKey,
      variantKey: paywall?.variant?.variant_key,
      triggerContext,
    });
  };

  const handleDismiss = () => {
    track('dismissed', {
      product_id: productId,
      variant_key: paywall?.variant?.variant_key,
      trigger_context: triggerContext,
    });
  };

  // User has access → render children
  if (paywall?.has_access) {
    return <>{children}</>;
  }

  // Loading or no user → render children (graceful degradation)
  if (isLoading || !user) {
    return <>{children}</>;
  }

  // Soft gate: show children + paywall modal
  if (softGate) {
    return (
      <>
        {children}
        <PaywallModal
          open={!paywall?.has_access}
          onOpenChange={(open) => {
            if (!open) handleDismiss();
          }}
          paywall={paywall ?? null}
          onCheckout={handleCheckout}
          onLogin={() => navigate('/auth')}
          isAuthenticated={!!user}
        />
      </>
    );
  }

  // Hard gate: paywall only
  return (
    <PaywallModal
      open={true}
      onOpenChange={(open) => {
        if (!open) handleDismiss();
      }}
      paywall={paywall ?? null}
      onCheckout={handleCheckout}
      onLogin={() => navigate('/auth')}
      isAuthenticated={!!user}
    />
  );
}
