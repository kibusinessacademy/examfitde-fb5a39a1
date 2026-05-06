/**
 * Regression: useProductAccessByCurriculum must NOT cache `false` from an
 * anonymous render and reuse it once the user has logged in.
 *
 * Race scenario:
 *   1. Component mounts while auth is still hydrating → user=null
 *   2. Auth resolves → user.id present
 *   3. RPC must run with the real user, not stay stuck on the anonymous false
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: any[]) => rpcMock(...args) },
}));

const authState = {
  user: null as { id: string } | null,
  loading: true,
};
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe('useProductAccessByCurriculum — auth race regression', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    authState.user = null;
    authState.loading = true;
  });

  it('does not call RPC while auth is still loading', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useProductAccessByCurriculum('cur-1', 'learning_course'), {
      wrapper: wrapper(client),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('refetches with real user.id after login (no stuck false)', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result, rerender } = renderHook(
      () => useProductAccessByCurriculum('cur-1', 'learning_course'),
      { wrapper: wrapper(client) }
    );

    // Initial: auth loading → query disabled
    await new Promise((r) => setTimeout(r, 10));
    expect(rpcMock).not.toHaveBeenCalled();

    // Auth resolves with a logged-in user
    await act(async () => {
      authState.user = { id: 'user-123' };
      authState.loading = false;
      rerender();
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('check_product_access_by_curriculum', {
        p_user_id: 'user-123',
        p_curriculum_id: 'cur-1',
        p_feature: 'learning_course',
      });
    });
    await waitFor(() => expect(result.current.data).toBe(true));
  });

  it('queryKey is namespaced per user — no cross-user leak', async () => {
    rpcMock.mockImplementation((_fn: string, args: any) =>
      Promise.resolve({ data: args.p_user_id === 'user-B', error: null })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    authState.user = { id: 'user-A' };
    authState.loading = false;
    const { result, rerender } = renderHook(
      () => useProductAccessByCurriculum('cur-1', 'learning_course'),
      { wrapper: wrapper(client) }
    );
    await waitFor(() => expect(result.current.data).toBe(false));

    await act(async () => {
      authState.user = { id: 'user-B' };
      rerender();
    });
    await waitFor(() => expect(result.current.data).toBe(true));
    expect(rpcMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
