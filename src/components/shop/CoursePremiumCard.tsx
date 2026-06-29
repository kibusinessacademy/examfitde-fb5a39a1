import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Clock, Loader2, PlayCircle, ShoppingCart } from 'lucide-react';
import { getBerufImage } from '@/lib/berufImage';

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
}: CoursePremiumCardProps) {
  const img = getBerufImage(title, chamber ?? null);
  const Icon = ICONS[primaryIcon];
  const isSoon = status === 'soon';

  const visual = (
    <div className="relative block w-full aspect-[16/10] overflow-hidden">
      <img
        src={img}
        alt={`${title} – Prüfungstraining`}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
      <div className="absolute top-3 left-3 flex gap-2">
        {chamber && (
          <Badge variant="secondary" className="backdrop-blur bg-white/85 text-foreground border-0">
            {chamber}
          </Badge>
        )}
        {isSoon && (
          <Badge variant="secondary" className="backdrop-blur bg-white/85 text-foreground border-0 gap-1">
            <Clock className="h-3 w-3" /> Bald
          </Badge>
        )}
      </div>
      {priceLabel && (
        <div className="absolute top-3 right-3">
          <span className="inline-flex items-center rounded-full bg-white/95 text-foreground text-sm font-semibold px-3 py-1 shadow-sm">
            {priceLabel}
          </span>
        </div>
      )}
      <div className="absolute bottom-3 left-3 right-3">
        <h3 className="text-white font-display font-bold text-lg leading-tight line-clamp-2 drop-shadow">
          {title}
        </h3>
        {meta && (
          <p className="text-white/85 text-xs mt-1 line-clamp-1">{meta}</p>
        )}
      </div>
    </div>
  );

  const showFooter = Boolean(onPrimaryClick || onSecondaryClick || primaryLabel);

  return (
    <Card className="group relative overflow-hidden flex flex-col rounded-2xl border bg-card hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300">
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
        <CardContent className="p-3 flex gap-2">
          {onPrimaryClick ? (
            <Button
              size="sm"
              className="flex-1 gradient-primary text-primary-foreground shadow-glow"
              onClick={onPrimaryClick}
              disabled={primaryLoading}
            >
              {primaryLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Icon className="h-4 w-4 mr-1" />
              )}
              {primaryLoading ? 'Wird geladen…' : (primaryLabel ?? 'Mehr erfahren')}
            </Button>
          ) : (
            <Button asChild size="sm" className="flex-1 gradient-primary text-primary-foreground shadow-glow">
              <Link to={href}>
                <Icon className="h-4 w-4 mr-1" />
                {primaryLabel ?? 'Mehr erfahren'}
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
            >
              <PlayCircle className="h-4 w-4" />
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}
