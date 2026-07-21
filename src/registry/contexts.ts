import type { FormulaContext, GlobalSpec } from "./types.ts";

/**
 * Formula contexts as pure configuration (DESIGN §5). All standard-formula-engine
 * contexts ship from day one; `tier` records verification status.
 *
 * Tier 1 = availability data treated as verified. Tier 2 = best-effort config,
 * surfaced in the UI as "availability data unverified for this context."
 *
 * NOTE (VERIFICATION.md): the global lists, blank-mode applicability, and
 * character limits below are not yet org-verified. They inform autocomplete and
 * soft diagnostics only.
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
  { name: "$CustomMetadata", simulatable: false },
  { name: "$Permission", simulatable: false },
  { name: "$Label", simulatable: false },
  { name: "$System", simulatable: false },
];

const COMMON_GLOBALS: readonly GlobalSpec[] = [...SIMULATABLE_GLOBALS, ...ORG_STATE_GLOBALS];

const TIER2_NOTE = "Function and global availability is unverified for this context.";

export const CONTEXTS: readonly FormulaContext[] = [
  // --- Tier 1 -------------------------------------------------------------
  {
    id: "formula_field",
    label: "Formula Field",
    tier: 1,
    globals: COMMON_GLOBALS,
    blankModeToggle: true,
    charLimit: 3900,
  },
  {
    id: "validation_rule",
    label: "Validation Rule",
    tier: 1,
    globals: COMMON_GLOBALS,
    requiredReturnType: "Boolean",
    blankModeToggle: false,
    charLimit: 3900,
  },
  {
    id: "flow_formula",
    label: "Flow Formula",
    tier: 1,
    globals: [...COMMON_GLOBALS, { name: "$Flow", simulatable: true }, { name: "$Record", simulatable: true }],
    blankModeToggle: false,
  },

  // --- Tier 2 (availability unverified) -----------------------------------
  {
    id: "default_value",
    label: "Default Value",
    tier: 2,
    globals: COMMON_GLOBALS,
    blankModeToggle: false,
    notes: TIER2_NOTE,
  },
  {
    id: "workflow_rule",
    label: "Workflow Rule",
    tier: 2,
    globals: COMMON_GLOBALS,
    requiredReturnType: "Boolean",
    blankModeToggle: false,
    notes: TIER2_NOTE,
  },
  {
    id: "workflow_field_update",
    label: "Workflow Field Update",
    tier: 2,
    globals: COMMON_GLOBALS,
    blankModeToggle: false,
    notes: TIER2_NOTE,
  },
  {
    id: "approval_entry",
    label: "Approval Process — Entry Criteria",
    tier: 2,
    globals: COMMON_GLOBALS,
    requiredReturnType: "Boolean",
    blankModeToggle: false,
    notes: TIER2_NOTE,
  },
  {
    id: "approval_step",
    label: "Approval Process — Step Criteria",
    tier: 2,
    globals: COMMON_GLOBALS,
    requiredReturnType: "Boolean",
    blankModeToggle: false,
    notes: TIER2_NOTE,
  },
  {
    id: "custom_button_link",
    label: "Custom Button / Link",
    tier: 2,
    globals: COMMON_GLOBALS,
    blankModeToggle: false,
    notes: TIER2_NOTE,
  },
  {
    id: "email_template",
    label: "Email Template Merge",
    tier: 2,
    globals: COMMON_GLOBALS,
    blankModeToggle: false,
    notes: TIER2_NOTE,
  },
  {
    id: "quick_action",
    label: "Quick Action Predefined Value",
    tier: 2,
    globals: COMMON_GLOBALS,
    blankModeToggle: false,
    notes: TIER2_NOTE,
  },
];

export const DEFAULT_CONTEXT_ID = "formula_field";
