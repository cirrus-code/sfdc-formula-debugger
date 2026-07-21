import { hoverTooltip, type Tooltip } from "@codemirror/view";
import { getFunction, type FunctionSpec } from "../../registry/index.ts";
import { palette, font } from "../../theme/theme.ts";
import { signature } from "./signature.ts";

function tooltipDom(spec: FunctionSpec): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = `max-width:320px;padding:8px 10px;font-family:${font.sans};font-size:13px;line-height:1.5;`;

  const sig = document.createElement("div");
  sig.textContent = signature(spec);
  sig.style.cssText = `font-family:${font.mono};color:${palette.accent};margin-bottom:4px;`;
  root.appendChild(sig);

  const summary = document.createElement("div");
  summary.textContent = spec.summary;
  summary.style.color = palette.text;
  root.appendChild(summary);

  if (!spec.simulatable) {
    const note = document.createElement("div");
    note.textContent = "Not available in simulation (depends on org state).";
    note.style.cssText = `margin-top:4px;color:${palette.warning};font-size:12px;`;
    root.appendChild(note);
  }

  const link = document.createElement("a");
  link.href = spec.docsUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Salesforce docs ↗";
  link.style.cssText = `display:inline-block;margin-top:6px;color:${palette.accent};font-size:12px;`;
  root.appendChild(link);

  return root;
}

/** Hover a function name to see its signature, summary, and docs link. */
export const sfHover = hoverTooltip((view, pos): Tooltip | null => {
  const word = view.state.wordAt(pos);
  if (!word) {return null;}
  const spec = getFunction(view.state.sliceDoc(word.from, word.to));
  if (!spec) {return null;}
  return {
    pos: word.from,
    end: word.to,
    above: true,
    create: () => ({ dom: tooltipDom(spec) }),
  };
});
