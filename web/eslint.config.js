import js from "@eslint/js";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": { entryPoint: "src/style.css", rootFontSize: 16 },
    },
    rules: {
      "better-tailwindcss/enforce-canonical-classes": "error",
      "better-tailwindcss/no-unnecessary-whitespace": "error",
    },
  },
]);
