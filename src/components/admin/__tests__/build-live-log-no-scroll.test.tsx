import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import BuildLiveLog from '../BuildLiveLog';

// Mock supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// Mock pipeline-steps
vi.mock('@/lib/pipeline-steps', () => ({
  PIPELINE_STEP_LABELS: {},
  getStepLabel: (key: string) => key,
}));

describe('BuildLiveLog', () => {
  it('does not trigger page scroll while log updates', async () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;

    render(<BuildLiveLog packageId="pkg-test-1" isBuilding={true} />);

    // Wait a tick for async effects
    await new Promise((r) => setTimeout(r, 50));

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    scrollToSpy.mockRestore();
  });

  it('renders without crashing when not building', () => {
    const { container } = render(<BuildLiveLog packageId="pkg-test-2" isBuilding={false} />);
    // Should render nothing when no logs and not building
    expect(container.innerHTML).toBe('');
  });
});
