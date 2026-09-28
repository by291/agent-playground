import js from "@eslint/js";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import codeStyle from "../eslint.style.mjs";
import { architectureRule } from "./eslint.architecture.js";

export default defineConfig([
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat.recommended,
      codeStyle,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": {
        entryPoint: "src/styles/index.css",
        rootFontSize: 16,
      },
    },
    rules: {
      "@typescript-eslint/no-deprecated": "error",
      "better-tailwindcss/enforce-canonical-classes": "error",
      "better-tailwindcss/no-unnecessary-whitespace": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { architecture: { rules: { boundaries: architectureRule } } },
    rules: { "architecture/boundaries": "error" },
  },
  {
    files: ["*.js", "tests/**/*.js"],
    extends: [codeStyle],
  },
]);
