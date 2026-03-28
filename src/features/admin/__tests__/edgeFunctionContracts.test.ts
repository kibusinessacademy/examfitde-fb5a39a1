import { describe, it, expect } from "vitest";

/**
 * Edge Function Contract Tests
 *
 * Validates the input/output contracts of growth engine edge functions
 * without hitting the actual LLM or DB — pure structure validation.
 */

// --- Content type instruction mapping ---

const VALID_CONTENT_TYPES = [
  "short_video_script",
  "carousel_post",
  "social_caption",
  "faq_snippet",
  "blog_outline",
] as const;

const VALID_AUDIENCES = ["azubis", "betriebe", "institutionen"] as const;
const VALID_PLATFORMS = ["instagram", "facebook", "linkedin"] as const;

type ContentType = typeof VALID_CONTENT_TYPES[number];

function getRequiredOutputFields(contentType: ContentType): string[] {
  switch (contentType) {
    case "short_video_script":
      return ["title", "hook", "beats", "cta", "caption", "hashtags"];
    case "carousel_post":
      return ["title", "hook", "slides", "cta", "caption", "hashtags"];
    case "social_caption":
      return ["title", "hook", "caption", "cta", "hashtags"];
    case "faq_snippet":
      return ["title", "questions", "cta"];
    case "blog_outline":
      return ["title", "hook", "outline", "cta", "keywords"];
    default:
      return ["title", "hook", "caption", "cta"];
  }
}

// --- SEO page type validation ---

const VALID_SEO_PAGE_TYPES = [
  "product",
  "landing_azubis",
  "landing_betriebe",
  "landing_institutionen",
  "faq",
  "blog",
] as const;

type SeoPageOutput = {
  title: string;
  meta_description: string;
  content_md: string;
  faq_json: Array<{ q: string; a: string }>;
};

function validateSeoOutput(output: any): string[] {
  const errors: string[] = [];
  if (!output.title || typeof output.title !== "string") errors.push("missing title");
  if (!output.meta_description || typeof output.meta_description !== "string") errors.push("missing meta_description");
  if (!output.content_md || typeof output.content_md !== "string") errors.push("missing content_md");
  if (!Array.isArray(output.faq_json)) errors.push("faq_json is not an array");
  return errors;
}

// --- Lead capture validation ---

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

describe("Edge Function Contracts: Growth Content", () => {
  it("defines required output fields for all content types", () => {
    for (const ct of VALID_CONTENT_TYPES) {
      const fields = getRequiredOutputFields(ct);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields).toContain("title");
      expect(fields).toContain("cta");
    }
  });

  it("short_video_script requires beats", () => {
    expect(getRequiredOutputFields("short_video_script")).toContain("beats");
  });

  it("carousel_post requires slides", () => {
    expect(getRequiredOutputFields("carousel_post")).toContain("slides");
  });

  it("faq_snippet requires questions", () => {
    expect(getRequiredOutputFields("faq_snippet")).toContain("questions");
  });

  it("blog_outline requires keywords", () => {
    expect(getRequiredOutputFields("blog_outline")).toContain("keywords");
  });

  it("all audiences are valid", () => {
    expect(VALID_AUDIENCES).toContain("azubis");
    expect(VALID_AUDIENCES).toContain("betriebe");
    expect(VALID_AUDIENCES).toContain("institutionen");
  });

  it("all platforms are valid", () => {
    expect(VALID_PLATFORMS).toContain("instagram");
    expect(VALID_PLATFORMS).toContain("facebook");
    expect(VALID_PLATFORMS).toContain("linkedin");
  });
});

describe("Edge Function Contracts: SEO Page", () => {
  it("validates correct SEO output", () => {
    const valid: SeoPageOutput = {
      title: "Test",
      meta_description: "Desc",
      content_md: "# Content",
      faq_json: [{ q: "Was?", a: "Das." }],
    };
    expect(validateSeoOutput(valid)).toEqual([]);
  });

  it("detects missing fields", () => {
    const invalid = { title: "", meta_description: null, content_md: undefined, faq_json: "not array" };
    const errors = validateSeoOutput(invalid);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContain("missing title");
    expect(errors).toContain("missing meta_description");
    expect(errors).toContain("missing content_md");
    expect(errors).toContain("faq_json is not an array");
  });

  it("covers all SEO page types", () => {
    expect(VALID_SEO_PAGE_TYPES).toHaveLength(6);
    expect(VALID_SEO_PAGE_TYPES).toContain("product");
    expect(VALID_SEO_PAGE_TYPES).toContain("landing_azubis");
    expect(VALID_SEO_PAGE_TYPES).toContain("faq");
    expect(VALID_SEO_PAGE_TYPES).toContain("blog");
  });
});

describe("Edge Function Contracts: Capture Lead", () => {
  it("accepts valid emails", () => {
    expect(isValidEmail("test@example.com")).toBe(true);
    expect(isValidEmail("user.name+tag@domain.co")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("notanemail")).toBe(false);
    expect(isValidEmail("@domain.com")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("user @domain.com")).toBe(false);
  });
});
