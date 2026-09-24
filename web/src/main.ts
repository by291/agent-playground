import { HttpAgent, type Message } from "@ag-ui/client";
import "./style.css";

const storageKey = "agent-playground-conversation";

type SavedConversation = { threadId: string; messages: Message[] };

function loadConversation(): SavedConversation {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as SavedConversation | null;
    if (saved?.threadId && Array.isArray(saved.messages)) return saved;
  } catch {
    // A malformed local cache should not prevent a new chat.
  }
  return { threadId: crypto.randomUUID(), messages: [] };
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing");

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">✳</span><span>agent playground</span></div>
      <div class="sidebar-section-label">WORKSPACE</div>
      <button class="new-chat" id="new-chat" type="button"><span>＋</span> New conversation</button>
      <div class="sidebar-bottom">
        <div class="stack-label">THE STACK</div>
        <div class="stack-line"><span class="stack-dot python"></span> Python agent</div>
        <div class="stack-line"><span class="stack-dot aegra"></span> Aegra runtime</div>
        <div class="stack-line"><span class="stack-dot ts"></span> TypeScript API + web</div>
      </div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div><div class="eyebrow">EXPERIMENT / 01</div><h1>Agent chat</h1></div>
        <div class="connection"><span id="connection-dot"></span><span id="connection-label">Checking connection</span></div>
      </header>
      <div class="content-grid">
        <section class="chat-panel">
          <div class="chat-scroll" id="chat-scroll">
            <div class="messages" id="messages"></div>
          </div>
          <form class="composer" id="composer">
            <textarea id="prompt" rows="2" placeholder="Ask the agent anything…" aria-label="Message"></textarea>
            <div class="composer-bottom">
              <span>Enter to send · Shift + Enter for a new line</span>
              <button id="send" type="submit">Send <span>↗</span></button>
            </div>
          </form>
        </section>
        <aside class="activity-panel">
          <div class="activity-heading"><span>LIVE EVENTS</span><span class="live-indicator">● LIVE</span></div>
          <p class="activity-description">AG-UI events generated from the Aegra run stream.</p>
          <div id="activity" class="activity-list"><div class="activity-empty">Events will appear when you send a message.</div></div>
          <div class="thread-card"><span>THREAD ID</span><code id="thread-id"></code></div>
        </aside>
      </div>
    </main>
  </div>
`;

const messagesElement = document.querySelector<HTMLDivElement>("#messages")!;
const activityElement = document.querySelector<HTMLDivElement>("#activity")!;
const promptElement = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const sendButton = document.querySelector<HTMLButtonElement>("#send")!;
const chatScroll = document.querySelector<HTMLDivElement>("#chat-scroll")!;
const threadElement = document.querySelector<HTMLElement>("#thread-id")!;
const connectionLabel = document.querySelector<HTMLElement>("#connection-label")!;
const connectionDot = document.querySelector<HTMLElement>("#connection-dot")!;

let conversation = loadConversation();
let agent = createAgent(conversation);
let running = false;
let eventCount = 0;

function createAgent(saved: SavedConversation): HttpAgent {
  const next = new HttpAgent({
    url: "/agent",
    threadId: saved.threadId,
    initialMessages: saved.messages,
  });
  next.subscribe({
    onEvent({ event }) {
      if (event.type === "RAW" || event.type === "STATE_SNAPSHOT") return;
      addActivity(event.type, "name" in event ? String(event.name) : undefined);
    },
    onMessagesChanged() {
      renderMessages();
      saveConversation();
    },
  });
  return next;
}

function saveConversation(): void {
  localStorage.setItem(storageKey, JSON.stringify({ threadId: agent.threadId, messages: agent.messages }));
}

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text" && "text" in part)
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

function renderMessages(): void {
  messagesElement.replaceChildren();
  const visible = agent.messages.filter((message) => message.role === "user" || message.role === "assistant");
  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="empty-symbol">✳</div><div class="empty-kicker">YOUR SANDBOX IS READY</div><h2>Start with a question.</h2><p>A small space to test an agent, its tools, and the events flowing between them.</p>`;
    messagesElement.append(empty);
    return;
  }
  for (const message of visible) {
    const content = messageText(message);
    if (!content) continue;
    const row = document.createElement("div");
    row.className = `message-row ${message.role}`;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = message.role === "user" ? "Y" : "✳";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = content;
    row.append(avatar, bubble);
    messagesElement.append(row);
  }
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function addActivity(type: string, detail?: string): void {
  if (eventCount++ === 0) activityElement.replaceChildren();
  const item = document.createElement("div");
  item.className = "activity-item";
  const badge = document.createElement("span");
  badge.className = `event-icon ${type.startsWith("RUN_") ? "run" : type.startsWith("TOOL_") ? "tool" : "text"}`;
  badge.textContent = type.startsWith("TOOL_") ? "⌘" : type.startsWith("RUN_") ? "●" : "↳";
  const label = document.createElement("span");
  label.textContent = detail ? `${type} · ${detail}` : type;
  item.append(badge, label);
  activityElement.prepend(item);
  while (activityElement.children.length > 30) activityElement.lastElementChild?.remove();
}

function setRunning(value: boolean): void {
  running = value;
  sendButton.disabled = value;
  promptElement.disabled = value;
  sendButton.innerHTML = value ? "Running…" : "Send <span>↗</span>";
}

async function sendMessage(): Promise<void> {
  const content = promptElement.value.trim();
  if (!content || running) return;
  promptElement.value = "";
  agent.addMessage({ id: crypto.randomUUID(), role: "user", content });
  renderMessages();
  saveConversation();
  setRunning(true);
  try {
    await agent.runAgent({ runId: crypto.randomUUID() });
  } catch (error) {
    console.error(error);
    addActivity("RUN_ERROR", error instanceof Error ? error.message : "Unknown error");
  } finally {
    setRunning(false);
    renderMessages();
    saveConversation();
    promptElement.focus();
  }
}

document.querySelector<HTMLFormElement>("#composer")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage();
});
promptElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
});
document.querySelector<HTMLButtonElement>("#new-chat")!.addEventListener("click", () => {
  if (running) agent.abortRun();
  conversation = { threadId: crypto.randomUUID(), messages: [] };
  agent = createAgent(conversation);
  eventCount = 0;
  activityElement.innerHTML = '<div class="activity-empty">Events will appear when you send a message.</div>';
  threadElement.textContent = conversation.threadId;
  setRunning(false);
  saveConversation();
  renderMessages();
  promptElement.focus();
});

threadElement.textContent = conversation.threadId;
renderMessages();
fetch("/health")
  .then((response) => {
    connectionLabel.textContent = response.ok ? "API connected" : "API unavailable";
    connectionDot.className = response.ok ? "connected" : "disconnected";
  })
  .catch(() => {
    connectionLabel.textContent = "API unavailable";
    connectionDot.className = "disconnected";
  });
