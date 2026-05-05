/**
 * Shared admin-test helpers — keep test files DRY.
 *
 * Use `clickButton` / `findAndClickButton` instead of redefining locally.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Click a button by accessible name (regex). Waits for it to appear if needed.
 */
export async function clickButton(name: RegExp): Promise<void> {
  const btn = await screen.findByRole("button", { name });
  await userEvent.click(btn);
}

/**
 * Wait for a text node, then click a button — handy for "row appears, then act".
 */
export async function awaitTextThenClick(text: string | RegExp, buttonName: RegExp): Promise<void> {
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
  await clickButton(buttonName);
}

/**
 * Confirm an AlertDialog (clicks the Action with the given label).
 */
export async function confirmDialog(actionName: RegExp = /bestätigen|ja|ok|gelöst|verwerfen/i): Promise<void> {
  const action = await screen.findByRole("button", { name: actionName });
  await userEvent.click(action);
}
