const statusEl = document.getElementById("status");
const presenceEl = document.getElementById("presence");
const cooldownEl = document.getElementById("cooldown");
const boardWrap = document.getElementById("boardWrap");
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d", { alpha: false });

const swatchEl = document.getElementById("swatch");
const colorInput = document.getElementById("color");
const paletteEl = document.getElementById("palette");
const exportBtn = document.getElementById("export");
const importInput = document.getElementById("import");

function getWsUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}`;
}

const wsUrl = getWsUrl();

// Board state
let boardW = 96;
let boardH = 64;
let cooldownMs = 700;
let clientId = null;

// Viewport transform
let scale = 8; // pixels per cell
let offsetX = 0; // in screen pixels
let offsetY = 0;

let isPanning = false;
let panStart = null;

// Cooldown display
let cooldownUntil = 0;
let cooldownTimer = null;

const DEFAULT_BG = "#0b0e14";
let board = null; // Uint32Array (packed RGB)

function hexToRgbInt(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r << 16) | (g << 8) | b;
}

function rgbIntToCss(rgb) {
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  return `rgb(${r},${g},${b})`;
}

function setStatus(ok) {
  statusEl.textContent = ok ? "Connected" : "Disconnected";
  statusEl.className = `pill ${ok ? "pill--ok" : "pill--bad"}`;
}

function setPresence(n) {
  presenceEl.textContent = `${n} online`;
}

function setCooldownText(text) {
  cooldownEl.textContent = text;
}

function startCooldown(ms) {
  const until = Date.now() + ms;
  if (until > cooldownUntil) cooldownUntil = until;
  if (cooldownTimer) return;
  cooldownTimer = setInterval(() => {
    const left = cooldownUntil - Date.now();
    if (left <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      cooldownUntil = 0;
      setCooldownText("Ready");
      return;
    }
    setCooldownText(`Cooldown ${(left / 1000).toFixed(1)}s`);
  }, 100);
}

// Palette (simple r/place-ish set)
const PALETTE = [
  "#ffffff",
  "#e4e4e4",
  "#888888",
  "#222222",
  "#ffa7d1",
  "#e50000",
  "#e59500",
  "#a06a42",
  "#e5d900",
  "#94e044",
  "#02be01",
  "#00d3dd",
  "#0083c7",
  "#0000ea",
  "#cf6ee4",
  "#820080",
];

let selectedColor = colorInput.value.toLowerCase();

function setSelectedColor(c) {
  selectedColor = c.toLowerCase();
  colorInput.value = selectedColor;
  swatchEl.style.background = selectedColor;
  for (const el of paletteEl.querySelectorAll(".chip")) {
    el.setAttribute("aria-selected", el.dataset.c === selectedColor ? "true" : "false");
  }
}

function initPalette() {
  paletteEl.innerHTML = "";
  for (const c of PALETTE) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.dataset.c = c;
    btn.style.background = c;
    btn.setAttribute("aria-selected", "false");
    btn.addEventListener("click", () => setSelectedColor(c));
    paletteEl.appendChild(btn);
  }
  setSelectedColor(selectedColor);
}

colorInput.addEventListener("input", () => setSelectedColor(colorInput.value));
initPalette();

function resizeCanvasToWrap() {
  const rect = boardWrap.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

window.addEventListener("resize", resizeCanvasToWrap);

function screenToCell(x, y) {
  const cx = Math.floor((x - offsetX) / scale);
  const cy = Math.floor((y - offsetY) / scale);
  return { x: cx, y: cy };
}

function cellToScreen(x, y) {
  return { x: offsetX + x * scale, y: offsetY + y * scale };
}

function clampView() {
  // keep board somewhat in view
  const wPx = boardW * scale;
  const hPx = boardH * scale;
  const wrap = boardWrap.getBoundingClientRect();
  const minX = wrap.width - wPx - 40;
  const minY = wrap.height - hPx - 40;
  const maxX = 40;
  const maxY = 40;
  offsetX = Math.min(maxX, Math.max(minX, offsetX));
  offsetY = Math.min(maxY, Math.max(minY, offsetY));
}

function resetView() {
  const wrap = boardWrap.getBoundingClientRect();
  const scaleX = wrap.width / boardW;
  const scaleY = wrap.height / boardH;
  scale = Math.max(4, Math.min(20, Math.floor(Math.min(scaleX, scaleY))));
  offsetX = Math.floor((wrap.width - boardW * scale) / 2);
  offsetY = Math.floor((wrap.height - boardH * scale) / 2);
  clampView();
  draw();
}

function draw() {
  const wrap = boardWrap.getBoundingClientRect();
  ctx.clearRect(0, 0, wrap.width, wrap.height);

  // background
  ctx.fillStyle = DEFAULT_BG;
  ctx.fillRect(0, 0, wrap.width, wrap.height);

  if (!board) return;

  // draw visible cells
  const startCell = screenToCell(0, 0);
  const endCell = screenToCell(wrap.width, wrap.height);
  const x0 = Math.max(0, startCell.x - 1);
  const y0 = Math.max(0, startCell.y - 1);
  const x1 = Math.min(boardW - 1, endCell.x + 1);
  const y1 = Math.min(boardH - 1, endCell.y + 1);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const rgb = board[y * boardW + x];
      if (rgb === 0) continue;
      ctx.fillStyle = rgbIntToCss(rgb);
      const sx = offsetX + x * scale;
      const sy = offsetY + y * scale;
      ctx.fillRect(sx, sy, scale, scale);
    }
  }

  // grid when zoomed in
  if (scale >= 10) {
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= boardW; x++) {
      const sx = offsetX + x * scale;
      ctx.beginPath();
      ctx.moveTo(sx, offsetY);
      ctx.lineTo(sx, offsetY + boardH * scale);
      ctx.stroke();
    }
    for (let y = 0; y <= boardH; y++) {
      const sy = offsetY + y * scale;
      ctx.beginPath();
      ctx.moveTo(offsetX, sy);
      ctx.lineTo(offsetX + boardW * scale, sy);
      ctx.stroke();
    }
  }
}

function applyCell(x, y, c) {
  if (!board) return;
  if (x < 0 || y < 0 || x >= boardW || y >= boardH) return;
  board[y * boardW + x] = hexToRgbInt(c);
}

function ensureBoard(w, h) {
  boardW = w;
  boardH = h;
  board = new Uint32Array(w * h);
  resetView();
}

// Zoom and pan (A)
boardWrap.addEventListener("pointerdown", (e) => {
  boardWrap.setPointerCapture(e.pointerId);
  isPanning = true;
  panStart = { x: e.clientX, y: e.clientY, ox: offsetX, oy: offsetY };
});

boardWrap.addEventListener("pointermove", (e) => {
  if (!isPanning || !panStart) return;
  const dx = e.clientX - panStart.x;
  const dy = e.clientY - panStart.y;
  offsetX = panStart.ox + dx;
  offsetY = panStart.oy + dy;
  clampView();
  draw();
});

boardWrap.addEventListener("pointerup", () => {
  isPanning = false;
  panStart = null;
});

boardWrap.addEventListener("pointercancel", () => {
  isPanning = false;
  panStart = null;
});

boardWrap.addEventListener("dblclick", () => resetView());

boardWrap.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const oldScale = scale;
    const factor = Math.exp(-e.deltaY * 0.002);
    const newScale = Math.max(2, Math.min(60, oldScale * factor));
    if (Math.abs(newScale - oldScale) < 0.01) return;

    // zoom around mouse point
    const rect = boardWrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const before = screenToCell(mx, my);

    scale = newScale;
    const afterScreen = cellToScreen(before.x, before.y);
    offsetX += mx - afterScreen.x;
    offsetY += my - afterScreen.y;
    clampView();
    draw();
  },
  { passive: false }
);

// Click to paint (but ignore if it was a drag)
let lastPointerDown = null;
boardWrap.addEventListener("pointerdown", (e) => {
  const rect = boardWrap.getBoundingClientRect();
  lastPointerDown = { x: e.clientX - rect.left, y: e.clientY - rect.top, t: performance.now() };
});

boardWrap.addEventListener("pointerup", (e) => {
  if (!lastPointerDown) return;
  const rect = boardWrap.getBoundingClientRect();
  const up = { x: e.clientX - rect.left, y: e.clientY - rect.top, t: performance.now() };
  const dx = up.x - lastPointerDown.x;
  const dy = up.y - lastPointerDown.y;
  const dist = Math.hypot(dx, dy);
  const dt = up.t - lastPointerDown.t;
  lastPointerDown = null;
  if (dist > 6 || dt > 650) return; // treat as pan

  const { x, y } = screenToCell(up.x, up.y);
  if (x < 0 || y < 0 || x >= boardW || y >= boardH) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (cooldownUntil && Date.now() < cooldownUntil) return;

  const c = selectedColor;
  ws.send(JSON.stringify({ type: "set", x, y, c }));
});

// Snapshot (D)
exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  try {
    const res = await fetch("/api/snapshot");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `place-snapshot-${data.w}x${data.h}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Export failed: ${err.message || err}`);
  } finally {
    exportBtn.disabled = false;
  }
});

importInput.addEventListener("change", async () => {
  const file = importInput.files && importInput.files[0];
  importInput.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const res = await fetch("/api/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body}`.trim());
    }
  } catch (err) {
    alert(`Import failed: ${err.message || err}`);
  }
});

