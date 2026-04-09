const { WebSocketServer } = require("ws");

function broadcast(wss, obj, except) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client !== except) {
      client.send(payload);
    }
  }
}

function attachWebSocketServer(httpServer, messages, options) {
  const { historyLimit } = options;
  const wss = new WebSocketServer({ server: httpServer });

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
          .limit(historyLimit)
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

      messages.insertOne({ from: id, text: msg.text, at }).catch((err) => {
        console.error("insert failed:", err);
      });

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

  return wss;
}

module.exports = { attachWebSocketServer };
