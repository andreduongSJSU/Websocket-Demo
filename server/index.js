require("dotenv").config();

const http = require("http");
const express = require("express");
const path = require("path");
const { connectMongo } = require("./lib/db");
const { attachWebSocketServer } = require("./lib/websocket");

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB || "websocket_demo";
const BOARD_W = Number(process.env.BOARD_W) || 96;
const BOARD_H = Number(process.env.BOARD_H) || 64;
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS) || 700;

async function main() {
  const { client: mongoClient, pixels } = await connectMongo(MONGODB_URI, DB_NAME);

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  const PUBLIC = path.join(__dirname, "public");
  app.use(express.static(PUBLIC));

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "websocket-demo-server" });
  });

  app.get("/api/board", async (req, res) => {
    try {
      const docs = await pixels
        .find({ x: { $gte: 0, $lt: BOARD_W }, y: { $gte: 0, $lt: BOARD_H } })
        .project({ _id: 0, x: 1, y: 1, c: 1, updatedAt: 1, updatedBy: 1 })
        .toArray();
      res.json({ w: BOARD_W, h: BOARD_H, cells: docs });
    } catch (err) {
      console.error("GET /api/board:", err);
      res.status(500).json({ error: "database_error" });
    }
  });

  app.get("/api/snapshot", async (req, res) => {
    try {
      const docs = await pixels
        .find({ x: { $gte: 0, $lt: BOARD_W }, y: { $gte: 0, $lt: BOARD_H } })
        .project({ _id: 0, x: 1, y: 1, c: 1 })
        .toArray();
      res.json({ v: 1, w: BOARD_W, h: BOARD_H, cells: docs, exportedAt: Date.now() });
    } catch (err) {
      console.error("GET /api/snapshot:", err);
      res.status(500).json({ error: "database_error" });
    }
  });

  app.post("/api/snapshot", async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object") return res.status(400).json({ error: "bad_json" });
    if (Number(body.w) !== BOARD_W || Number(body.h) !== BOARD_H) {
      return res.status(400).json({ error: "size_mismatch", expected: { w: BOARD_W, h: BOARD_H } });
    }
    if (!Array.isArray(body.cells)) return res.status(400).json({ error: "bad_cells" });

    const cells = [];
    for (const cell of body.cells) {
      if (!cell || typeof cell !== "object") continue;
      const x = Math.trunc(Number(cell.x));
      const y = Math.trunc(Number(cell.y));
      const c = typeof cell.c === "string" ? cell.c.trim().toLowerCase() : "";
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < 0 || y < 0 || x >= BOARD_W || y >= BOARD_H) continue;
      if (!/^#[0-9a-f]{6}$/.test(c)) continue;
      cells.push({ x, y, c, updatedAt: Date.now(), updatedBy: 0 });
      if (cells.length >= 200_000) break;
    }

    try {
      const ops = cells.map((p) => ({
        updateOne: {
          filter: { x: p.x, y: p.y },
          update: { $set: p },
          upsert: true,
        },
      }));

      // replace board: clear then apply
      await pixels.deleteMany({ x: { $gte: 0, $lt: BOARD_W }, y: { $gte: 0, $lt: BOARD_H } });
      if (ops.length) {
        await pixels.bulkWrite(ops, { ordered: false });
      }

      // tell clients to refresh
      const payload = JSON.stringify({ type: "refresh", at: Date.now() });
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(payload);
      }

      res.json({ ok: true, applied: ops.length });
    } catch (err) {
      console.error("POST /api/snapshot:", err);
      res.status(500).json({ error: "database_error" });
    }
  });

  const server = http.createServer(app);

  const wss = attachWebSocketServer(server, pixels, { boardW: BOARD_W, boardH: BOARD_H, cooldownMs: COOLDOWN_MS });

  server.listen(PORT, () => {
    console.log(`Express: http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT} (same port as HTTP)`);
    console.log(`MongoDB: ${DB_NAME} @ ${MONGODB_URI}`);
    console.log(`Board: ${BOARD_W}x${BOARD_H} cooldown=${COOLDOWN_MS}ms`);
  });

  const shutdown = async () => {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
    await mongoClient.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start:", err.message);
  console.error("Is MongoDB running? Default URI:", MONGODB_URI);
  process.exit(1);
});
