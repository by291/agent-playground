import stylistic from "@stylistic/eslint-plugin";

const controlFlow = ["if", "for", "while", "do", "switch", "try"];
const declarations = ["const", "let"];

export default {
  plugins: { "@stylistic": stylistic },
  rules: {
    curly: ["error", "all"],
    "no-nested-ternary": "error",
    "@stylistic/padding-line-between-statements": [
      "error",
      { blankLine: "always", prev: declarations, next: "*" },
      { blankLine: "any", prev: declarations, next: declarations },
      { blankLine: "always", prev: "*", next: controlFlow },
      { blankLine: "always", prev: controlFlow, next: "*" },
      { blankLine: "always", prev: "*", next: "return" },
      { blankLine: "always", prev: "*", next: ["function", "class"] },
      { blankLine: "always", prev: ["function", "class"], next: "*" },
    ],
    "@stylistic/lines-between-class-members": [
      "error",
      "always",
      { exceptAfterSingleLine: true },
    ],
  },
};
