/**
 * Verifies the Rollback-Dialog uses the offender row's displayed
 * Allow/Req policy (the same data the table shows) — i.e. changing the
 * server-side policy values in the query result flips the dialog text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HandbookPublishDriftCard, isForbiddenError, forbiddenMessage } from '../HandbookPublishDriftCard';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: any[]) => rpcMock(...args) },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function makeSummary(overrides: Partial<any> = {}) {
  return {
    drift_packages: 1,
    chapters_publishable_pending: 4,
    top_offenders: [
      {
        package_id: 'pkg-1',
        package_title: 'Test Paket',
        track: 'EXAM_FIRST_PLUS',
        allowed: true,
        required: true,
        chapter_count: 8,
        published_count: 3,
        publishable_count: 7,
        blocker_reason: 'DRIFT_PARTIAL_PUBLISHED',
        ...overrides,
      },
    ],
    policies: {
      EXAM_FIRST_PLUS: { track: 'EXAM_FIRST_PLUS', allowed: true, required: true, gates: ['steps:done', 'content:present'] },
    },
    recent_actions: [],
  };
}

function renderWith(summary: any) {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: summary, error: null });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HandbookPublishDriftCard />
    </QueryClientProvider>,
  );
}

describe('HandbookPublishDriftCard — rollback dialog mirrors displayed policy', () => {
  beforeEach(() => rpcMock.mockReset());

  it('shows allowed=Y, required=Y from offender row in the dialog', async () => {
    renderWith(makeSummary());
    await screen.findByText('Test Paket');

    fireEvent.click(screen.getAllByRole('button', { name: /Rollback/i })[0]);

    await waitFor(() => expect(screen.getByText(/Rollback: Test Paket/)).toBeInTheDocument());
    expect(screen.getByText(/allowed · required/)).toBeInTheDocument();
    expect(screen.getAllByText('DRIFT_PARTIAL_PUBLISHED').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Published \/ Publishable/)).toBeInTheDocument();
  });

  it('flips to disallowed · optional when policy changes server-side', async () => {
    renderWith(
      makeSummary({
        track: 'EXAM_FIRST',
        allowed: false,
        required: false,
        blocker_reason: 'POLICY_TRACK_DISALLOWED',
      }),
    );
    await screen.findByText('Test Paket');
    fireEvent.click(screen.getAllByRole('button', { name: /Rollback/i })[0]);
    await waitFor(() => expect(screen.getByText(/Rollback: Test Paket/)).toBeInTheDocument());
    expect(screen.getByText(/disallowed · optional/)).toBeInTheDocument();
    expect(screen.getAllByText('POLICY_TRACK_DISALLOWED').length).toBeGreaterThanOrEqual(1);
  });
});

describe('isForbiddenError + forbiddenMessage canonical contract', () => {
  it('detects 42501 code, 401/403 status, and message variants', () => {
    expect(isForbiddenError({ code: '42501' })).toBe(true);
    expect(isForbiddenError({ status: 403 })).toBe(true);
    expect(isForbiddenError({ status: 401 })).toBe(true);
    expect(isForbiddenError({ message: 'permission denied for function …' })).toBe(true);
    expect(isForbiddenError({ message: 'forbidden: admin role required' })).toBe(true);
    expect(isForbiddenError({ message: 'not authorized' })).toBe(true);
    expect(isForbiddenError({ message: 'something else' })).toBe(false);
    expect(isForbiddenError(null)).toBe(false);
  });

  it('returns identical canonical message shape per action', () => {
    const expected = (a: string) =>
      `${a} verweigert: Diese Aktion erfordert Admin- oder service-role-Zugriff. Bitte als Admin einloggen.`;
    expect(forbiddenMessage('Smoke')).toBe(expected('Smoke'));
    expect(forbiddenMessage('Backfill')).toBe(expected('Backfill'));
    expect(forbiddenMessage('Rollback')).toBe(expected('Rollback'));
  });
});
