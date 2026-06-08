import { describe, it, expect } from "vitest";
import { isAllowedScope, HOST_ALLOWLIST, FORBIDDEN_PUBLIC_ROUTES, FORBIDDEN_PUBLIC_IDENTIFIERS } from "@/lib/product-scope";

describe("product-scope: berufos.com hard-separation", () => {
  it("berufos.com allows only berufos/examfit/admin", () => {
    expect(isAllowedScope("berufos.com", "berufos")).toBe(true);
    expect(isAllowedScope("berufos.com", "examfit")).toBe(true);
    expect(isAllowedScope("berufos.com", "admin")).toBe(true);
    expect(isAllowedScope("berufos.com", "vibeos")).toBe(false);
  });

  it("www.berufos.com is canonical-equivalent for scope rules", () => {
    expect(isAllowedScope("www.berufos.com", "vibeos")).toBe(false);
    expect(isAllowedScope("www.berufos.com", "berufos")).toBe(true);
  });

  it("forbidden public route prefixes are enumerated", () => {
    expect(FORBIDDEN_PUBLIC_ROUTES).toContain("/vibeos");
    expect(FORBIDDEN_PUBLIC_ROUTES).toContain("/platform");
    expect(FORBIDDEN_PUBLIC_ROUTES).toContain("/avatar");
    expect(FORBIDDEN_PUBLIC_ROUTES).toContain("/runtime");
    expect(FORBIDDEN_PUBLIC_ROUTES).toContain("/apps/new");
  });

  it("forbidden identifiers cover VibeOS surface", () => {
    expect(FORBIDDEN_PUBLIC_IDENTIFIERS).toContain("VibeOSLandingPage");
    expect(FORBIDDEN_PUBLIC_IDENTIFIERS).toContain("AvatarOS");
    expect(FORBIDDEN_PUBLIC_IDENTIFIERS).toContain("RuntimeCommandCenter");
    expect(FORBIDDEN_PUBLIC_IDENTIFIERS).toContain("BackgroundAgentRuntime");
  });

  it("HOST_ALLOWLIST never lists vibeos for berufos hosts", () => {
    for (const host of ["berufos.com", "www.berufos.com"]) {
      expect(HOST_ALLOWLIST[host]).not.toContain("vibeos");
    }
  });
});
