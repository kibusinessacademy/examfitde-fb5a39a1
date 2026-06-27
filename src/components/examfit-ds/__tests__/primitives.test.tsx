import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  HeroSurface,
  ImageCard,
  FloatingChip,
  GlassPanel,
  ProgressMeter,
  HERO_AREAS,
  CHIP_VARIANTS,
} from '../index';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — Wave 1 primitives tests
 * Render-Safe, token-driven, keine Hex-Werte erlaubt.
 */
describe('EXAMFIT.DESIGN.SYSTEM.OS.1 — Wave 1 primitives', () => {
  describe('HeroSurface', () => {
    it.each(HERO_AREAS)('renders area %s with correct bg utility', (area) => {
      const { container } = render(<HeroSurface area={area}>x</HeroSurface>);
      const node = container.querySelector('[data-area]');
      expect(node?.getAttribute('data-area')).toBe(area);
      expect(node?.className).toContain(`bg-hero-${area}`);
    });

    it('renders parallax slot when provided', () => {
      render(
        <HeroSurface area="learn" parallax={<span data-testid="px">P</span>}>
          x
        </HeroSurface>,
      );
      expect(screen.getByTestId('examfit-hero-parallax')).toBeInTheDocument();
      expect(screen.getByTestId('px')).toBeInTheDocument();
    });
  });

  describe('ImageCard', () => {
    it('renders title and gradient fallback when no image', () => {
      render(<ImageCard title="Hello" fallbackArea="exam" />);
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByTestId('examfit-image-card-fallback')).toBeInTheDocument();
    });

    it('renders <img> when image is provided', () => {
      render(<ImageCard title="t" image="/x.jpg" imageAlt="alt" />);
      expect(screen.getByTestId('examfit-image-card-img')).toHaveAttribute('src', '/x.jpg');
    });

    it('is a button when onClick is set and fires click', () => {
      const cb = vi.fn();
      render(<ImageCard title="t" onClick={cb} actionLabel="Go" />);
      const card = screen.getByTestId('examfit-image-card');
      expect(card.tagName).toBe('BUTTON');
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('is a div when no onClick', () => {
      render(<ImageCard title="t" />);
      expect(screen.getByTestId('examfit-image-card').tagName).toBe('DIV');
    });
  });

  describe('FloatingChip', () => {
    it.each(CHIP_VARIANTS)('renders variant %s', (v) => {
      render(<FloatingChip variant={v}>label</FloatingChip>);
      const chip = screen.getByTestId('examfit-floating-chip');
      expect(chip.getAttribute('data-variant')).toBe(v);
      expect(chip).toHaveTextContent('label');
    });
  });

  describe('GlassPanel', () => {
    it('does NOT enable backdrop-filter by default (render-safe)', () => {
      render(<GlassPanel>x</GlassPanel>);
      const node = screen.getByTestId('examfit-glass-panel');
      expect(node.getAttribute('data-backdrop-blur')).toBe('off');
      expect((node as HTMLElement).style.backdropFilter).toBe('');
    });

    it('opt-in backdrop blur sets inline style', () => {
      render(<GlassPanel enableBackdropBlur>x</GlassPanel>);
      const node = screen.getByTestId('examfit-glass-panel') as HTMLElement;
      expect(node.getAttribute('data-backdrop-blur')).toBe('on');
      expect(node.style.backdropFilter).toContain('blur');
    });
  });

  describe('ProgressMeter', () => {
    it('bar: clamps to 0..100 and sets aria-valuenow', () => {
      render(<ProgressMeter shape="bar" current={3} total={5} />);
      const role = screen.getByRole('progressbar');
      expect(role.getAttribute('aria-valuenow')).toBe('60');
    });

    it('bar: handles total=0 without NaN', () => {
      render(<ProgressMeter shape="bar" current={0} total={0} />);
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    });

    it('dots: caps total at 8', () => {
      const { container } = render(<ProgressMeter shape="dots" current={20} total={20} />);
      const dots = container.querySelectorAll('span.rounded-full');
      expect(dots.length).toBe(8);
    });

    it('ring: renders svg circles', () => {
      const { container } = render(<ProgressMeter shape="ring" current={50} total={100} showPercent />);
      expect(container.querySelectorAll('circle').length).toBe(2);
      expect(screen.getByText('50%')).toBeInTheDocument();
    });
  });
});
