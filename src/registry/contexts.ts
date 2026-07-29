import type { FormulaContext, GlobalSpec } from "./types.ts";

/**
 * Formula contexts as pure configuration (DESIGN §5). All standard-formula-engine
 * contexts ship from day one; `tier` records verification status.
 *
 * Tier 1 = availability data org-verified (corpus/org-availability.json,
 * orgcheck wave-2 pass, 2026-07-28): every registry function and global was
 * save-probed in the context's own metadata container, canary-gated. Tier 2 =
 * the org does NOT compile-check these containers' formulas at metadata
 * deploy (bogus functions deploy clean), so availability is unverifiable by
 * the org pass and remains best-effort; the UI labels it as such.
 *
 * src/registry/org-availability.test.ts enforces agreement between this data
 * and every conclusive org verdict.
 */

// Globals whose fields can be user-filled in simulation ($Record-like) vs.
// org-state globals that can only ever refuse to simulate (DESIGN §7).
const SIMULATABLE_GLOBALS: readonly GlobalSpec[] = [
  { name: "$User", simulatable: true },
  { name: "$Profile", simulatable: true },
  { name: "$UserRole", simulatable: true },
  { name: "$Organization", simulatable: true },
];

const ORG_STATE_GLOBALS: readonly GlobalSpec[] = [
  { name: "$Setup", simulatable: false },
  { name: "$Permission", simulatable: false },
  { name: "$Label", simulatable: false },
  { name: "$System", simulatable: false },
];

const CMT_GLOBAL: GlobalSpec = { name: "$CustomMetadata", simulatable: false };
const API_GLOBAL: GlobalSpec = { name: "$Api", simulatable: false };

/** Org-verified: accepted by every verifiable context. */
const CORE_GLOBALS: readonly GlobalSpec[] = [
  ...SIMULATABLE_GLOBALS,
  ...ORG_STATE_GLOBALS,
];

/** $CustomMetadata additionally resolves in formula fields, validation rules,
 * default values, and flow formulas — but NOT in workflow rules/field
 * updates, approval criteria, buttons, or quick actions (org-verified:
 * "Field $CustomMetadata.… does not exist"). */
const CORE_WITH_CMT: readonly GlobalSpec[] = [...CORE_GLOBALS, CMT_GLOBAL];

const TIER2_NOTE =
  "This context's formulas are not compile-checked at metadata deploy, so " +
  "function and global availability cannot be org-verified; treat " +
  "availability data as best-effort.";

export const CONTEXTS: readonly FormulaContext[] = [
  // --- Tier 1 (availability org-verified) ---------------------------------
  {
    id: "formula_field",
    label: "Formula Field",
    tier: 1,
    // $Api org-verified here (semantics:ff_api_global saves and evaluates).
    globals: [...CORE_WITH_CMT, API_GLOBAL],
    blankModeToggle: true,
    // Org-verified exact: 3,916 chars rejects with "Maximum length is 3,900
    // characters" (syntax:srclen_over).
    charLimit: 3900,
  },
  {
    id: "validation_rule",
    label: "Validation Rule",
    tier: 1,
    globals: CORE_WITH_CMT,
    requiredReturnType: "Boolean",
    blankModeToggle: false,
    charLimit: 3900,
  },
  {
    id: "flow_formula",
    label: "Flow Formula",
    tier: 1,
    globals: [
      ...CORE_WITH_CMT,
      API_GLOBAL,
      { name: "$Flow", simulatable: true },
      { name: "$Record", simulatable: true },
    ],
    blankModeToggle: false,
  },
  {
    id: "default_value",
    label: "Default Value",
    tier: 1,
    globals: CORE_WITH_CMT,
    blankModeToggle: false,
  },
  {
    id: "workflow_rule",
    label: "Workflow Rule",
    tier: 1,
    globals: CORE_GLOBALS,
    requiredReturnType: "Boolean",
    blankModeToggle: false,
  },
  {
    id: "workflow_field_update",
    label: "Workflow Field Update",
    tier: 1,
    globals: CORE_GLOBALS,
    blankModeToggle: false,
  },
  {
    id: "approval_entry",
    label: "Approval Process — Entry Criteria",
    tier: 1,
    globals: CORE_GLOBALS,
    requiredReturnType: "Boolean",
    blankModeToggle: false,
  },
  {
    id: "approval_step",
    label: "Approval Process — Step Criteria",
    tier: 1,
    globals: CORE_GLOBALS,
    requiredReturnType: "Boolean",
    blankModeToggle: false,
  },

  {
    id: "custom_button_link",
    label: "Custom Button / Link",
    tier: 1,
    // $Api org-verified in buttons; $CustomMetadata is rejected there.
    globals: [...CORE_GLOBALS, API_GLOBAL],
    blankModeToggle: false,
  },
  {
    id: "quick_action",
    label: "Quick Action Predefined Value",
    tier: 1,
    globals: CORE_GLOBALS,
    blankModeToggle: false,
  },

  // --- Tier 2 (deploy channel does not validate; unverifiable) ------------
  {
    id: "email_template",
    label: "Email Template Merge",
    tier: 2,
    globals: CORE_WITH_CMT,
    blankModeToggle: false,
    notes: TIER2_NOTE,
  },
];

export const DEFAULT_CONTEXT_ID = "formula_field";
