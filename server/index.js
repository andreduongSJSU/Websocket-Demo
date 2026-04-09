require("dotenv").config();

const http = require("http");
const express = require("express");
const { connectMongo } = require("./lib/db");
const { attachWebSocketServer } = require("./lib/websocket");

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB || "websocket_demo";
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT) || 50;

async function main() {
  const { client: mongoClient, messages } = await connectMongo(MONGODB_URI, DB_NAME);

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (req, res) => {
    res.json({ ok: true, service: "websocket-demo-server" });
  });

  app.get("/api/messages", async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || HISTORY_LIMIT, 1), 200);
    try {
      const docs = await messages.find({}).sort({ at: -1 }).limit(limit).toArray();
      res.json({ items: docs.reverse() });
    } catch (err) {
      console.error("GET /api/messages:", err);
      res.status(500).json({ error: "database_error" });
    }
  });

  const server = http.createServer(app);

  const wss = attachWebSocketServer(server, messages, { historyLimit: HISTORY_LIMIT });

  server.listen(PORT, () => {
    console.log(`Express: http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT} (same port as HTTP)`);
    console.log(`MongoDB: ${DB_NAME} @ ${MONGODB_URI}`);
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
