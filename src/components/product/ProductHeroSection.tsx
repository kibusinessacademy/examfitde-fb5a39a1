import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, ArrowRight, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ProductPageSSOT } from '@/types/product-page';
import { HeroSurface } from '@/components/examfit-ds';
import { resolveCourseImage, COURSE_HERO_SIZES } from '@/lib/courseImage';

interface Props {
  product: ProductPageSSOT;
  onPrimaryClick: () => void;
  isLoading?: boolean;
}

export function ProductHeroSection({ product, onPrimaryClick, isLoading }: Props) {
  const heroImg = resolveCourseImage({
    explicit: product.images?.heroImageUrl,
    title: product.canonicalTitle || product.berufDisplayName || '',
    chamber: product.kammer,
  });
  const heroAlt =
    product.images?.heroImageAlt ||
    `${product.canonicalTitle} – Prüfungstraining`;

  return (
    <section className="relative py-8 md:py-12">
      <HeroSurface area="shop" radius="card-xl" className="max-w-6xl mx-auto">
        <div className="relative grid md:grid-cols-2 gap-6 md:gap-10 items-center px-2 sm:px-4 py-4 sm:py-8">
          {/* Copy */}
          <div className="text-center md:text-left">
            {product.heroKicker && (
              <Badge variant="outline" className="mb-4 text-xs gap-1.5 border-primary/30 text-primary">
                <Sparkles className="h-3 w-3" />
                {product.heroKicker}
              </Badge>
            )}

            {product.badges.length > 0 && !product.heroKicker && (
              <div className="flex flex-wrap md:justify-start justify-center gap-2 mb-4">
                {product.badges.map((b) => (
                  <Badge key={b.label} variant="outline" className="text-xs border-primary/30 text-primary">
                    {b.label}
                  </Badge>
                ))}
              </div>
            )}

            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display font-bold leading-tight mb-4 md:mb-6">
              {product.heroHeadline}
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl md:mx-0 mx-auto mb-8">
              {product.heroSubline}
            </p>

            <div className="flex flex-col sm:flex-row md:justify-start items-center justify-center gap-3 sm:gap-4">
              <Button
                size="lg"
                className="gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg w-full sm:w-auto"
                onClick={onPrimaryClick}
                disabled={isLoading}
              >
                {isLoading ? 'Wird geladen...' : product.ctas.primaryLabel}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>

              {product.ctas.secondaryLabel && product.ctas.secondaryUrl && (
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="rounded-xl h-14 px-8 text-lg w-full sm:w-auto"
                >
                  <Link to={product.ctas.secondaryUrl}>
                    <Shield className="mr-2 h-5 w-5" />
                    {product.ctas.secondaryLabel}
                  </Link>
                </Button>
              )}
            </div>

            <div className="flex flex-wrap md:justify-start items-center justify-center gap-4 mt-6 text-xs text-muted-foreground">
              {!product.pricing.isSubscription && <span>✔ Kein Abo</span>}
              <span>✔ {product.pricing.accessDurationMonths} Monate Zugang</span>
              <span>✔ Sofortiger Start</span>
            </div>
          </div>

          {/* Visual — Mobile LCP-Kandidat (order-first). Eager + high priority. */}
          <div className="relative order-first md:order-last">
            <div className="relative rounded-2xl overflow-hidden aspect-[4/3] md:aspect-[5/4] shadow-2xl ring-1 ring-white/10">
              <img
                src={heroImg}
                alt={heroAlt}
                className="absolute inset-0 h-full w-full object-cover"
                loading="eager"
                decoding="async"
                // @ts-expect-error - fetchPriority ist gültiges HTML-Attribut, React-Types hinken nach
                fetchpriority="high"
                fetchPriority="high"
                sizes={COURSE_HERO_SIZES}
                // Intrinsische Größe matched Mobile-Box (4:3) — Desktop reskaliert via CSS.
                // Verhindert Layout-Shift auf Mobile, wo Hero das LCP-Element ist.
                width={1200}
                height={900}
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/55 via-black/10 to-transparent" />
              {product.kammer && (
                <div className="absolute top-3 left-3">
                  <Badge variant="secondary" className="backdrop-blur bg-white/85 text-foreground border-0">
                    {product.kammer}
                  </Badge>
                </div>
              )}
              <div className="absolute bottom-3 right-3">
                <span className="inline-flex items-center rounded-full bg-white/95 text-foreground text-sm font-semibold px-3 py-1 shadow-sm">
                  {product.pricing.label}
                </span>
              </div>
            </div>
          </div>
        </div>
      </HeroSurface>
    </section>
  );
}
