/**
 * Webfont loading for the two families declared in `font` (theme.ts).
 *
 * Vite requires font CSS to be imported statically, so the files themselves
 * can't be derived from the `font` stacks at runtime. To swap a font:
 * change the @fontsource import(s) here, the matching stack in theme.ts,
 * and the package.json dependency — everything else resolves through
 * `--sfa-font-*` custom properties.
 */
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/jetbrains-mono";
