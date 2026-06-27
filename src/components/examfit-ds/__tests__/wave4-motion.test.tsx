import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { HeroSurface, ImageCard, FloatingChip, ProgressMeter } from '../index';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — Wave 4 (Motion & Microinteractions) tests
 *
 * Verifiziert, dass die Premium-Motion-Klassen an den DS-Primitives anliegen
 * und reduced-motion-safe sind (motion-safe:* + globaler CSS-Layer-Guard).
 */
describe('Wave 4 — DS primitives carry premium motion classes', () => {
  describe('HeroSurface', () => {
    it('adds premium-reveal by default', () => {
      const { container } = render(<HeroSurface area="learn">x</HeroSurface>);
      const node = container.querySelector('[data-testid="examfit-hero-surface"]');
      expect(node?.className).toContain('premium-reveal');
      expect(node?.getAttribute('data-reveal')).toBe('true');
    });

    it('opts out cleanly via reveal={false}', () => {
      const { container } = render(
        <HeroSurface area="learn" reveal={false}>x</HeroSurface>,
      );
      const node = container.querySelector('[data-testid="examfit-hero-surface"]');
      expect(node?.className).not.toContain('premium-reveal');
      expect(node?.getAttribute('data-reveal')).toBe('false');
    });
  });

  describe('ImageCard', () => {
    it('adds premium-lift + premium-focus only when interactive', () => {
      const { container, rerender } = render(
        <ImageCard title="t" onClick={() => {}} />,
      );
      const interactive = container.querySelector('[data-testid="examfit-image-card"]');
      expect(interactive?.className).toContain('premium-lift');
      expect(interactive?.className).toContain('premium-focus');
      expect(interactive?.getAttribute('data-interactive')).toBe('true');

      rerender(<ImageCard title="t" />);
      const passive = container.querySelector('[data-testid="examfit-image-card"]');
      expect(passive?.className).not.toContain('premium-lift');
      expect(passive?.getAttribute('data-interactive')).toBe('false');
    });
  });

  describe('FloatingChip', () => {
    it('carries motion-safe hover-scale + transition utility', () => {
      const { container } = render(<FloatingChip>X</FloatingChip>);
      const chip = container.querySelector('[data-testid="examfit-floating-chip"]');
      expect(chip?.className).toContain('motion-safe:hover:scale-');
      expect(chip?.className).toMatch(/transition-\[/);
    });
  });

  describe('ProgressMeter (ring)', () => {
    it('uses motion-safe ring transition class', () => {
      const { container } = render(
        <ProgressMeter shape="ring" current={42} total={100} />,
      );
      const circle = container.querySelector('circle[stroke-linecap="round"]');
      expect(circle?.getAttribute('class') ?? '').toContain(
        'motion-safe:transition-[stroke-dashoffset]',
      );
    });

    it('honours prefers-reduced-motion by skipping mount animation', () => {
      const mql = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
        matches: q.includes('reduce'),
        media: q,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList);
      const { container } = render(
        <ProgressMeter shape="ring" current={50} total={100} />,
      );
      const circle = container.querySelector('circle[stroke-linecap="round"]');
      // With reduced motion, initial render must already sit on the target offset,
      // not on the full circumference.
      const offset = Number(circle?.getAttribute('stroke-dashoffset') ?? '0');
      // r = (56-5)/2 = 25.5 → circumference ≈ 160.22, target at 50% ≈ 80.11
      expect(offset).toBeGreaterThan(70);
      expect(offset).toBeLessThan(90);
      mql.mockRestore();
    });
  });
});
