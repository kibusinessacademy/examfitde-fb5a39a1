/**
 * Regression: CourseDetailPage must hide the "Jetzt einschreiben" CTA
 * once entitlements become active after login. Guards the React-Query
 * cache race that previously kept the enroll-CTA visible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

const authState = { user: null as { id: string } | null, loading: true };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }));

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...args),
    from: (...args: any[]) => fromMock(...args),
  },
}));

vi.mock('@/hooks/useCourseProgress', () => ({
  useCourseProgress: () => ({ data: null, isLoading: false }),
}));

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

const COURSE = {
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  title: 'Test Course',
  description: 'desc',
  thumbnail_url: null,
  estimated_duration: 10,
  curriculum_id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
  module_count: 1,
  lesson_count: 1,
};

function buildFromMock() {
  const tableHandlers: Record<string, any> = {
    v_courses_publishable: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: COURSE, error: null }) }) }),
    }),
    modules: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: 'm1', title: 'M', description: null, sort_order: 0 }], error: null }) }) }),
    }),
    lessons: () => ({
      select: () => ({ in: () => ({ order: () => Promise.resolve({ data: [{ id: 'l1', title: 'L', step: '1.1', duration_minutes: 5, module_id: 'm1', sort_order: 0 }], error: null }) }) }),
    }),
    course_enrollments: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    }),
  };
  fromMock.mockImplementation((t: string) => tableHandlers[t]?.() ?? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) });
}

import CourseDetailPage from '@/pages/CourseDetailPage';

function renderPage(client: QueryClient) {
  return render(
    React.createElement(QueryClientProvider, { client },
      React.createElement(MemoryRouter, { initialEntries: [`/course/${COURSE.id}`] },
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/course/:slug', element: React.createElement(CourseDetailPage) })
        )
      )
    )
  );
}

describe('CourseDetailPage — entitlement-driven CTA visibility', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    buildFromMock();
    authState.user = null;
    authState.loading = true;
  });

  it('hides "Jetzt einschreiben" once entitlement RPC returns true after login', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    authState.user = { id: 'user-1' };
    authState.loading = false;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(client);

    // Wait until the continue CTA renders (entitlement true → access granted)
    await waitFor(() => {
      expect(screen.getByTestId('course-continue-btn')).toBeInTheDocument();
    }, { timeout: 4000 });

    // Enroll-CTA must NOT be present
    expect(screen.queryByRole('button', { name: /jetzt einschreiben/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lizenz kaufen/i })).not.toBeInTheDocument();
  });

  it('shows "Lizenz kaufen" when logged in without entitlement', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    authState.user = { id: 'user-1' };
    authState.loading = false;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPage(client);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /lizenz kaufen/i })).toBeInTheDocument();
    }, { timeout: 4000 });
    expect(screen.queryByTestId('course-continue-btn')).not.toBeInTheDocument();
  });
});
