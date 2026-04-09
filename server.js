const http = require("http");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.MONGODB_DB || "websocket_demo";
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT) || 50;

const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  let urlPath = req.url === "/" ? "/index.html" : req.url;
  urlPath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC, urlPath);

  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function broadcast(wss, obj, except) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client !== except) {
      client.send(payload);
    }
  }
}

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db(DB_NAME);
  const messages = db.collection("messages");
  await messages.createIndex({ at: 1 });

  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server });

  let nextClientId = 1;

  wss.on("connection", (ws) => {
    const id = nextClientId++;
    ws.clientId = id;

    ws.send(
      JSON.stringify({
        type: "system",
        text: `You joined as client #${id}.`,
        at: Date.now(),
      })
    );

    (async () => {
      try {
        const docs = await messages
          .find({})
          .sort({ at: -1 })
          .limit(HISTORY_LIMIT)
          .toArray();
        const items = docs.reverse().map((d) => ({
          type: "chat",
          from: d.from,
          text: d.text,
          at: d.at,
        }));
        ws.send(JSON.stringify({ type: "history", items }));
      } catch (err) {
        console.error("history load failed:", err);
        ws.send(
          JSON.stringify({
            type: "system",
            text: "Could not load message history from the database.",
            at: Date.now(),
          })
        );
      }
    })();

    broadcast(
      wss,
      {
        type: "system",
        text: `Client #${id} connected (${wss.clients.size} online).`,
        at: Date.now(),
      },
      ws
    );

    ws.on("message", (raw) => {
      let text;
      try {
        const parsed = JSON.parse(raw.toString());
        text = typeof parsed.text === "string" ? parsed.text.trim() : "";
      } catch {
        text = raw.toString().trim();
      }

      if (!text) return;

      const at = Date.now();
      const msg = {
        type: "chat",
        from: id,
        text: text.slice(0, 2000),
        at,
      };

      messages
        .insertOne({ from: id, text: msg.text, at })
        .catch((err) => console.error("insert failed:", err));

      const payload = JSON.stringify(msg);
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(payload);
      }
    });

    ws.on("close", () => {
      broadcast(
        wss,
        {
          type: "system",
          text: `Client #${id} disconnected (${wss.clients.size} online).`,
          at: Date.now(),
        },
        ws
      );
    });
  });

  server.listen(PORT, () => {
    console.log(`MongoDB: ${DB_NAME} @ ${MONGODB_URI}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
  });

  const shutdown = async () => {
    await mongo.close();
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
