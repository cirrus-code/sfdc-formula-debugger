import { expect, test, beforeEach, afterEach, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { EditorView } from "@codemirror/view";
import { openLintPanel } from "@codemirror/lint";
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
  // A permalink hash left over from a previous test would seed the app.
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
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
  // ControlOrMeta: select-all is Cmd+A on macOS, Ctrl+A elsewhere.
  await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}{Delete}");
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
  await expect
    .element(screen.getByText("Parses correctly."))
    .toBeInTheDocument();
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

  // The sample's fields in extraction order: Discount__c, then Amount. With a
  // non-blank discount the result is mode-independent: 200 * (1 - 0.25) = 150.
  await expect
    .poll(
      () =>
        screen.container.querySelectorAll('input[placeholder="value"]').length,
    )
    .toBe(2);
  const [discountInput, amountInput] = Array.from(
    screen.container.querySelectorAll<HTMLInputElement>(
      'input[placeholder="value"]',
    ),
  );
  await userEvent.fill(discountInput!, "0.25");
  await userEvent.fill(amountInput!, "200");

  await expect.element(screen.getByText("150")).toBeInTheDocument();
});

test("surfaces lint findings in the Problems panel", async () => {
  const screen = await render(<App />);
  await expect
    .poll(() => screen.container.querySelector(".cm-content"))
    .toBeTruthy();

  await typeFormula(screen.container, 'TEXT(StageName) = "Won"');

  // The features-layer linter feeds the same panel as syntax/type diagnostics.
  await expect
    .element(screen.getByText(/ISPICKVAL\(StageName, "Won"\)/))
    .toBeInTheDocument();
});

test("inserts a function template at the cursor from the picker", async () => {
  const screen = await render(<App />);
  await expect
    .poll(() => screen.container.querySelector(".cm-content"))
    .toBeTruthy();

  await typeFormula(screen.container, "NOT(");
  await screen
    .getByRole("combobox", { name: "Insert function..." })
    .selectOptions("IF");

  // Inserted at the cursor (after the typed text), not replacing the document.
  await expect
    .poll(
      () => screen.container.querySelector(".cm-content")?.textContent ?? "",
    )
    .toContain("NOT(IF(logical_test, value_if_true, value_if_false)");
});

test("the insert picker offers only functions available in the active context", async () => {
  const screen = await render(<App />);
  const options = () => {
    const sel = screen.container.querySelector<HTMLSelectElement>(
      'select[aria-label="Insert function..."]',
    );
    return sel ? Array.from(sel.options).map((o) => o.value) : [];
  };

  // POWER is custom-button/link-only in the registry; the default
  // formula-field context must not offer it.
  await expect.poll(() => options().length).toBeGreaterThan(1);
  expect(options()).toContain("IF");
  expect(options()).not.toContain("POWER");

  await screen
    .getByRole("combobox", { name: "Context" })
    .selectOptions("custom_button_link");
  await expect.poll(() => options()).toContain("POWER");
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
    .poll(
      () => screen.container.querySelector(".cm-content")?.textContent ?? "",
    )
    .toContain("IF(a, 1, 2)");
});

test("simplifies with a step log and applies the result to the editor", async () => {
  const screen = await render(<App />);
  await expect
    .poll(() => screen.container.querySelector(".cm-content"))
    .toBeTruthy();

  await typeFormula(screen.container, "NOT(NOT(ISBLANK(Amount)))");

  // The step log names the rewrite rule.
  await expect
    .element(screen.getByText("Double negation cancels"))
    .toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  await expect
    .poll(
      () => screen.container.querySelector(".cm-content")?.textContent ?? "",
    )
    .toBe("ISBLANK(Amount)");
});

