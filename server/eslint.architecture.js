import path from "node:path";

const sourceRoot = path.resolve(import.meta.dirname, "src");
const foundations = new Set(["db", "storage", "observability"]);
const capabilities = new Set(["agent", "conversation", "knowledge", "memory"]);
const transport = new Set(["routes", "middleware", "app", "main"]);

function owner(file) {
  return path
    .relative(sourceRoot, file)
    .split(path.sep)[0]
    .replace(/\.[^.]+$/, "");
}

export const architectureRule = {
  meta: { type: "problem", schema: [], messages: { boundary: "{{detail}}" } },
  create(context) {
    const file = context.filename;
    const from = owner(file);

    // Integration checks deliberately assemble routes and their resource owners.
    if (from.startsWith("..") || /\.test\.[jt]s$/.test(file)) {
      return {};
    }

    function check(node, source) {
      if (typeof source !== "string") {
        return;
      }

      let issue;
      const usesHttp = source === "hono" || source.startsWith("hono/");

      if (usesHttp && (foundations.has(from) || capabilities.has(from))) {
        issue = "HTTP framework adaptation belongs in routes or middleware.";
      } else if (source.startsWith(".")) {
        const to = owner(path.resolve(path.dirname(file), source));

        if (
          foundations.has(from) &&
          (capabilities.has(to) || transport.has(to))
        ) {
          issue =
            "Database, storage and telemetry must remain independent of application capabilities and HTTP.";
        } else if (capabilities.has(from) && transport.has(to)) {
          issue =
            "Application capabilities and upstream agents must not depend on HTTP assembly or transport.";
        } else if (from === "agent" && capabilities.has(to) && to !== "agent") {
          issue =
            "The upstream agent adapter must not depend on application capabilities.";
        }
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
