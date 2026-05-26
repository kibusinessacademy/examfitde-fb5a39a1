import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/hooks/useAuth";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

/**
 * Test-Wrapper für Smoke-Tests: liefert Router + QueryClient + Helmet + AuthProvider.
 *
 * Hinweis: AuthProvider braucht supabase.auth.{getSession,onAuthStateChange} —
 * Smoke-Tests müssen "@/integrations/supabase/client" mocken (siehe smoke.test.tsx).
 * Ohne Mock crasht der Provider beim ersten Effect — das ist gewollt: Production-Strict
 * (useAuth wirft außerhalb des Providers) bleibt unverändert.
 */
export function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}
