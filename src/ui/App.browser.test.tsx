import { expect, test, beforeEach, afterEach, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "./App.tsx";

/**
 * Runtime smoke tests: these exercise the CodeMirror integration in a real
 * browser — the seam the node unit suite structurally can't reach (editor
 * mount, decoration rendering, live diagnostics). Formula correctness is not
 * tested here; that lives in the fast lexer/parser suites.
 */

let consoleErrors: string[] = [];
let restore: (() => void) | undefined;

beforeEach(() => {
  consoleErrors = [];
  const spy = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    });
  restore = () => spy.mockRestore();
});

afterEach(() => {
  restore?.();
});

async function typeFormula(
  container: HTMLElement,
  text: string,
): Promise<void> {
  const content = container.querySelector<HTMLElement>(".cm-content")!;
  await userEvent.click(content);
  await userEvent.keyboard("{Control>}a{/Control}{Delete}");
  await userEvent.type(content, text);
}

test("mounts the CodeMirror editor with the sample formula highlighted", async () => {
  const screen = await render(<App />);

  await expect
    .poll(() => screen.container.querySelector(".cm-content"))
    .toBeTruthy();
  // Token-driven highlighting produced classed spans (the lexer ran end to end).
  await expect
    .poll(
      () =>
        screen.container.querySelectorAll(".cm-sf-keyword, .cm-sf-field")
          .length,
    )
    .toBeGreaterThan(0);
});

test("shows a clean Problems panel for a valid formula", async () => {
  const screen = await render(<App />);
  await expect.element(screen.getByText("Parses cleanly.")).toBeInTheDocument();
});

test("surfaces positioned diagnostics for a broken formula", async () => {
  const screen = await render(<App />);
  await expect
    .poll(() => screen.container.querySelector(".cm-content"))
    .toBeTruthy();

  await typeFormula(screen.container, "IF(a,");

  // Problems panel (fed synchronously from parse) reports the recovery diagnostic.
  await expect
    .element(screen.getByText(/Expected .* to close the function call/))
    .toBeInTheDocument();
  // And the linter renders a squiggle in the editor.
  await expect
    .poll(() => screen.container.querySelectorAll(".cm-lintRange").length)
    .toBeGreaterThan(0);
});

test("re-checks against the selected context", async () => {
  const screen = await render(<App />);
  // The sample returns Number; a validation rule must return Boolean.
  await screen
    .getByRole("combobox", { name: "Context" })
    .selectOptions("validation_rule");
  await expect
    .element(screen.getByText(/must return Boolean/))
    .toBeInTheDocument();
});

test("offers registry-driven autocomplete", async () => {
  const screen = await render(<App />);
  await expect
    .poll(() => screen.container.querySelector(".cm-content"))
    .toBeTruthy();

  await typeFormula(screen.container, "ISB");
  await userEvent.keyboard("{Control>} {/Control}"); // Ctrl-Space opens completions

  await expect
    .poll(
      () =>
        screen.container.ownerDocument.querySelector(".cm-tooltip-autocomplete")
          ?.textContent ?? "",
    )
    .toContain("ISBLANK");
});

test("simulates the formula live from field inputs", async () => {
  const screen = await render(<App />);
  await expect.element(screen.getByText("Simulate")).toBeInTheDocument();

  // The sample IF(ISBLANK(Amount), 0, Amount * 1.1): set Amount=100 => 110.
  await expect
    .poll(() => screen.container.querySelector('input[placeholder="value"]'))
    .toBeTruthy();
  const valueInput = screen.container.querySelector<HTMLInputElement>(
    'input[placeholder="value"]',
  )!;
  await userEvent.fill(valueInput, "100");

  await expect.element(screen.getByText("110")).toBeInTheDocument();
});

test("reformats the editor when Format is clicked", async () => {
  const screen = await render(<App />);
  await expect
    .poll(() => screen.container.querySelector(".cm-content"))
    .toBeTruthy();

  await typeFormula(screen.container, "IF(a,1,2)");
  await userEvent.click(screen.getByRole("button", { name: "Format" }));

  // Canonical spacing after commas is applied in place.
  await expect
    .poll(() => screen.container.querySelector(".cm-content")?.textContent ?? "")
    .toContain("IF(a, 1, 2)");
});

test("renders without console errors", async () => {
  await render(<App />);
  await expect.poll(() => consoleErrors.length).toBe(0);
});
