import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

/**
 * Permalink codec (DESIGN §8.5): the shareable editor state, lz-compressed
 * into a URL hash fragment. Encoding happens only on the explicit "Copy link"
 * action — formula text is user data and must never leave the editor on its
 * own.
 *
 * The payload carries a version field; decoding refuses unknown versions
 * rather than guessing at a future schema. A hash is untrusted input: decode
 * never throws, and every field is shape-checked (the UI additionally
 * validates field types and context ids against its own registries).
 */

export interface PermalinkField {
  /** An SfType name; validated by the simulation UI, not here. */
  readonly type: string;
  readonly value: string;
  readonly blank: boolean;
}

export interface PermalinkState {
  readonly context: string;
  readonly formula: string;
  readonly fields: Readonly<Record<string, PermalinkField>>;
  readonly blankMode: "zero" | "blank";
}

const VERSION = 1;

/** Encode state as a URL-safe hash fragment (without the leading '#'). */
export function encodePermalink(state: PermalinkState): string {
  return compressToEncodedURIComponent(
    JSON.stringify({ v: VERSION, ...state }),
  );
}

/** Decode a location.hash (with or without '#'). Null on anything invalid. */
export function decodePermalink(hash: string): PermalinkState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") {
    return null;
  }
  const json = decompressFromEncodedURIComponent(raw);
  if (!json) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const d = data as Record<string, unknown>;
  if (d["v"] !== VERSION) {
    return null;
  }
  if (typeof d["formula"] !== "string" || typeof d["context"] !== "string") {
    return null;
  }
  return {
    context: d["context"],
    formula: d["formula"],
    fields: decodeFields(d["fields"]),
    blankMode: d["blankMode"] === "blank" ? "blank" : "zero",
  };
}

function decodeFields(raw: unknown): Record<string, PermalinkField> {
  const out: Record<string, PermalinkField> = {};
  if (typeof raw !== "object" || raw === null) {
    return out;
  }
  for (const [name, entry] of Object.entries(raw)) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const f = entry as Record<string, unknown>;
    if (
      typeof f["type"] === "string" &&
      typeof f["value"] === "string" &&
      typeof f["blank"] === "boolean"
    ) {
      out[name] = { type: f["type"], value: f["value"], blank: f["blank"] };
    }
  }
  return out;
}
