import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import codeStyle from "../eslint.style.mjs";
import { architectureRule } from "./eslint.architecture.js";

export default defineConfig([
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      codeStyle,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-deprecated": "error",
    },
  },
  {
    files: ["src/**/*.ts"],
    plugins: { architecture: { rules: { boundaries: architectureRule } } },
    rules: { "architecture/boundaries": "error" },
  },
  {
    files: ["*.js", "tests/**/*.js"],
    extends: [js.configs.recommended, codeStyle],
  },
]);
