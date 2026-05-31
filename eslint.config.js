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
    },
  },
  {
    files: ["api/**/*.js", "test/**/*.js"],
    plugins: { js, import: importPlugin },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.node, sourceType: "module" },
    rules: sharedRules,
  },
]);
