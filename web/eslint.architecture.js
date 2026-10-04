import path from "node:path";

const sourceRoot = path.resolve(import.meta.dirname, "src");
const ranks = { app: 3, pages: 2, features: 1 };
const publicEntries = {
  knowledge: new Set(["index", ""]),
  conversation: new Set(["index", ""]),
  a2ui: new Set(["index", "", "A2UISurface"]),
};

function modulePath(file) {
  return path.relative(sourceRoot, file).split(path.sep);
}

function importTarget(file, source) {
  if (source.startsWith("@/")) {
    return path.resolve(sourceRoot, source.slice(2));
  }

  if (source.startsWith(".")) {
    return path.resolve(path.dirname(file), source);
  }

  return null;
}

function boundaryIssue(from, to) {
  const fromRank = ranks[from[0]] ?? 0;
  const toRank = ranks[to[0]] ?? 0;

  if (fromRank < toRank) {
    return "Imports must point from application to pages, features, and shared foundations.";
  }

  const conversationLogic =
    from[0] === "features" &&
    from[1] === "conversation" &&
    ["api", "model", "runtime"].includes(from[2]);

  if (conversationLogic && to[0] === "components") {
    return "Conversation API, model and runtime must stay independent of shared UI.";
  }

  const sameFeature =
    from[0] === "features" && to[0] === "features" && from[1] === to[1];

  if (sameFeature) {
    const targetLayer = (to[2] ?? "index").replace(/\.[^.]+$/, "");

    const fromPublicEntry =
      from.length === 3 && from[2].replace(/\.[^.]+$/, "") === "index";

    if (!fromPublicEntry && targetLayer === "index") {
      return "Feature internals must use local imports to avoid a cycle through their public entry.";
    }

    const forbiddenLayers = {
      api: new Set(["model", "runtime", "ui", "ConversationProvider"]),
      model: new Set(["runtime", "ui", "ConversationProvider"]),
      runtime: new Set(["ui", "ConversationProvider"]),
      ui: new Set(["runtime"]),
    };

    if (forbiddenLayers[from[2]]?.has(targetLayer)) {
      return "Feature models and runtime must not depend on their UI or React provider.";
    }

    return null;
  }

  if (to[0] === "features") {
    if (
      from[0] === "features" &&
      !(from[1] === "conversation" && to[1] === "a2ui")
    ) {
      return "The only cross-feature dependency is conversation to a2ui.";
    }

    const entry = to
      .slice(2)
      .join("/")
      .replace(/\.(?:ts|tsx|js|jsx)$/, "");

    if (!publicEntries[to[1]]?.has(entry)) {
      return "Use the feature's public entry instead of importing its internals.";
    }
  }

  if (
    from[0] === "pages" &&
    to[0] === "pages" &&
    pageOwner(from) !== pageOwner(to)
  ) {
    return "Pages compose features and must not import another page.";
  }

  return null;
}

function pageOwner(parts) {
  return parts[1] === "dev" ? parts.slice(1, 3).join("/") : parts[1];
}

export const architectureRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: { boundary: "{{detail}}" },
  },
  create(context) {
    const file = context.filename;
    const from = modulePath(file);

    function check(node, source) {
      if (
        typeof source !== "string" ||
        from[0].startsWith("..") ||
        from.length === 1
      ) {
        return;
      }

      const target = importTarget(file, source);

      if (!target) {
        return;
      }

      const issue = boundaryIssue(from, modulePath(target));

      if (issue) {
        context.report({
          node,
          messageId: "boundary",
          data: { detail: issue },
        });
      }
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => check(node, node.source.value),
    };
  },
};
