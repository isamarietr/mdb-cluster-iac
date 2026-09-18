#!/usr/bin/env node
"use strict";

/**
 * Export an Atlas cluster and Search deployment to Terraform variables JSON.
 * Uses only Node.js built-ins and Atlas HTTP Digest authentication.
 */

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");

const ATLAS_ORIGIN = "https://cloud.mongodb.com";
const ATLAS_BASE_PATH = "/api/atlas/v2";
const ACCEPT = "application/vnd.atlas.2024-08-05+json";
const TFVAR_FILE = "../terraform/cluster.auto.tfvars.json";

function env(name) {
  for (const key of [
    `ATLAS_${name}`,
    `TF_VAR_ATLAS_${name}`,
    `MONGODB_ATLAS_${name}`,
  ]) {
    if (process.env[key]) return process.env[key];
  }
  return undefined;
}

function parseArguments(argv) {
  const options = {};
  const names = new Set([
    "public-key",
    "private-key",
    "project-id",
    "cluster",
    "output",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected argument: ${argument}`);
    }
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator === -1 ? undefined : separator);
    if (!names.has(name)) throw new Error(`unknown option: --${name}`);
    const value = separator === -1 ? argv[++index] : argument.slice(separator + 1);
    if (!value || value.startsWith("--")) {
      throw new Error(`option --${name} requires a value`);
    }
    options[name] = value;
  }
  return options;
}

function usage() {
  return `Usage: node export_cluster_config.js [options]

Options:
  --public-key KEY    Atlas public API key
  --private-key KEY   Atlas private API key
  --project-id ID     Atlas project ID
  --cluster NAME      Atlas cluster name
  --output PATH       Output JSON file
  -h, --help          Show this help

Environment fallbacks:
  ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY, ATLAS_PROJECT_ID, CLUSTER_NAME`;
}

function parseDigestChallenge(header) {
  if (!header || !/^Digest\s/i.test(header)) {
    throw new Error("Atlas did not return an HTTP Digest challenge");
  }
  const challenge = {};
  const pattern = /(\w+)=(?:"((?:\\.|[^"])*)"|([^,\s]+))/g;
  let match;
  while ((match = pattern.exec(header.slice(7))) !== null) {
    challenge[match[1].toLowerCase()] = (match[2] ?? match[3]).replace(
      /\\"/g,
      '"'
    );
  }
  if (!challenge.realm || !challenge.nonce) {
    throw new Error("Atlas returned an incomplete HTTP Digest challenge");
  }
  return challenge;
}

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function digestAuthorization(challenge, method, requestPath, publicKey, privateKey) {
  const algorithm = (challenge.algorithm || "MD5").toUpperCase();
  if (algorithm !== "MD5") {
    throw new Error(`unsupported HTTP Digest algorithm: ${algorithm}`);
  }

  const qopOptions = (challenge.qop || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const qop = qopOptions.includes("auth") ? "auth" : undefined;
  if (qopOptions.length && !qop) {
    throw new Error(`unsupported HTTP Digest qop: ${challenge.qop}`);
  }

  const clientNonce = crypto.randomBytes(16).toString("hex");
  const nonceCount = "00000001";
  const firstHash = md5(`${publicKey}:${challenge.realm}:${privateKey}`);
  const secondHash = md5(`${method}:${requestPath}`);
  const response = qop
    ? md5(
        `${firstHash}:${challenge.nonce}:${nonceCount}:${clientNonce}:${qop}:${secondHash}`
      )
    : md5(`${firstHash}:${challenge.nonce}:${secondHash}`);

  const fields = [
    `username="${publicKey}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${requestPath}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`,
  ];
  if (challenge.opaque) fields.push(`opaque="${challenge.opaque}"`);
  if (qop) fields.push(`qop=${qop}`, `nc=${nonceCount}`, `cnonce="${clientNonce}"`);
  return `Digest ${fields.join(", ")}`;
}

function request(requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(`${ATLAS_ORIGIN}${requestPath}`, { headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.setTimeout(60000, () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
  });
}

function parseResponse(response, apiPath) {
  let parsed;
  try {
    parsed = response.body ? JSON.parse(response.body) : {};
  } catch (error) {
    throw new Error(`GET ${apiPath} returned invalid JSON: ${error.message}`);
  }
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`GET ${apiPath} failed: HTTP ${response.status}`);
    error.status = response.status;
    error.body = response.body;
    throw error;
  }
  return parsed;
}

async function get(apiPath, publicKey, privateKey) {
  const requestPath = `${ATLAS_BASE_PATH}${apiPath}`;
  const initial = await request(requestPath, { Accept: ACCEPT });
  if (initial.status !== 401) return parseResponse(initial, apiPath);

  const challenge = parseDigestChallenge(initial.headers["www-authenticate"]);
  const authorization = digestAuthorization(
    challenge,
    "GET",
    requestPath,
    publicKey,
    privateKey
  );
  const response = await request(requestPath, {
    Accept: ACCEPT,
    Authorization: authorization,
  });
  return parseResponse(response, apiPath);
}

