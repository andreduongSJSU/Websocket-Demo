const { MongoClient } = require("mongodb");

async function connectMongo(uri, dbName) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const messages = db.collection("messages");
  await messages.createIndex({ at: 1 });
  return { client, messages };
}

module.exports = { connectMongo };
