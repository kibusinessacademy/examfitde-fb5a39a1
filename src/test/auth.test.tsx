/**
 * Integration Tests: Auth Flow
 * Tests the authentication context and hooks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";

const mockSignIn = vi.fn().mockResolvedValue({ data: {}, error: null });
const mockSignUp = vi.fn().mockResolvedValue({ data: {}, error: null });
const mockSignOut = vi.fn().mockResolvedValue({});
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockOnAuthStateChange = vi.fn().mockReturnValue({
  data: { subscription: { unsubscribe: vi.fn() } },
});
const mockRoleQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn(),
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signInWithPassword: mockSignIn,
      signUp: mockSignUp,
      signOut: mockSignOut,
      signInWithOtp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
    from: vi.fn(() => mockRoleQuery),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    }),
  },
}));

describe("Auth Context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockRoleQuery.select.mockReturnThis();
    mockRoleQuery.eq.mockResolvedValue({ data: [], error: null });
  });

  it("AuthProvider resolves initial loading state", async () => {
    const { AuthProvider, useAuth } = await import("@/hooks/useAuth");

    function TestConsumer() {
      const { loading, user } = useAuth();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="user">{user ? "yes" : "no"}</span>
        </div>
      );
    }

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId("loading").textContent).toBe("false");
    expect(getByTestId("user").textContent).toBe("no");
  });

  it("AuthProvider surfaces admin roles from user_roles table", async () => {
    const { AuthProvider, useAuth } = await import("@/hooks/useAuth");

    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1", email: "admin@example.com" },
        },
      },
      error: null,
    });
    mockRoleQuery.eq.mockResolvedValue({ data: [{ role: "admin" }], error: null });

    function RoleConsumer() {
      const { roles, isAdmin, loading } = useAuth();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="roles">{JSON.stringify(roles)}</span>
          <span data-testid="isAdmin">{String(isAdmin)}</span>
        </div>
      );
    }

    const { getByTestId } = render(
      <AuthProvider>
        <RoleConsumer />
      </AuthProvider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getByTestId("loading").textContent).toBe("false");
    expect(getByTestId("roles").textContent).toContain("admin");
    expect(getByTestId("isAdmin").textContent).toBe("true");
  });

  it("keeps loading false only after roles settle on auth changes", async () => {
    const session = { user: { id: "user-2", email: "teacher@example.com" } };
    let authCallback: ((event: string, session: any) => void) | undefined;

    mockOnAuthStateChange.mockImplementation((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockRoleQuery.eq
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ role: "admin" }], error: null });

    const { AuthProvider, useAuth } = await import("@/hooks/useAuth");

    function RoleConsumer() {
      const { isAdmin } = useAuth();
      return <span data-testid="isAdmin">{String(isAdmin)}</span>;
    }

    const { getByTestId } = render(
      <AuthProvider>
        <RoleConsumer />
      </AuthProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      authCallback?.("SIGNED_IN", session);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getByTestId("isAdmin").textContent).toBe("true");
  });
});
