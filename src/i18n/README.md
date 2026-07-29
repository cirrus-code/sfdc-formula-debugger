# i18n

Every user-facing string in the app lives here, in per-locale packs. English
(`en/`) is the reference pack: its inferred type **is** the `LocalePack`
contract, so a new locale that misses a key or a message-function signature
fails to compile.

No i18n library is used (bundle-lean rule). Interpolated messages are plain
typed functions — `problemCount: (n: number) => string` — so each locale
implements its own pluralization and word order directly.

## Layering

`src/i18n/` is a dependency **leaf**, below `syntax/` in the architecture
map: every layer may import it; it must never import from the rest of
`src/`. That is why message params are primitives (`string`/`number`) and
why registry lookups take the English value as a fallback argument instead
of importing the registry.

## Adding a locale

1. Create `src/i18n/de/` mirroring the `en/` domain files, or a single
   `de.ts` — either way, export one object typed as `LocalePack`:

   ```ts
   import type { LocalePack } from "../index.ts";
   export const de: LocalePack = { locale: "de", ... };
   ```

   Do **not** use `as const` in pack files (it narrows values to English
   literal types and would force every locale to repeat them).

2. Registry prose (function summaries, lint notes, context labels/notes,
   context runtime-error notes) is translated via the pack's sparse
   `registry` overlay (`RegistryOverlay` in `types.ts`), keyed by function
   name / note id / context id. Untranslated entries fall back to the
   registry's English.

3. Install it at boot, before first render (e.g. from `navigator.language`
   or a `?lang=` param), in `main.tsx`:

   ```ts
   setLocale(de);
   ```

   Locale is boot-time only today. Live switching would also require
   re-running parse/analysis (diagnostic and simplifier text is rendered
   eagerly in the active locale) and a React re-render — wire that up only
   if it's actually wanted.

4. `index.html` (`<title>`, `<meta name="description">`, `lang`) is static
   English and mirrors `en/copy.ts`. `document.title` is re-set from the
   catalog at boot; a localized deployment should also ship a localized
   `index.html` (or template it at build time).

## Deliberately not translated

- Formula-language tokens: function names, `TRUE`/`FALSE`, `NULL`.
- `#Error!` — this is simulated Salesforce _output_, and whether Salesforce
  localizes it is unverified (see VERIFICATION.md rules); until verified in
  an org, it stays the literal Salesforce token.
- Diagnostic `code` values — stable machine-readable ids, never shown as
  prose.
