import { describe, it, expect } from "vitest";

type RiskLevel = "low" | "medium" | "high";
type Role = "explainer" | "coach" | "examiner";

function steerRole(requestedRole: Role, riskLevel?: RiskLevel): Role {
  if (!riskLevel) return requestedRole;
  if (requestedRole !== "explainer") return requestedRole;

  if (riskLevel === "low") return "examiner";
  if (riskLevel === "medium") return "coach";
  return "explainer";
}

function buildDidacticInstruction(riskLevel?: RiskLevel) {
  if (riskLevel === "high") {
    return "Der Lernende hat erhöhten Trainingsbedarf. Erkläre grundlegend, nutze einfache Beispiele, baue Verständnis auf.";
  }
  if (riskLevel === "medium") {
    return "Der Lernende ist fast prüfungsreif. Fokussiere auf schwache Bereiche, stelle gezielte Übungsfragen, gib konkretes Feedback.";
  }
  if (riskLevel === "low") {
    return "Der Lernende ist prüfungsreif. Stelle anspruchsvolle Prüfungsfragen, simuliere IHK-Niveau, fordere Transfer-Denken.";
  }
  return "";
}

describe("Tutor mastery-aware role steering", () => {
  it("keeps explainer for high risk", () => {
    expect(steerRole("explainer", "high")).toBe("explainer");
  });

  it("switches explainer to coach for medium risk", () => {
    expect(steerRole("explainer", "medium")).toBe("coach");
  });

  it("switches explainer to examiner for low risk", () => {
    expect(steerRole("explainer", "low")).toBe("examiner");
  });

  it("does not override explicitly chosen non-default roles", () => {
    expect(steerRole("coach", "low")).toBe("coach");
    expect(steerRole("examiner", "high")).toBe("examiner");
  });
});

describe("Tutor mastery-aware didactic instructions", () => {
  it("returns foundational instruction for high risk", () => {
    expect(buildDidacticInstruction("high")).toContain("grundlegend");
  });

  it("returns practice-focused instruction for medium risk", () => {
    expect(buildDidacticInstruction("medium")).toContain("gezielte Übungsfragen");
  });

  it("returns examiner instruction for low risk", () => {
    expect(buildDidacticInstruction("low")).toContain("IHK-Niveau");
  });
});