test("copies a permalink and restores formula, inputs, and result from it", async () => {
  const first = await render(<App />);
  await expect
    .poll(() => first.container.querySelector(".cm-content"))
    .toBeTruthy();

  await typeFormula(first.container, "Amount * 2");
  await expect
    .poll(() => first.container.querySelector('input[placeholder="value"]'))
    .toBeTruthy();
  const valueInput = first.container.querySelector<HTMLInputElement>(
    'input[placeholder="value"]',
  )!;
  await userEvent.fill(valueInput, "5");
  // exact: the about copy contains "10" as a substring ("100%").
  await expect
    .element(first.getByText("10", { exact: true }))
    .toBeInTheDocument();

  // Copy link writes the state into the URL hash — and only then; formula
  // text never leaves the page on its own.
  expect(window.location.hash).toBe("");
  await userEvent.click(first.getByRole("button", { name: /Copy link/ }));
  await expect.poll(() => window.location.hash.length).toBeGreaterThan(1);

  // A fresh app instance restores the whole session from the hash.
  first.unmount();
  const second = await render(<App />);
  await expect
    .poll(
      () => second.container.querySelector(".cm-content")?.textContent ?? "",
    )
    .toBe("Amount * 2");
  await expect
    .element(second.getByText("10", { exact: true }))
    .toBeInTheDocument();
});

test("flags pasted invisible characters, refuses to simulate, and fixes them all in one click", async () => {
  const screen = await render(<App />);
  await expect
    .poll(() => screen.container.querySelector(".cm-content"))
    .toBeTruthy();

  await typeFormula(screen.container, "IF(A\u200B > 1, 1,\u00A0 0)");

  // highlightSpecialChars renders both pasted characters as visible dots.
  await expect
    .poll(() => screen.container.querySelectorAll(".cm-specialChar").length)
    .toBeGreaterThanOrEqual(2);
  // Both diagnostics feed the Problems panel (fed synchronously from parse).
  await expect
    .element(screen.getByText(/Invisible character/))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText(/Non-standard space/))
    .toBeInTheDocument();
  // And CodeMirror's own linter registered them too (the gutter marker, not
  // the inline underline: the character's whole span is a replaced
  // special-char widget, so there is no ordinary text run left for the lint
  // mark to decorate).
  await expect
    .poll(
      () => screen.container.querySelectorAll(".cm-lint-marker-error").length,
    )
    .toBeGreaterThan(0);

  // Rule 1: recovery hands the simulator a structurally complete AST for this
  // invalid text, and it must refuse rather than answer for a formula
  // Salesforce would reject.
  await expect
    .element(screen.getByText(/Fix the syntax errors to simulate/))
    .toBeInTheDocument();

  // The lint panel is normally opened via a keybinding CM provides
  // (lintKeymap), which this editor doesn't wire up; call the same command
  // CodeMirror exports for it directly against the mounted view.
  const view = EditorView.findFromDOM(screen.container);
  expect(view).toBeTruthy();
  openLintPanel(view!);

  // Two fixable paste diagnostics \u2014 each carries its own fix plus the
  // combined fix-all action.
  const findFixAll = () =>
    Array.from(
      screen.container.querySelectorAll<HTMLButtonElement>(
        ".cm-diagnosticAction",
      ),
    ).find((b) => b.textContent?.includes("Fix all"));
  await expect.poll(() => findFixAll()).toBeTruthy();
  await userEvent.click(findFixAll()!);

  // One click cleans the whole paste: ZWSP removed, NBSP now a regular space.
  await expect
    .poll(
      () => screen.container.querySelector(".cm-content")?.textContent ?? "",
    )
    .not.toContain("\u200B");
  expect(
    screen.container.querySelector(".cm-content")?.textContent ?? "",
  ).not.toContain("\u00A0");
  // Re-linting after the edit no longer reports the pasted characters...
  await expect
    .poll(() => screen.container.textContent ?? "")
    .not.toContain("Invisible character");
  // ...and with the syntax errors gone, simulation is unblocked.
  await expect
    .poll(() => screen.container.textContent ?? "")
    .not.toContain("Fix the syntax errors to simulate");
});

test("renders without console errors", async () => {
  await render(<App />);
  await expect.poll(() => consoleErrors.length).toBe(0);
});
