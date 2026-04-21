const { MongoClient } = require("mongodb");

async function connectMongo(uri, dbName) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const pixels = db.collection("pixels");
  await pixels.createIndex({ x: 1, y: 1 }, { unique: true });
  await pixels.createIndex({ updatedAt: 1 });
  return { client, pixels };
}

module.exports = { connectMongo };
