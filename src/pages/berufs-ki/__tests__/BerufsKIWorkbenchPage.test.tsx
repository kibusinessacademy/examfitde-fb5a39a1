/**
 * Berufs-KI Workbench · Rendering Smoke.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

vi.mock("@/lib/berufs-ki/api", () => ({
  listWorkflows: vi.fn(async () => [
    { id: "1", slug: "kundenmail", title: "Kundenmail erstellen", description: "Strukturierte Antwort.",
      category: "kommunikation", subcategory: null, curriculum_id: null, learning_field_id: null,
      competency_id: null, blueprint_id: null, competency_ids: [], target_roles: ["fachkraft"],
      tier_required: "free", input_schema: { fields: [] }, output_schema: { sections: [] },
      model_recommendation: "google/gemini-2.5-pro", compliance_level: "standard", risk_level: "low",
      is_active: true, version: 1, workflow_class: "official" },
  ]),
}));
vi.mock("@/components/berufs-ki/WorkflowRunner", () => ({ default: () => <div>runner</div> }));
vi.mock("@/components/berufs-ki/SubmissionDialog", () => ({ default: () => <button>Submit</button> }));
vi.mock("@/components/berufs-ki/UsageIntelligenceCard", () => ({ UsageIntelligenceCard: () => <div /> }));
vi.mock("@/components/berufs-ki/UpgradeRecommendationBanner", () => ({ UpgradeRecommendationBanner: () => <div /> }));
vi.mock("@/components/berufs-ki/LockedWorkflowPreview", () => ({ LockedWorkflowPreview: () => <div /> }));
vi.mock("@/components/os/BerufIdentityChip", () => ({ BerufIdentityChip: () => <div /> }));
vi.mock("@/lib/os/os-identity", () => ({ useOsBeruf: () => null }));
// Mock useAuth so the page doesn't require an AuthProvider in tests.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, roles: [], isAdmin: false, isTeacher: false }),
}));


import BerufsKIWorkbenchPage from "@/pages/berufs-ki/BerufsKIWorkbenchPage";

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <HelmetProvider><MemoryRouter>{children}</MemoryRouter></HelmetProvider>
);

describe("BerufsKIWorkbenchPage · rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rendert Header + Such-Input", async () => {
    render(<Wrap><BerufsKIWorkbenchPage /></Wrap>);
    expect(await screen.findByRole("searchbox", { name: /workflows durchsuchen/i })).toBeInTheDocument();
  });

  it("rendert Workflow-Karte aus Mock-Daten", async () => {
    render(<Wrap><BerufsKIWorkbenchPage /></Wrap>);
    await waitFor(() => expect(screen.getByText("Kundenmail erstellen")).toBeInTheDocument());
    expect(screen.getAllByTestId("workflow-card")).toHaveLength(1);
  });
});