// WebSocket
let ws = null;
let reconnectTimer = null;

function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    setStatus(true);
  });

  ws.addEventListener("close", () => {
    setStatus(false);
    setPresence("—");
    reconnectTimer = setTimeout(connect, 1500);
  });

  ws.addEventListener("message", (ev) => {
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (!data || typeof data !== "object") return;

    if (data.type === "hello") {
      clientId = data.clientId;
      if (data.board) {
        boardW = data.board.w;
        boardH = data.board.h;
        cooldownMs = data.board.cooldownMs || cooldownMs;
      }
      return;
    }

    if (data.type === "presence" && typeof data.online === "number") {
      setPresence(data.online);
      return;
    }

    if (data.type === "cooldown" && typeof data.retryInMs === "number") {
      startCooldown(Math.max(0, Math.min(60_000, data.retryInMs)));
      return;
    }

    if (data.type === "init") {
      ensureBoard(Number(data.w) || boardW, Number(data.h) || boardH);
      if (Array.isArray(data.cells)) {
        for (const cell of data.cells) {
          if (!cell) continue;
          applyCell(Number(cell.x), Number(cell.y), String(cell.c || ""));
        }
      }
      draw();
      return;
    }

    if (data.type === "set") {
      applyCell(Number(data.x), Number(data.y), String(data.c || ""));
      draw();
      return;
    }

    if (data.type === "refresh") {
      // simplest: reload to re-fetch init state
      location.reload();
    }
  });
}

setStatus(false);
setPresence("—");
setCooldownText("Ready");
resizeCanvasToWrap();
connect();

