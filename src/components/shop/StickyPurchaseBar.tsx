import { Button } from '@/components/ui/button';
import { ArrowRight, Shield, Clock } from 'lucide-react';
import { PRICING } from '@/config/pricing';
import { Link } from 'react-router-dom';
import { useConsentBannerVisible } from '@/hooks/useConsentBannerVisible';

interface Props {
  priceDisplay: string;
  onBuyClick: () => void;
  isLoading: boolean;
  visible: boolean;
}

export function StickyPurchaseBar({ priceDisplay, onBuyClick, isLoading, visible }: Props) {
  const consent = useConsentBannerVisible();
  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-0 z-50 bg-card/95 backdrop-blur-md border-t border-border px-4 py-3 transition-[bottom] duration-base"
      style={{ bottom: consent.visible ? `calc(env(safe-area-inset-bottom) + ${consent.height + 12}px)` : `env(safe-area-inset-bottom)` }}
    >
      <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-lg font-bold text-foreground">{priceDisplay}</span>
          <Link to="/pruefungscheck" className="text-[10px] text-primary hover:underline flex items-center gap-1">
            <Shield className="h-2.5 w-2.5" /> Kostenlos testen
          </Link>
        </div>
        <Button
          className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-12 px-6 text-sm font-semibold shrink-0"
          onClick={onBuyClick}
          disabled={isLoading}
        >
          {isLoading ? '...' : 'Jetzt starten'}
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
