# MongoDB Atlas Cluster Setup and Teardown

Capture an Atlas cluster before destruction and recreate its topology,
collections, indexes, Search indexes, and sharding configuration.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install)
- Node.js 16.20 or newer and npm
- An Atlas API key with project access
- A database user whose URI can create collections and indexes, and administer sharding

## Install

```sh
npm install
cp sample.env.sh env.sh
```

Fill in the Atlas credentials, project, cluster name, and authenticated
`MONGODB_URI` in `env.sh`, then load it:

```sh
source env.sh
```

`env.sh` and generated exports are gitignored.

## Quick Start

Create the Atlas cluster from the captured Terraform configuration and restore
collections, indexes, Search indexes, and sharding:

```sh
./set_up.sh "mongodb+srv://<user>:<password>@<cluster>/"
```

Capture the live cluster configuration and indexes, then destroy the Terraform
resources:

```sh
./tear_down.sh
```

Both scripts require the authenticated MongoDB URI as an argument:

```sh
./set_up.sh "mongodb+srv://<user>:<password>@<cluster>/"
./tear_down.sh "mongodb+srv://<user>:<password>@<cluster>/"
```

Commands run sequentially and stop on the first failure. Teardown writes
`terraform/cluster.auto.tfvars.json` and `_cluster_export.json`; both are
required for the next setup.

## Cluster Configuration Behavior

### No Existing Cluster Export

If `terraform/cluster.auto.tfvars.json` does not exist, Terraform uses the
default configuration in `terraform/variables.tf`:

- Three-node M30 replica set
- AWS `US_EAST_1`
- MongoDB 8.0
- Backups enabled

`set_up.sh` requires `_cluster_export.json` for the restore step. For a new
environment without an export, run `terraform -chdir=terraform apply` directly.

### Existing Cluster

`tear_down.sh` captures the live cluster before destroying it. The generated
`terraform/cluster.auto.tfvars.json` overrides the M30 defaults on the next
`set_up.sh` run, recreating the exported topology, instance sizes, disk,
MongoDB version, backup settings, and Search nodes. `_cluster_export.json` is
then used to restore collections, regular indexes, Search indexes, and sharding.

## Scripts

| Script | Purpose |
| --- | --- |
| `set_up.sh` | Runs `terraform apply`, then restores collections, indexes, Search indexes, and sharding |
| `tear_down.sh` | Exports cluster configuration and indexes, then runs `terraform destroy` |
| `export_cluster_config.js` | Exports Atlas topology and Search node configuration |
| `export_indexes.js` | Exports collections, regular indexes, Search indexes, and shard keys |
| `restore_indexes.js` | Restores `_cluster_export.json` with the MongoDB Node.js driver |
