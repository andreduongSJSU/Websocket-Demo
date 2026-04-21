const { WebSocketServer } = require("ws");

function broadcast(wss, obj, except) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client !== except) {
      client.send(payload);
    }
  }
}

function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  n = Math.trunc(n);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeColor(c) {
  if (typeof c !== "string") return null;
  const s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  return null;
}

async function loadBoardPixels(pixels, boardW, boardH) {
  const docs = await pixels
    .find({ x: { $gte: 0, $lt: boardW }, y: { $gte: 0, $lt: boardH } })
    .project({ _id: 0, x: 1, y: 1, c: 1 })
    .toArray();
  return docs;
}

function attachWebSocketServer(httpServer, pixels, options) {
  const { boardW, boardH, cooldownMs } = options;
  const wss = new WebSocketServer({ server: httpServer });

  let nextClientId = 1;

  wss.on("connection", (ws) => {
    const id = nextClientId++;
    ws.clientId = id;
    ws.lastSetAt = 0;

    ws.send(
      JSON.stringify({
        type: "hello",
        clientId: id,
        board: { w: boardW, h: boardH, cooldownMs },
      })
    );

    (async () => {
      try {
        const cells = await loadBoardPixels(pixels, boardW, boardH);
        ws.send(JSON.stringify({ type: "init", w: boardW, h: boardH, cells }));
      } catch (err) {
        console.error("board init failed:", err);
        ws.send(
          JSON.stringify({
            type: "error",
            code: "init_failed",
          })
        );
      }
    })();

    broadcast(
      wss,
      {
        type: "presence",
        online: wss.clients.size,
      },
      ws
    );

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!msg || typeof msg !== "object") return;

      if (msg.type !== "set") return;

      const now = Date.now();
      if (cooldownMs > 0 && now - ws.lastSetAt < cooldownMs) {
        ws.send(JSON.stringify({ type: "cooldown", retryInMs: ws.lastSetAt + cooldownMs - now }));
        return;
      }

      const x = clampInt(Number(msg.x), 0, boardW - 1);
      const y = clampInt(Number(msg.y), 0, boardH - 1);
      const c = normalizeColor(msg.c);
      if (!c) return;

      ws.lastSetAt = now;

      pixels
        .updateOne({ x, y }, { $set: { x, y, c, updatedAt: now, updatedBy: id } }, { upsert: true })
        .catch((err) => console.error("pixel upsert failed:", err));

      broadcast(wss, { type: "set", x, y, c, at: now, by: id });
    });

    ws.on("close", () => {
      broadcast(
        wss,
        {
          type: "presence",
          online: wss.clients.size,
        },
        ws
      );
    });
  });

  return wss;
}

module.exports = { attachWebSocketServer };
