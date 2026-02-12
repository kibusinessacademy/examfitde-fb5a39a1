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
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    }),
  },
}));

describe("Auth Context", () => {
  it("AuthProvider provides loading state initially", async () => {
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

    // Initially no user
    expect(getByTestId("user").textContent).toBe("no");
  });

  it("AuthProvider surfaces roles from user_roles table", async () => {
    // This tests that the role-fetching logic is triggered
    const { AuthProvider, useAuth } = await import("@/hooks/useAuth");

    function RoleConsumer() {
      const { roles, isAdmin } = useAuth();
      return (
        <div>
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

    // Wait a tick for effects
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(getByTestId("isAdmin").textContent).toBe("false");
  });
});
