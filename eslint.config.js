import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import globals from "globals";
import { defineConfig } from "eslint/config";

const sharedRules = {
  "import/no-cycle": "warn",
  "no-unused-vars": "warn",
};

export default defineConfig([
  {
    files: ["js/**/*.js"],
    plugins: { js, import: importPlugin },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.browser, sourceType: "module" },
    rules: {
      ...sharedRules,
      "no-alert": "warn",
      // Server-side Supabase keys bypass RLS and must never reach browser
      // code; Vite would inline them into the public bundle.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/SUPABASE_SECRET|SERVICE_ROLE|sb_secret/]",
          message: "Server-side Supabase keys must never be referenced in browser code.",
        },
        {
          selector: "Identifier[name=/SUPABASE_SECRET|SERVICE_ROLE/]",
          message: "Server-side Supabase keys must never be referenced in browser code.",
        },
      ],
    },
  },
  {
    files: ["api/**/*.js", "test/**/*.js", "e2e/**/*.js", "playwright.config.js"],
    plugins: { js, import: importPlugin },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.node, sourceType: "module" },
    rules: sharedRules,
  },
]);
