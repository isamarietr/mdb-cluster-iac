// restore_indexes.js
//
// Replays _cluster_export.json (produced by export_indexes.js) onto a fresh
// cluster, recreating for every exported database:
//   - the databases and collections (with their creation options)
//   - every regular (MQL) index
//   - every Atlas Search / Vector Search index
//   - the sharding configuration (enable DB sharding, shard collections on the
//     stored shard keys)
//
// No database or collection names are hardcoded; everything comes from the file.
// Idempotent: recreating an existing identical index/collection is a no-op.
//
// Run with mongosh against a mongos router (sharded cluster):
//   mongosh "mongodb+srv://<user>:<pass>@<cluster>/" restore_indexes.js
// or from an interactive shell:
//   load("restore_indexes.js")

const fs = require("fs");

const INPUT_FILE = "_cluster_export.json"; // read from the current working dir

// Fields returned by getIndexes() that are not valid createIndex() options.
const NON_OPTION_FIELDS = [
  "v",
  "key",
  "ns",
  "background",
  "textIndexVersion",
  "2dsphereIndexVersion",
];

let dump;
try {
  dump = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
} catch (e) {
  print(`[error] reading ${INPUT_FILE}: ${e.message}`);
  quit(1);
}

const databases = dump.databases || {};

print(`\n=== Restoring ${Object.keys(databases).length} database(s) from ${INPUT_FILE} ===`);

for (const [dbName, dbSpec] of Object.entries(databases)) {
  const rdb = db.getSiblingDB(dbName);
  const collections = dbSpec.collections || {};

  print(`\n=== Database "${dbName}" ===`);

  // Enable sharding on the database first so collections can be sharded.
  if (dbSpec.databaseSharded) {
    try {
      sh.enableSharding(dbName);
      print(`[ok] sharding enabled on ${dbName}`);
    } catch (e) {
      print(`[warn] enableSharding(${dbName}): ${e.message}`);
    }
  }

  for (const [name, spec] of Object.entries(collections)) {
    const ns = `${dbName}.${name}`;

    // 1) Create the collection with its stored options (idempotent).
    try {
      if (!rdb.getCollectionNames().includes(name)) {
        rdb.createCollection(name, spec.options || {});
        print(`[ok] collection ${ns} created`);
      } else {
        print(`[ok] collection ${ns} already exists`);
      }
    } catch (e) {
      print(`[warn] createCollection on ${ns}: ${e.message}`);
    }

    // 2) Recreate the regular (MQL) indexes.
    for (const idx of spec.indexes || []) {
      if (idx.name === "_id_") continue; // the _id index is managed automatically

      const options = { ...idx };
      for (const field of NON_OPTION_FIELDS) delete options[field];

      try {
        rdb.getCollection(name).createIndex(idx.key, options);
        print(`[ok] ${ns}: index "${idx.name}" created`);
      } catch (e) {
        print(`[warn] createIndex ${ns}."${idx.name}": ${e.message}`);
      }
    }

    // 3) Shard the collection on its stored shard key (idempotent).
    if (spec.sharded && spec.shardKey) {
      const keyStr = JSON.stringify(spec.shardKey);

      // The shard-key index must exist before sharding.
      try {
        rdb.getCollection(name).createIndex(spec.shardKey, {
          unique: !!spec.shardKeyUnique,
        });
      } catch (e) {
        print(`[warn] shard-key index on ${ns} ${keyStr}: ${e.message}`);
      }

      try {
        sh.shardCollection(ns, spec.shardKey, !!spec.shardKeyUnique);
        print(`[ok] ${ns}: sharded on ${keyStr}`);
      } catch (e) {
        print(`[warn] shardCollection ${ns} ${keyStr}: ${e.message}`);
      }
    }

    // 4) Recreate the Atlas Search / Vector Search indexes.
    for (const si of spec.searchIndexes || []) {
      try {
        rdb
          .getCollection(name)
          .createSearchIndex(si.name, si.type || "search", si.definition);
        print(`[ok] ${ns}: search index "${si.name}" (${si.type}) created`);
      } catch (e) {
        print(`[warn] createSearchIndex ${ns}."${si.name}": ${e.message}`);
      }
    }
  }
}

print("\n=== Done ===");
