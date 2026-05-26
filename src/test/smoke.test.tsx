/**
 * Frontend Smoke Tests
 * Verifies core pages and components render without crashing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// Mock supabase before any component imports
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
      then: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    }),
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  },
}));


import { TestWrapper } from "@/test/mocks/router";

describe("Smoke Tests: Core Pages", () => {
  it("renders HomePage without crashing", async () => {
    const { default: HomePage } = await import("@/pages/HomePage");
    const { container } = render(
      <TestWrapper>
        <HomePage />
      </TestWrapper>
    );
    expect(container).toBeTruthy();
  });

  it("renders Auth page without crashing", async () => {
    const { default: Auth } = await import("@/pages/Auth");
    const { container } = render(
      <TestWrapper>
        <Auth />
      </TestWrapper>
    );
    expect(container).toBeTruthy();
  });

  it("renders NotFound page without crashing", async () => {
    const { default: NotFound } = await import("@/pages/NotFound");
    const { container } = render(
      <TestWrapper>
        <NotFound />
      </TestWrapper>
    );
    expect(container).toBeTruthy();
  });

  it("renders ShopPage without crashing", async () => {
    const { default: ShopPage } = await import("@/pages/ShopPage");
    const { container } = render(
      <TestWrapper>
        <ShopPage />
      </TestWrapper>
    );
    expect(container).toBeTruthy();
  });
});

describe("Smoke Tests: UI Components", () => {
  it("renders Button component", async () => {
    const { Button } = await import("@/components/ui/button");
    const { getByText } = render(<Button>Test Button</Button>);
    expect(getByText("Test Button")).toBeInTheDocument();
  });

  it("renders Card component", async () => {
    const { Card, CardHeader, CardTitle, CardContent } = await import("@/components/ui/card");
    const { getByText } = render(
      <Card>
        <CardHeader><CardTitle>Test Card</CardTitle></CardHeader>
        <CardContent>Content here</CardContent>
      </Card>
    );
    expect(getByText("Test Card")).toBeInTheDocument();
    expect(getByText("Content here")).toBeInTheDocument();
  });

  it("renders Badge component", async () => {
    const { Badge } = await import("@/components/ui/badge");
    const { getByText } = render(<Badge>Status</Badge>);
    expect(getByText("Status")).toBeInTheDocument();
  });

  it("renders Progress component", async () => {
    const { Progress } = await import("@/components/ui/progress");
    const { container } = render(<Progress value={75} />);
    expect(container.querySelector("[role='progressbar']")).toBeTruthy();
  });
});

describe("Smoke Tests: Design System Tokens", () => {
  it("Button uses semantic CSS variables, not hardcoded colors", async () => {
    const { Button } = await import("@/components/ui/button");
    const { container } = render(<Button variant="default">Styled</Button>);
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    // Should have class referencing design tokens, not raw colors
    expect(btn?.className).not.toMatch(/bg-\[#/);
  });
});
