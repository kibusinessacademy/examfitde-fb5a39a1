import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Clock, Loader2, PlayCircle, ShoppingCart } from 'lucide-react';
import { resolveCourseImage, COURSE_CARD_SIZES } from '@/lib/courseImage';

/**
 * Einheitliche Premium-Kurskarte (HeyGen-Stil) für Shop, Listing- und
 * Verkaufsseiten. Bildlastig, mobile-first, gleiche visuelle Sprache überall.
 */
export interface CoursePremiumCardProps {
  title: string;
  href: string;
  chamber?: string | null;
  meta?: string | null;
  priceLabel?: string | null;
  status?: 'available' | 'soon';
  primaryLabel?: string;
  primaryIcon?: 'cart' | 'arrow' | 'play';
  onPrimaryClick?: () => void;
  primaryLoading?: boolean;
  secondaryAriaLabel?: string;
  onSecondaryClick?: () => void;
  /** Explizites Bild (z. B. aus HeyGen). Fällt sonst auf getBerufImage zurück. */
  imageUrl?: string | null;
  /** LCP-Hint: erstes Karte im Fold sollte eager geladen werden. */
  priority?: boolean;
}

const ICONS = {
  cart: ShoppingCart,
  arrow: ArrowRight,
  play: PlayCircle,
} as const;

export function CoursePremiumCard({
  title,
  href,
  chamber,
  meta,
  priceLabel,
  status = 'available',
  primaryLabel,
  primaryIcon = 'arrow',
  onPrimaryClick,
  primaryLoading,
  secondaryAriaLabel,
  onSecondaryClick,
  imageUrl,
  priority,
}: CoursePremiumCardProps) {
  const img = resolveCourseImage({ explicit: imageUrl, title, chamber });
  const Icon = ICONS[primaryIcon];
  const isSoon = status === 'soon';

  const visual = (
    <div className="relative block w-full aspect-[16/10] overflow-hidden">
      <img
        src={img}
        alt={`${title} – Prüfungstraining`}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'low'}
        sizes={COURSE_CARD_SIZES}
        width={800}
        height={500}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
      <div className="absolute top-2 left-2 right-2 sm:top-2.5 sm:left-2.5 sm:right-2.5 flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1 sm:gap-1.5 min-w-0">
          {chamber && (
            <Badge variant="secondary" className="backdrop-blur bg-white/85 text-foreground border-0 text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 shrink-0">
              {chamber}
            </Badge>
          )}
          {isSoon && (
            <Badge variant="secondary" className="backdrop-blur bg-white/85 text-foreground border-0 gap-1 text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 shrink-0">
              <Clock className="h-3 w-3" /> Bald
            </Badge>
          )}
        </div>
        {priceLabel && (
          <span className="shrink-0 inline-flex items-center rounded-full bg-white/95 text-foreground text-[11px] sm:text-xs font-semibold px-2 sm:px-2.5 py-0.5 sm:py-1 shadow-sm whitespace-nowrap">
            {priceLabel}
          </span>
        )}
      </div>
      <div className="absolute bottom-2.5 left-2.5 right-2.5 sm:bottom-3 sm:left-3 sm:right-3">
        <h3 className="text-white font-display font-bold text-sm sm:text-base leading-tight line-clamp-2 drop-shadow">
          {title}
        </h3>
        {meta && (
          <p className="text-white/85 text-[11px] sm:text-xs mt-0.5 sm:mt-1 line-clamp-1">{meta}</p>
        )}
      </div>
    </div>
  );

  const showFooter = Boolean(onPrimaryClick || onSecondaryClick || primaryLabel);

  return (
    <Card className="group relative overflow-hidden flex flex-col h-full rounded-2xl border bg-card hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300">
      {onPrimaryClick && !showFooter ? (
        <button type="button" onClick={onPrimaryClick} className="text-left focus:outline-none focus:ring-2 focus:ring-primary/60">
          {visual}
        </button>
      ) : (
        <Link to={href} aria-label={`${title} ansehen`} className="focus:outline-none focus:ring-2 focus:ring-primary/60">
          {visual}
        </Link>
      )}

      {showFooter && (
        <CardContent className="p-3 mt-auto flex items-stretch gap-2">
          {onPrimaryClick ? (
            <Button
              size="sm"
              className="flex-1 min-w-0 gradient-primary text-primary-foreground shadow-glow h-10 px-3 text-sm"
              onClick={onPrimaryClick}
              disabled={primaryLoading}
            >
              {primaryLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin shrink-0" />
              ) : (
                <Icon className="h-4 w-4 mr-1 shrink-0" />
              )}
              <span className="truncate">
                {primaryLoading ? 'Wird geladen…' : (primaryLabel ?? 'Mehr erfahren')}
              </span>
            </Button>
          ) : (
            <Button asChild size="sm" className="flex-1 min-w-0 gradient-primary text-primary-foreground shadow-glow h-10 px-3 text-sm">
              <Link to={href}>
                <Icon className="h-4 w-4 mr-1 shrink-0" />
                <span className="truncate">{primaryLabel ?? 'Mehr erfahren'}</span>
              </Link>
            </Button>
          )}
          {onSecondaryClick && (
            <Button
              size="sm"
              variant="outline"
              onClick={onSecondaryClick}
              aria-label={secondaryAriaLabel ?? `${title} – Vorschau`}
              title="Vorschau"
              className="h-10 w-10 p-0 shrink-0"
            >
              <PlayCircle className="h-4 w-4" />
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}
