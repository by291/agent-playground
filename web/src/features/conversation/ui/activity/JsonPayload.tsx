import { Fragment, useEffect, useState, type CSSProperties } from "react";
import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemedTokenWithVariants,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import json from "shiki/langs/json.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import "./activity.css";

// The grammar and engine live for the page lifetime; payload tokens stay with the open detail.
let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    langs: [json],
    themes: [githubLight, githubDark],
    engine: createJavaScriptRegexEngine(),
  });

  return highlighter;
}

export function JsonPayload({
  source,
  label = "Event payload",
}: {
  source: string;
  label?: string;
}) {
  const [highlighted, setHighlighted] = useState<{
    source: string;
    lines: ThemedTokenWithVariants[][];
  } | null>(null);

  useEffect(() => {
    let active = true;

    void getHighlighter()
      .then((instance) => {
        if (!active) {
          return;
        }

        const lines = instance.codeToTokensWithThemes(source, {
          lang: "json",
          themes: { light: "github-light", dark: "github-dark" },
          tokenizeMaxLineLength: 2000,
        });

        setHighlighted({ source, lines });
      })
      .catch(() => {
        // Syntax colors are optional; keep the complete source readable if loading fails.
      });

    return () => {
      active = false;
    };
  }, [source]);

  const lines = highlighted?.source === source ? highlighted.lines : null;

  return (
    <pre
      aria-label={label}
      className="activity-json mt-2 max-h-96 overflow-auto rounded-md bg-sidebar p-3 font-mono text-xs/6 whitespace-pre text-ink"
    >
      {lines
        ? lines.map((tokens, index) => (
            <Fragment key={index}>
              {index > 0 && "\n"}
              {tokens.map((token) => (
                <span
                  key={token.offset}
                  style={
                    {
                      "--json-light": token.variants.light?.color,
                      "--json-dark": token.variants.dark?.color,
                    } as CSSProperties
                  }
                >
                  {token.content}
                </span>
              ))}
            </Fragment>
          ))
        : source}
    </pre>
  );
}
