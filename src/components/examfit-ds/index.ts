/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — Wave 1 primitives
 * Public entry. All components are token-driven (no hex), mobile-first, render-safe
 * (no `backdrop-filter` requirement). Use these for new visual surfaces.
 *
 * Hart-Regel: LIF.OS.1 bleibt einzige Antwort-Komponente. Diese Primitives sind
 * für Navigation/Übersicht und Hero-Flächen, nicht für Lernschritt-Inputs.
 */
export { HeroSurface, HERO_AREAS, type HeroArea } from './HeroSurface';
export { ImageCard, type ImageCardProps } from './ImageCard';
export {
  FloatingChip,
  CHIP_VARIANTS,
  type FloatingChipProps,
  type FloatingChipVariant,
} from './FloatingChip';
export { GlassPanel, type GlassPanelProps } from './GlassPanel';
export { ProgressMeter, type ProgressMeterProps } from './ProgressMeter';
