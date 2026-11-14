import path from "node:path";

const sourceRoot = path.resolve(import.meta.dirname, "src");
// prettier-ignore
const foundations = new Set([
  "db",
  "storage",
  "observability",
]);
// prettier-ignore
const capabilities = new Set([
  "agent",
  "conversation",
  "knowledge",
  "memory",
]);
// prettier-ignore
const transport = new Set([
  "routes",
  "middleware",
  "app",
  "main",
]);

function owner(file) {
  const relativePath = path.relative(sourceRoot, file);
  const [topLevelPath] = relativePath.split(path.sep);

  return topLevelPath.replace(/\.[^.]+$/, "");
}

function importBoundaryIssue({ importingOwner, importedOwner }) {
  const isFoundationImportingCapabilityOrTransport =
    foundations.has(importingOwner) &&
    (capabilities.has(importedOwner) || transport.has(importedOwner));

  if (isFoundationImportingCapabilityOrTransport) {
    return "Database, storage and telemetry must remain independent of application capabilities and HTTP.";
  }

  if (capabilities.has(importingOwner) && transport.has(importedOwner)) {
    return "Application capabilities and upstream agents must not depend on HTTP assembly or transport.";
  }

  const isAgentImportingCapability =
    importingOwner === "agent" &&
    capabilities.has(importedOwner) &&
    importedOwner !== "agent";

  if (isAgentImportingCapability) {
    return "The upstream agent adapter must not depend on application capabilities.";
  }

  return undefined;
}

/** Enforces the server's dependency direction for static and dynamic imports. */
export const architectureRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: { boundary: "{{detail}}" },
  },
  create(context) {
    const file = context.filename;
    const importingOwner = owner(file);

    // Integration checks deliberately assemble routes and their resource owners.
    if (importingOwner.startsWith("..") || /\.test\.[jt]s$/.test(file)) {
      return {};
    }

    function check(node, source) {
      if (typeof source !== "string") {
        return;
      }

      let issue;
      const usesHttp = source === "hono" || source.startsWith("hono/");
      const ownsHttpAdaptation =
        !foundations.has(importingOwner) && !capabilities.has(importingOwner);

      if (usesHttp && !ownsHttpAdaptation) {
        issue = "HTTP framework adaptation belongs in routes or middleware.";
      } else if (source.startsWith(".")) {
        const importedOwner = owner(path.resolve(path.dirname(file), source));

        issue = importBoundaryIssue({ importingOwner, importedOwner });
      }

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
