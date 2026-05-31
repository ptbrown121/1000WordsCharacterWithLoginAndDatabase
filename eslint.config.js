import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { files: ["js/**/*.js"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
  { files: ["api/**/*.js", "test/**/*.js"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.node } },
]);
