/**
 * Integration Tests: Hooks
 * Tests critical data hooks used across the app.
 */
import { describe, it, expect, vi } from "vitest";

// Lightweight mock
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  },
}));

describe("Critical Hooks - Module Integrity", () => {
  it("useExamSimulation exports correctly", async () => {
    const mod = await import("@/hooks/useExamSimulation");
    expect(mod).toBeDefined();
    expect(typeof mod.useExamSimulation).toBe("function");
  });

  it("useCourseProgress exports correctly", async () => {
    const mod = await import("@/hooks/useCourseProgress");
    expect(mod).toBeDefined();
  });

  it("useDashboardStats exports correctly", async () => {
    const mod = await import("@/hooks/useDashboardStats");
    expect(mod).toBeDefined();
    expect(typeof mod.useDashboardStats).toBe("function");
  });

  it("useShop exports correctly", async () => {
    const mod = await import("@/hooks/useShop");
    expect(mod).toBeDefined();
  });

  it("handbook hooks export correctly", async () => {
    const mod = await import("@/hooks/handbook");
    expect(mod).toBeDefined();
  });

  it("useEntitlements exports correctly", async () => {
    const mod = await import("@/hooks/useEntitlements");
    expect(mod).toBeDefined();
  });

  it("useExamReadiness exports correctly", async () => {
    const mod = await import("@/hooks/useExamReadiness");
    expect(mod).toBeDefined();
  });
});

describe("Utility Functions", () => {
  it("lib/utils exports cn() function", async () => {
    const { cn } = await import("@/lib/utils");
    expect(typeof cn).toBe("function");
    expect(cn("foo", "bar")).toBe("foo bar");
    expect(cn("foo", false && "bar")).toBe("foo");
  });

  it("lib/seo exports helper functions", async () => {
    const mod = await import("@/lib/seo");
    expect(mod).toBeDefined();
  });
});
