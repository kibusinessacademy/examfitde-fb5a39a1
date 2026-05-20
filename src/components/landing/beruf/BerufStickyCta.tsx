import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { useConsentBannerVisible } from '@/hooks/useConsentBannerVisible';

interface Props {
  visible: boolean;
  beruf: string;
  quizHref: string;
  onCtaClick: () => void;
}

export function BerufStickyCta({ visible, beruf, quizHref, onCtaClick }: Props) {
  const consent = useConsentBannerVisible();
  const bottomOffset = consent.visible ? consent.height + 12 : 0;

  return (
    <div
      className={[
        'md:hidden fixed inset-x-0 z-40',
        'border-t border-border-subtle bg-background/95 backdrop-blur',
        'px-4 py-3',
        'shadow-elev-3 transition-[transform,bottom] duration-base ease-out-expo',
        visible ? 'translate-y-0' : 'translate-y-full',
      ].join(' ')}
      style={{
        bottom: `calc(env(safe-area-inset-bottom) + ${bottomOffset}px)`,
      }}
      aria-hidden={!visible}
      data-testid="sticky-cta"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-tertiary truncate">{beruf}-Prüfungszustand</p>
          <p className="text-sm font-semibold text-text-primary truncate">
            Diagnose in 4 Min. starten
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0" onClick={onCtaClick}>
          <Link to={quizHref}>
            Starten
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

