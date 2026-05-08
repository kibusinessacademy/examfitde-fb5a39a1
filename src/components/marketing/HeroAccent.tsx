import { cn } from "@/lib/utils";

/**
 * HeroAccent — single source of truth for the gradient highlight inside hero
 * headlines. Wraps the highlighted phrase with the project's gradient text
 * token (`text-gradient`) plus an optional soft glow, and guarantees that
 * descenders (g, p, j, ä) are not clipped by the gradient mask.
 *
 * Usage:
 *   <h1>Lead text <HeroAccent>highlighted phrase</HeroAccent></h1>
 *
 * Props:
 *   - glow:   adds the secondary `text-glow` token (default: true on desktop,
 *             false on small viewports to avoid blur halo over short phones).
 *   - block:  forces a line break before the accent (helpful when the accent
 *             is long enough to wrap mid-word on 390px).
 */
interface HeroAccentProps {
  children: React.ReactNode;
  glow?: boolean;
  block?: boolean;
  className?: string;
}

export function HeroAccent({
  children,
  glow = true,
  block = false,
  className,
}: HeroAccentProps) {
  return (
    <span
      className={cn(
        // gradient token from the design system
        "text-gradient",
        // padding-bottom prevents descender clipping on `bg-clip-text`
        "pb-[0.05em] inline-block leading-[1.15]",
        glow && "sm:text-glow",
        block && "block",
        className,
      )}
    >
      {children}
    </span>
  );
}
