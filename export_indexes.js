// export_indexes.js
//
// Connects to a MongoDB Atlas cluster and exports everything needed to
// recreate every non-system database after it is torn down:
//   - every collection (with its creation options)
//   - every regular (MQL) index definition
//   - every Atlas Search / Vector Search index definition
//   - the sharding configuration (database sharding flag + per-collection
//     shard key and uniqueness)
//
// No database or collection names are hardcoded; the whole cluster is walked.
// The result is written to _cluster_export.json (keyed by database, then
// collection name) and can be replayed by 5_restore_indexes.js.

const fs = require("fs");

const OUTPUT_FILE = "_cluster_export.json"; // written to the current working dir

// System databases that must not be recreated.
const SYSTEM_DBS = new Set(["admin", "config", "local", "__mdb_internal_atlas"]);

const configDb = db.getSiblingDB("config");

// Databases that have had sharding enabled (config.databases only lists those).
const shardedDbNames = new Set();
try {
  configDb.databases.find().forEach((d) => {
    if (d.partitioned) shardedDbNames.add(d._id);
  });
} catch (e) {
  // Not a sharded cluster (or no config access); sharding info is skipped.
  print(`[warn] reading config.databases: ${e.message}`);
}

// Map of namespace -> shard config, for every sharded collection in the cluster.
const shardConfigByNs = {};
try {
  configDb.collections.find({ dropped: { $ne: true } }).forEach((c) => {
    shardConfigByNs[c._id] = { key: c.key, unique: !!c.unique };
  });
} catch (e) {
  print(`[warn] reading config.collections: ${e.message}`);
}

// Discover every non-system database on the cluster.
let dbNames = [];
try {
  dbNames = db
    .getMongo()
    .getDBNames()
    .filter((name) => !SYSTEM_DBS.has(name));
} catch (e) {
  print(`[error] listing databases: ${e.message}`);
  quit(1);
}

const databases = {};

for (const dbName of dbNames) {
  const cdb = db.getSiblingDB(dbName);
  const collections = {};

  print(`\n=== Exporting database "${dbName}" ===`);

  // getCollectionInfos() gives us the creation options alongside the name.
  let infos = [];
  try {
    infos = cdb.getCollectionInfos();
  } catch (e) {
    print(`[warn] getCollectionInfos on ${dbName}: ${e.message}`);
    continue;
  }

  for (const info of infos) {
    const name = info.name;

    // Skip views and system collections; they can't be recreated the same way.
    if (info.type === "view" || name.startsWith("system.")) {
      print(`[skip] ${dbName}.${name} (${info.type || "system"})`);
      continue;
    }

    const ns = `${dbName}.${name}`;
    const entry = {
      options: info.options || {},
      indexes: [],
      searchIndexes: [],
      sharded: false,
      shardKey: null,
      shardKeyUnique: false,
    };

    // Regular (MQL) index definitions.
    try {
      entry.indexes = cdb.getCollection(name).getIndexes();
    } catch (e) {
      print(`[warn] getIndexes on ${ns}: ${e.message}`);
    }

    // Atlas Search / Vector Search index definitions (Atlas only).
    try {
      entry.searchIndexes = cdb
        .getCollection(name)
        .getSearchIndexes()
        .map((si) => ({
          name: si.name,
          type: si.type || "search",
          definition: si.latestDefinition,
        }));
    } catch (e) {
      // Non-Atlas clusters don't support search indexes; skip quietly.
      print(`[warn] getSearchIndexes on ${ns}: ${e.message}`);
    }

    // Sharding configuration for this collection, if any.
    const shard = shardConfigByNs[ns];
    if (shard) {
      entry.sharded = true;
      entry.shardKey = shard.key;
      entry.shardKeyUnique = shard.unique;
    }

    collections[name] = entry;
    print(
      `[ok] ${ns}: ${entry.indexes.length} index(es), ` +
        `${entry.searchIndexes.length} search index(es)` +
        (entry.sharded ? `, shard key ${JSON.stringify(entry.shardKey)}` : "")
    );
  }

  databases[dbName] = {
    databaseSharded: shardedDbNames.has(dbName),
    collections,
  };
}

const output = {
  exportedAt: new Date().toISOString(),
  databases,
};

try {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  const dbCount = Object.keys(databases).length;
  const collCount = Object.values(databases).reduce(
    (sum, d) => sum + Object.keys(d.collections).length,
    0
  );
  print(
    `\n=== Wrote ${dbCount} database(s), ${collCount} collection(s) to ${OUTPUT_FILE} ===`
  );
} catch (e) {
  print(`[error] writing ${OUTPUT_FILE}: ${e.message}`);
  quit(1);
}
