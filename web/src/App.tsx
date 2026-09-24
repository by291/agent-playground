import type { Message } from "@ag-ui/client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  loadConversation,
  newConversation,
  saveConversation,
  type SavedConversation,
} from "./conversation";
import { useConversation, type Activity } from "./useConversation";

export function App() {
  const [conversation, setConversation] = useState(loadConversation);

  function startNewConversation() {
    const next = newConversation();
    saveConversation(next);
    setConversation(next);
  }

  return (
    <ConversationPage
      key={conversation.threadId}
      conversation={conversation}
      onNewConversation={startNewConversation}
    />
  );
}

function ConversationPage({
  conversation,
  onNewConversation,
}: {
  conversation: SavedConversation;
  onNewConversation: () => void;
}) {
  const { messages, activity, running, send } = useConversation(conversation);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">✳</span>
          <span>agent playground</span>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <button className="new-chat" type="button" onClick={onNewConversation}>
          <span>＋</span> New conversation
        </button>
        <div className="sidebar-bottom">
          <div className="stack-label">THE STACK</div>
          <div className="stack-line">
            <span className="stack-dot python" /> Python agent
          </div>
          <div className="stack-line">
            <span className="stack-dot aegra" /> Aegra runtime
          </div>
          <div className="stack-line">
            <span className="stack-dot ts" /> TypeScript API + web
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow">EXPERIMENT / 01</div>
            <h1>Agent chat</h1>
          </div>
          <ConnectionStatus />
        </header>
        <div className="content-grid">
          <section className="chat-panel">
            <MessageList messages={messages} />
            <Composer running={running} onSend={send} />
          </section>
          <ActivityPanel activity={activity} threadId={conversation.threadId} />
        </div>
      </main>
    </div>
  );
}

function ConnectionStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((response) => setConnected(response.ok))
      .catch(() => setConnected(false));
  }, []);

  return (
    <div className="connection">
      <span
        id="connection-dot"
        className={
          connected === null ? "" : connected ? "connected" : "disconnected"
        }
      />
      <span>
        {connected === null
          ? "Checking connection"
          : connected
            ? "API connected"
            : "API unavailable"}
      </span>
    </div>
  );
}

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && "text" in part,
    )
    .map((part) => part.text)
    .join("\n");
}

function MessageList({ messages }: { messages: Message[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  const visible = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);

  return (
    <div className="chat-scroll" ref={scroll}>
      <div className="messages">
        {visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-symbol">✳</div>
            <div className="empty-kicker">YOUR SANDBOX IS READY</div>
            <h2>Start with a question.</h2>
            <p>
              A small space to test an agent, its tools, and the events flowing
              between them.
            </p>
          </div>
        ) : (
          visible.map((message) => {
            const text = messageText(message);
            if (!text) return null;
            return (
              <div className={`message-row ${message.role}`} key={message.id}>
                <div className="avatar">
                  {message.role === "user" ? "Y" : "✳"}
                </div>
                <div className="bubble">{text}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Composer({
  running,
  onSend,
}: {
  running: boolean;
  onSend: (message: string) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!prompt.trim() || running) return;
    const message = prompt;
    setPrompt("");
    void onSend(message).finally(() => input.current?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        ref={input}
        rows={2}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask the agent anything…"
        aria-label="Message"
        disabled={running}
      />
      <div className="composer-bottom">
        <span>Enter to send · Shift + Enter for a new line</span>
        <button type="submit" disabled={running || !prompt.trim()}>
          {running ? (
            "Running…"
          ) : (
            <>
              Send <span>↗</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function ActivityPanel({
  activity,
  threadId,
}: {
  activity: Activity[];
  threadId: string;
}) {
  return (
    <aside className="activity-panel">
      <div className="activity-heading">
        <span>LIVE EVENTS</span>
        <span className="live-indicator">● LIVE</span>
      </div>
      <p className="activity-description">
        AG-UI events generated from the Aegra run stream.
      </p>
      <div className="activity-list">
        {activity.length === 0 ? (
          <div className="activity-empty">
            Events will appear when you send a message.
          </div>
        ) : (
          activity.map((event) => <ActivityItem key={event.id} event={event} />)
        )}
      </div>
      <div className="thread-card">
        <span>THREAD ID</span>
        <code>{threadId}</code>
      </div>
    </aside>
  );
}

function ActivityItem({ event }: { event: Activity }) {
  const kind = event.type.startsWith("RUN_")
    ? "run"
    : event.type.startsWith("TOOL_")
      ? "tool"
      : "text";
  const icon = kind === "tool" ? "⌘" : kind === "run" ? "●" : "↳";

  return (
    <div className="activity-item">
      <span className={`event-icon ${kind}`}>{icon}</span>
      <span>
        {event.type}
        {event.detail ? ` · ${event.detail}` : ""}
      </span>
    </div>
  );
}
