import { Page } from "@playwright/test";

export function collectConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });

  page.on("pageerror", (err) => {
    errors.push(String(err));
  });

  return errors;
}

export function filterBenignErrors(errors: string[]) {
  const benign = [
    "favicon",
    "ResizeObserver loop limit exceeded",
  ];

  return errors.filter((e) => !benign.some((b) => e.includes(b)));
}
