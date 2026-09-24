import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommendedTypeChecked, {
  languageOptions: { parserOptions: { projectService: true } },
  rules: {
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { fixStyle: "inline-type-imports" },
    ],
    "no-debugger": "error",
  },
});
