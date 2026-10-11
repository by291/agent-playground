import { test } from "vitest";
import assert from "node:assert/strict";
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

test("imports cannot point back to application or page layers", () => {
  for (const [file, code] of [
    [
      "features/conversation/model/state.js",
      'import config from "@/app/config";',
    ],
    ["components/ui/button.js", 'import Page from "@/pages/chat/ChatPage";'],
    [
      "features/knowledge/ui/KnowledgeWorkspace.js",
      'import { ManagementLayout } from "@/layouts/ManagementLayout";',
    ],
    [
      "shared/preferences/preferences.js",
      'export { state } from "@/features/conversation/model/state";',
    ],
  ]) {
    assert.equal(lintImport(file, code).length, 1, `${file}: ${code}`);
  }
});

test("cross-module imports use public entries and explicit dependency directions", () => {
  for (const code of [
    'import { runtime } from "@/features/a2ui/runtime/a2ui-runtime";',
    'const page = import("@/pages/dev/a2ui-components/ComponentsPage");',
    'import { session } from "../../conversation/runtime/conversation-session";',
  ]) {
    const file = code.includes("conversation/runtime")
      ? "features/a2ui/runtime/a2ui-runtime.js"
      : "features/conversation/runtime/conversation-session.js";

    assert.equal(lintImport(file, code).length, 1, code);
  }
});

test("page composition and internal module imports remain allowed", () => {
  for (const [file, code] of [
    ["app/App.js", 'import Page from "@/pages/chat/ChatPage";'],
    [
      "pages/chat/ChatPage.js",
      'import { Provider } from "@/features/conversation";',
    ],
    [
      "pages/memory/MemoryPage.js",
      'import { ManagementLayout } from "@/layouts/ManagementLayout";',
    ],
    [
      "features/conversation/runtime/conversation-session.js",
      'import { state } from "../model/state";',
    ],
    [
      "features/conversation/runtime/conversation-session.js",
      'import { runtime } from "@/features/a2ui";',
    ],
    [
      "features/conversation/ui/messages/Reply.js",
      'const surface = import("@/features/a2ui/A2UISurface");',
    ],
    ["components/ui/button.js", 'import { cn } from "cn";'],
  ]) {
    assert.deepEqual(lintImport(file, code), [], `${file}: ${code}`);
  }
});

test("feature internals cannot cycle through their own public entry", () => {
  for (const source of ["@/features/conversation", "../index", "../index.ts"]) {
    assert.equal(
      lintImport(
        "features/conversation/runtime/conversation-session.js",
        `import { session } from "${source}";`,
      ).length,
      1,
    );
  }

  assert.equal(
    lintImport(
      "features/conversation/providers/ConversationProvider.js",
      'import { state } from "../index";',
    ).length,
    1,
  );
});

test("models stay independent of UI components and development pages stay independent of each other", () => {
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

test("shared foundations cannot import UI components, product features or layouts", () => {
  for (const code of [
    'import { Button } from "@/components/ui/button";',
    'import { session } from "@/features/conversation";',
    'const layout = import("@/layouts/ChatLayout");',
  ]) {
    assert.equal(lintImport("shared/hooks/useExample.js", code).length, 1);
  }
});

test("UI primitives cannot depend on application widgets", () => {
  assert.equal(
    lintImport(
      "components/ui/button.js",
      'import { SettingsControl } from "@/components/settings";',
    ).length,
    1,
  );
});

test("feature APIs and models stay independent of React hooks and UI", () => {
  for (const feature of ["conversation", "knowledge", "memory"]) {
    for (const layer of ["api", "model"]) {
      for (const target of ["hooks/useExample", "ui/Example"]) {
        assert.equal(
          lintImport(
            `features/${feature}/${layer}/example.js`,
            `import { example } from "../${target}";`,
          ).length,
          1,
        );
      }
    }
  }
});

test("layouts compose feature public entries and remain independent of pages", () => {
  assert.deepEqual(
    lintImport(
      "layouts/ChatLayout.js",
      'import { ConversationProvider } from "@/features/conversation";',
    ),
    [],
  );
  assert.equal(
    lintImport(
      "layouts/ChatLayout.js",
      'import { ChatPage } from "@/pages/chat/ChatPage";',
    ).length,
    1,
  );
});
