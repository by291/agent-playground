import Editor, { loader } from "@monaco-editor/react";
// Register contribution services before the first editor creates its service container.
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";

// Bundle workers locally so the editor does not depend on a CDN.
self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === "json" ? new jsonWorker() : new editorWorker();
  },
};
loader.config({ monaco });

export function JsonEditor({
  component,
  value,
  onChange,
}: {
  component: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Editor
      key={component}
      height="100%"
      language="json"
      theme="vs"
      value={value}
      onChange={(next) => onChange(next ?? "")}
      loading={<p className="p-4 text-sm text-muted">Loading editor…</p>}
      options={{
        ariaLabel: `${component} JSON editor`,
        automaticLayout: true,
        fontSize: 13,
        minimap: { enabled: false },
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: "on",
      }}
    />
  );
}