function convertSpec(spec) {
  if (!spec) return undefined;
  const converted = {
    instance_size: spec.instanceSize,
    node_count: spec.nodeCount,
  };
  if (spec.diskSizeGB !== undefined && spec.diskSizeGB !== null) {
    converted.disk_size_gb = spec.diskSizeGB;
  }
  return converted;
}

function convertRegion(region) {
  const converted = {
    provider_name: region.providerName,
    region_name: region.regionName,
    priority: region.priority,
  };
  const electable = convertSpec(region.electableSpecs);
  if (electable) converted.electable_specs = electable;
  const readOnly = convertSpec(region.readOnlySpecs);
  if (readOnly?.node_count) converted.read_only_specs = readOnly;
  const analytics = convertSpec(region.analyticsSpecs);
  if (analytics?.node_count) converted.analytics_specs = analytics;
  return converted;
}

function buildClusterVar(cluster) {
  const replicationSpecs = (cluster.replicationSpecs || []).map((spec) => {
    const converted = {
      region_configs: (spec.regionConfigs || []).map(convertRegion),
    };
    if (spec.zoneName) converted.zone_name = spec.zoneName;
    return converted;
  });
  const result = {
    cluster_type: cluster.clusterType,
    mongo_db_major_version: cluster.mongoDBMajorVersion,
    backup_enabled: cluster.backupEnabled,
    pit_enabled: cluster.pitEnabled,
    replication_specs: replicationSpecs,
  };
  if (cluster.retainBackupsEnabled !== undefined) {
    result.retain_backups_enabled = cluster.retainBackupsEnabled;
  }
  if (cluster.configServerManagementMode) {
    result.config_server_management_mode = cluster.configServerManagementMode;
  }
  return result;
}

function buildSearchVar(deployment) {
  const sourceSpecs = deployment.effectiveSpecs || deployment.specs || [];
  const specs = sourceSpecs.map((spec) => {
    const converted = {
      instance_size: spec.instanceSize,
      node_count: spec.nodeCount,
    };
    if (spec.cloudProvider) converted.cloud_provider = spec.cloudProvider;
    if (spec.regionName) converted.region_name = spec.regionName;
    return converted;
  });
  return specs.length ? { specs } : undefined;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`[error] ${error.message}\n\n${usage()}`);
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const publicKey = options["public-key"] || env("PUBLIC_KEY");
  const privateKey = options["private-key"] || env("PRIVATE_KEY");
  const projectId = options["project-id"] || env("PROJECT_ID");
  const clusterName =
    options.cluster || process.env.CLUSTER_NAME || process.env.TF_VAR_CLUSTER_NAME;
  const fileName = clusterName ? `../config/${clusterName}.auto.tfvars.json` : TFVAR_FILE;
  const output =
    options.output || path.join(__dirname, fileName);
  const missing = [
    ["--public-key/ATLAS_PUBLIC_KEY", publicKey],
    ["--private-key/ATLAS_PRIVATE_KEY", privateKey],
    ["--project-id/ATLAS_PROJECT_ID", projectId],
    ["--cluster/CLUSTER_NAME", clusterName],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    console.error(`[error] missing required values: ${missing.join(", ")}`);
    return 2;
  }

  const encodedProject = encodeURIComponent(projectId);
  const encodedCluster = encodeURIComponent(clusterName);
  try {
    const cluster = await get(
      `/groups/${encodedProject}/clusters/${encodedCluster}`,
      publicKey,
      privateKey
    );
    const outputData = { cluster: buildClusterVar(cluster) };
    try {
      const deployment = await get(
        `/groups/${encodedProject}/clusters/${encodedCluster}/search/deployment`,
        publicKey,
        privateKey
      );
      const search = buildSearchVar(deployment);
      if (search) outputData.search_deployment = search;
    } catch (error) {
      if (error.status !== 400 && error.status !== 404) throw error;
      console.log(`[info] no Atlas Search deployment captured: HTTP ${error.status}`);
    }

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(outputData, null, 2)}\n`, "utf8");
    fs.copyFileSync(output, path.join(__dirname, TFVAR_FILE));
    const shards = outputData.cluster.replication_specs.length;
    console.log(`[ok] captured cluster '${clusterName}' (${shards} shard(s)) -> ${output}`);
    if (outputData.search_deployment) {
      console.log(
        `[ok] captured Atlas Search deployment (${outputData.search_deployment.specs.length} spec(s))`
      );
    }
    console.log("Provide it to Terraform with: terraform apply (auto-loaded)");
    return 0;
  } catch (error) {
    console.error(`[error] ${error.message}${error.body ? `\n${error.body}` : ""}`);
    return 1;
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  buildClusterVar,
  buildSearchVar,
  digestAuthorization,
  parseDigestChallenge,
};
