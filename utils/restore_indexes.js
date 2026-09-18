#!/usr/bin/env node
"use strict";

// Restore collections, regular indexes, Atlas Search indexes, and sharding
// metadata exported by export_indexes.js.

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const DEFAULT_INPUT_FILE = path.join(__dirname, `../config/${process.env.CLUSTER_NAME || "cluster"}_export.json`);
const NON_OPTION_FIELDS = new Set([
  "v",
  "key",
  "ns",
  "background",
  "textIndexVersion",
  "2dsphereIndexVersion",
]);

function usage() {
  return "Usage: node restore_indexes.js <mongodb-uri> [input-file]";
}

function sameDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function indexOptions(index) {
  return Object.fromEntries(
    Object.entries(index).filter(([field]) => !NON_OPTION_FIELDS.has(field))
  );
}

async function ensureDatabaseSharding(client, databaseName) {
  await client.db("admin").command({ enableSharding: databaseName });
  console.log(`[ok] sharding enabled on ${databaseName}`);
}

async function ensureCollection(database, collectionName, options, existingNames) {
  const namespace = `${database.databaseName}.${collectionName}`;
  if (!existingNames.has(collectionName)) {
    await database.createCollection(collectionName, options || {});
    existingNames.add(collectionName);
    console.log(`[ok] collection ${namespace} created`);
  } else {
    console.log(`[ok] collection ${namespace} already exists`);
  }
  return database.collection(collectionName);
}

async function restoreIndexes(collection, namespace, indexes) {
  for (const index of indexes || []) {
    if (index.name === "_id_") continue;
    await collection.createIndex(index.key, indexOptions(index));
    console.log(`[ok] ${namespace}: index "${index.name}" ready`);
  }
}

async function ensureCollectionSharding(client, collection, namespace, spec) {
  if (!spec.sharded || !spec.shardKey) return;

  const current = await client
    .db("config")
    .collection("collections")
    .findOne({ _id: namespace, dropped: { $ne: true } });
  if (current) {
    if (
      !sameDocument(current.key, spec.shardKey) ||
      Boolean(current.unique) !== Boolean(spec.shardKeyUnique)
    ) {
      throw new Error(`${namespace} already has a different shard configuration`);
    }
    console.log(`[ok] ${namespace}: sharding already configured`);
    return;
  }

  await collection.createIndex(spec.shardKey, {
    unique: Boolean(spec.shardKeyUnique),
  });
  await client.db("admin").command({
    shardCollection: namespace,
    key: spec.shardKey,
    unique: Boolean(spec.shardKeyUnique),
  });
  console.log(`[ok] ${namespace}: sharded on ${JSON.stringify(spec.shardKey)}`);
}

async function restoreSearchIndexes(collection, namespace, searchIndexes) {
  const existing = await collection
    .aggregate([{ $listSearchIndexes: {} }])
    .toArray();
  const existingByName = new Map(existing.map((index) => [index.name, index]));

  for (const searchIndex of searchIndexes || []) {
    const current = existingByName.get(searchIndex.name);
    if (current) {
      if (
        current.type !== (searchIndex.type || "search") ||
        !sameDocument(current.latestDefinition, searchIndex.definition)
      ) {
        throw new Error(
          `${namespace} Search index "${searchIndex.name}" already exists with a different definition`
        );
      }
      console.log(`[ok] ${namespace}: Search index "${searchIndex.name}" already exists`);
      continue;
    }

    await collection.createSearchIndex({
      name: searchIndex.name,
      type: searchIndex.type || "search",
      definition: searchIndex.definition,
    });
    console.log(
      `[ok] ${namespace}: Search index "${searchIndex.name}" (${searchIndex.type || "search"}) created`
    );
  }
}

async function restoreCluster(client, dump) {
  const databases = dump.databases || {};
  console.log(`\n=== Restoring ${Object.keys(databases).length} database(s) ===`);

  for (const [databaseName, databaseSpec] of Object.entries(databases)) {
    const database = client.db(databaseName);
    const collectionSpecs = databaseSpec.collections || {};
    console.log(`\n=== Database "${databaseName}" ===`);

    if (databaseSpec.databaseSharded) {
      await ensureDatabaseSharding(client, databaseName);
    }

    const existingNames = new Set(
      (await database.listCollections({}, { nameOnly: true }).toArray()).map(
        (collection) => collection.name
      )
    );
    for (const [collectionName, spec] of Object.entries(collectionSpecs)) {
      const namespace = `${databaseName}.${collectionName}`;
      const collection = await ensureCollection(
        database,
        collectionName,
        spec.options,
        existingNames
      );
      await restoreIndexes(collection, namespace, spec.indexes);
      await ensureCollectionSharding(client, collection, namespace, spec);
      await restoreSearchIndexes(collection, namespace, spec.searchIndexes);
    }
  }
}

async function main() {
  const mongodbUri = process.argv[2];
  const inputFile = process.argv[3] || DEFAULT_INPUT_FILE;
  if (!mongodbUri || process.argv.length > 4) {
    console.error(usage());
    return 2;
  }

  let dump;
  try {
    dump = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  } catch (error) {
    console.error(`[error] reading ${inputFile}: ${error.message}`);
    return 1;
  }

  const client = new MongoClient(mongodbUri);
  let exitCode = 0;
  try {
    await client.connect();
    await restoreCluster(client, dump);
    console.log("\n=== Done ===");
  } catch (error) {
    console.error(`[error] restore failed: ${error.message}`);
    exitCode = 1;
  } finally {
    try {
      await client.close();
    } catch (error) {
      console.error(`[error] closing MongoDB connection: ${error.message}`);
      exitCode = 1;
    }
  }
  return exitCode;
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { indexOptions, restoreCluster };
