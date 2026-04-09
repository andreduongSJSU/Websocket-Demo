const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");
const form = document.getElementById("form");
const input = document.getElementById("message");
const sendBtn = document.getElementById("send");

function getWsUrl() {
  const params = new URLSearchParams(location.search);
  const explicit = params.get("ws");
  if (explicit) return explicit;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const portParam = params.get("port");

  if (location.protocol === "file:" || !location.host) {
    const port = portParam || "3000";
    return `${protocol}//localhost:${port}`;
  }

  if (portParam) {
    return `${protocol}//${location.hostname}:${portParam}`;
  }

  return `${protocol}//${location.host}`;
}

const wsUrl = getWsUrl();

let ws;
let reconnectTimer;

function setConnected(connected) {
  statusEl.textContent = connected ? "Connected" : "Disconnected";
  statusEl.className = `status ${connected ? "status--connected" : "status--disconnected"}`;
  input.disabled = !connected;
  sendBtn.disabled = !connected;
  if (connected) {
    hintEl.textContent = "";
  } else {
    const lines = [
      `Connecting to: ${wsUrl}`,
      "",
      "To get Connected:",
      "1) Install Node.js from https://nodejs.org (LTS) if you do not have it.",
      "2) Double-click start.bat in this project folder (or run: npm install then npm start in a terminal).",
      "3) In the browser, open exactly: http://localhost:3000",
      "   (Do not double-click index.html — the WebSocket must use the running server.)",
    ];
    if (location.protocol === "file:") {
      lines.splice(
        3,
        0,
        "You opened this page as a file. Use http://localhost:3000 after the server is running."
      );
    }
    if (location.port && location.port !== "3000" && !new URLSearchParams(location.search).get("port")) {
      lines.push(`This page is on port ${location.port}. Add ?port=3000 to the URL or use port 3000 for both.`);
    }
    hintEl.textContent = lines.join("\n");
  }
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function appendLine({ type, text, from, at }) {
  const li = document.createElement("li");
  const meta = document.createElement("div");
  meta.className = "meta";

  if (type === "system") {
    meta.textContent = `${formatTime(at)} · system`;
    const body = document.createElement("div");
    body.className = "text--system";
    body.textContent = text;
    li.append(meta, body);
  } else {
    meta.textContent = `${formatTime(at)} · client #${from}`;
    const body = document.createElement("div");
    body.className = "text--chat";
    body.textContent = text;
    li.append(meta, body);
  }

  logEl.appendChild(li);
  logEl.scrollTop = logEl.scrollHeight;
}

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    setConnected(true);
  });

  ws.addEventListener("message", (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "history" && Array.isArray(data.items)) {
        for (const item of data.items) {
          if (item.type === "chat") appendLine(item);
        }
        return;
      }
      if (data.type === "system" || data.type === "chat") {
        appendLine(data);
      }
    } catch {
      appendLine({ type: "system", text: ev.data, at: Date.now() });
    }
  });

  ws.addEventListener("close", () => {
    setConnected(false);
    reconnectTimer = setTimeout(connect, 2000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ text }));
  input.value = "";
  input.focus();
});

setConnected(false);
connect();
