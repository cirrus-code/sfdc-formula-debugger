import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import promise from "eslint-plugin-promise";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { promise },
    rules: {
      // Enforce async/await over .then()/.catch() promise chains.
      "promise/prefer-await-to-then": "error",
      // Idiomatic JSX renders conditionals as ternaries, so a blanket no-ternary
      // would fight every component; nesting is where ternaries turn unreadable.
      "no-nested-ternary": "error",
      curly: ["error", "all"],
    },
  },
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
);
