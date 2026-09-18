#!/usr/bin/env node
"use strict";

// Export collections, regular indexes, Atlas Search indexes, and sharding
// metadata from every non-system database in a MongoDB cluster.

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const DEFAULT_OUTPUT_FILE = path.join(__dirname, `../config/${process.env.CLUSTER_NAME || "cluster"}_export.json`);
const SYSTEM_DATABASES = new Set([
  "admin",
  "config",
  "local",
  "__mdb_internal_atlas",
]);

function usage() {
  return "Usage: node export_indexes.js <mongodb-uri> [output-file]";
}

async function loadShardingMetadata(client) {
  const configDb = client.db("config");
  const [databaseRecords, collectionRecords] = await Promise.all([
    configDb.collection("databases").find({ partitioned: true }).toArray(),
    configDb.collection("collections").find({ dropped: { $ne: true } }).toArray(),
  ]);

  const shardedDatabaseNames = new Set(
    databaseRecords.map((record) => record._id)
  );
  const shardConfigByNamespace = new Map(
    collectionRecords.map((record) => [
      record._id,
      { key: record.key, unique: Boolean(record.unique) },
    ])
  );
  return { shardedDatabaseNames, shardConfigByNamespace };
}

async function exportCollection(database, databaseName, info, shardConfigByNamespace) {
  const collectionName = info.name;
  const namespace = `${databaseName}.${collectionName}`;
  const collection = database.collection(collectionName);
  const [indexes, searchIndexes] = await Promise.all([
    collection.indexes(),
    collection.aggregate([{ $listSearchIndexes: {} }]).toArray(),
  ]);
  const shard = shardConfigByNamespace.get(namespace);
  const entry = {
    options: info.options || {},
    indexes,
    searchIndexes: searchIndexes.map((searchIndex) => ({
      name: searchIndex.name,
      type: searchIndex.type || "search",
      definition: searchIndex.latestDefinition,
    })),
    sharded: Boolean(shard),
    shardKey: shard?.key || null,
    shardKeyUnique: shard?.unique || false,
  };

  console.log(
    `[ok] ${namespace}: ${entry.indexes.length} index(es), ` +
      `${entry.searchIndexes.length} search index(es)` +
      (entry.sharded ? `, shard key ${JSON.stringify(entry.shardKey)}` : "")
  );
  return entry;
}

async function exportDatabase(client, databaseName, shardingMetadata) {
  const database = client.db(databaseName);
  const collections = {};
  console.log(`\n=== Exporting database "${databaseName}" ===`);

  const collectionInfos = await database.listCollections().toArray();
  for (const info of collectionInfos) {
    if (info.type === "view" || info.name.startsWith("system.")) {
      console.log(`[skip] ${databaseName}.${info.name} (${info.type || "system"})`);
      continue;
    }
    collections[info.name] = await exportCollection(
      database,
      databaseName,
      info,
      shardingMetadata.shardConfigByNamespace
    );
  }

  return {
    databaseSharded: shardingMetadata.shardedDatabaseNames.has(databaseName),
    collections,
  };
}

async function exportCluster(client) {
  const shardingMetadata = await loadShardingMetadata(client);
  const databaseList = await client.db("admin").admin().listDatabases({
    nameOnly: true,
  });
  const databaseNames = databaseList.databases
    .map((database) => database.name)
    .filter((name) => !SYSTEM_DATABASES.has(name));

  const databases = {};
  for (const databaseName of databaseNames) {
    databases[databaseName] = await exportDatabase(
      client,
      databaseName,
      shardingMetadata
    );
  }
  return { exportedAt: new Date().toISOString(), databases };
}

async function main() {
  const mongodbUri = process.argv[2];
  const outputFile = process.argv[3] || DEFAULT_OUTPUT_FILE;
  if (!mongodbUri || process.argv.length > 4) {
    console.error(usage());
    return 2;
  }

  const client = new MongoClient(mongodbUri);
  try {
    await client.connect();
    const output = await exportCluster(client);
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

    const databaseCount = Object.keys(output.databases).length;
    const collectionCount = Object.values(output.databases).reduce(
      (sum, database) => sum + Object.keys(database.collections).length,
      0
    );
    console.log(
      `\n=== Wrote ${databaseCount} database(s), ${collectionCount} collection(s) ` +
        `to ${outputFile} ===`
    );
    return 0;
  } catch (error) {
    console.error(`[error] export failed: ${error.message}`);
    return 1;
  } finally {
    await client.close().catch((error) => {
      console.error(`[error] closing MongoDB connection: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    if (process.exitCode === undefined) process.exitCode = exitCode;
  });
}

module.exports = { exportCluster };
