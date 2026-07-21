/**
 * ui/ — React + CodeMirror 6 (editor, simulation form, panels, permalinks).
 *
 * Top of the stack. Contains no Salesforce semantics: if formula behavior starts
 * being encoded in a component, it belongs further down the stack. May depend on
 * every layer below.
 */
export { App } from "./App.tsx";
