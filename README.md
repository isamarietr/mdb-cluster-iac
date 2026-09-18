# MongoDB Atlas Cluster Setup and Teardown

Provision, export, restore, and destroy a MongoDB Atlas cluster while preserving
its topology, collections, indexes, Search indexes, and sharding configuration.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install)
- Node.js 16.20 or newer and npm
- An Atlas API key with project access
- A MongoDB user that can read all databases and administer collections,
  indexes, Search indexes, and sharding

## Install

```sh
npm install
cp sample.env.sh env.sh
```

Set the Atlas credentials, project ID, cluster name, and authenticated
`MONGODB_URI` in `env.sh`, then load it:

```sh
source env.sh
```

## Quick Start

### 1. Set Up

Create the cluster from a captured configuration, or use the default M30 replica
set when no captured configuration exists:

```sh
./1_set_up.sh
```

### 2. Restore (optional)

Restore collections, regular indexes, Search indexes, and sharding:

```sh
./2_restore.sh
```

You can provide the authenticated MongoDB URI directly:

```sh
./2_restore.sh "mongodb+srv://<user>:<password>@<cluster>/"
```

### 3. Tear Down

Export the live configuration and indexes, then destroy the Terraform resources:

```sh
./3_tear_down.sh
```

Commands stop on the first failure. The cluster is not destroyed unless both
exports succeed.

## Configuration Behavior

Without `terraform/cluster.auto.tfvars.json`, setup uses the default in
`terraform/variables.tf`: a three-node M30 replica set in AWS `US_EAST_1` with
MongoDB 8.0 and backups enabled.

Teardown writes:

- `config/<CLUSTER_NAME>.auto.tfvars.json` for cluster topology
- `config/<CLUSTER_NAME>_export.json` for collections, indexes, and sharding

The topology is also copied to `terraform/cluster.auto.tfvars.json`, overriding
the M30 default on the next setup. Restore reads the matching export from
`config/`.

## Scripts

| Script | Purpose |
| --- | --- |
| `1_set_up.sh` | Creates the Atlas cluster with Terraform |
| `2_restore.sh` | Restores database structures and indexes |
| `3_tear_down.sh` | Exports the cluster and runs `terraform destroy` |
| `export_config.sh` | Runs both Node.js export utilities |
| `utils/export_cluster_config.js` | Exports Atlas topology and Search nodes |
| `utils/export_indexes.js` | Exports collections, indexes, and shard keys |
| `utils/restore_indexes.js` | Restores the database export |
