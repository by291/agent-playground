import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { Linter } from "eslint";
import { architectureRule } from "../eslint.architecture.js";

const root = path.resolve(import.meta.dirname, "../src");

function lintImport(file, code) {
  return new Linter().verify(
    code,
    {
      plugins: { architecture: { rules: { boundaries: architectureRule } } },
      rules: { "architecture/boundaries": "error" },
    },
    { filename: path.join(root, file) },
  );
}

void test("imports cannot point back to application or page layers", () => {
  for (const [file, code] of [
    [
      "features/conversation/model/state.js",
      'import config from "@/app/config";',
    ],
    [
      "components/ui/button.js",
      'import Page from "../../pages/chat/ChatPage";',
    ],
    [
      "lib/utility.js",
      'export { state } from "@/features/conversation/model/state";',
    ],
  ]) {
    assert.equal(lintImport(file, code).length, 1, `${file}: ${code}`);
  }
});

void test("cross-module imports use public entries and explicit dependency directions", () => {
  for (const code of [
    'import { runtime } from "@/features/a2ui/runtime/runtime";',
    'const page = import("@/pages/dev/a2ui-components/ComponentsPage");',
    'import { session } from "../../conversation/runtime/session";',
  ]) {
    const file = code.includes("conversation/runtime")
      ? "features/a2ui/runtime/runtime.js"
      : "features/conversation/runtime/session.js";

    assert.equal(lintImport(file, code).length, 1, code);
  }
});

void test("page composition and internal module imports remain allowed", () => {
  for (const [file, code] of [
    ["app/App.js", 'import Page from "@/pages/chat/ChatPage";'],
    [
      "pages/chat/ChatPage.js",
      'import { Provider } from "@/features/conversation";',
    ],
    [
      "features/conversation/runtime/session.js",
      'import { state } from "../model/state";',
    ],
    [
      "features/conversation/runtime/session.js",
      'import { runtime } from "@/features/a2ui";',
    ],
    [
      "features/conversation/ui/messages/Reply.js",
      'const surface = import("@/features/a2ui/A2UISurface");',
    ],
    ["components/ui/button.js", 'import { cn } from "@/lib/utils";'],
  ]) {
    assert.deepEqual(lintImport(file, code), [], `${file}: ${code}`);
  }
});

void test("feature internals cannot cycle through their own public entry", () => {
  for (const source of ["@/features/conversation", "../index", "../index.ts"]) {
    assert.equal(
      lintImport(
        "features/conversation/runtime/session.js",
        `import { session } from "${source}";`,
      ).length,
      1,
    );
  }

  assert.equal(
    lintImport(
      "features/conversation/ConversationProvider.js",
      'import { state } from "./index";',
    ).length,
    1,
  );
});

void test("models stay independent of shared UI and development pages stay independent of each other", () => {
  for (const [file, code] of [
    [
      "features/conversation/model/state.js",
      'import { Button } from "@/components/ui/button";',
    ],
    [
      "pages/dev/a2ui-components/model/preview.js",
      'import { Preview } from "@/pages/dev/other-preview/Preview";',
    ],
  ]) {
    assert.equal(lintImport(file, code).length, 1);
  }
});
