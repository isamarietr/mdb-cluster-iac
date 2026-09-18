
terraform {
  required_providers {
    mongodbatlas = {
      source  = "mongodb/mongodbatlas"
      version = "~> 2.0"
    }
  }
}

provider "mongodbatlas" {
  public_key  = var.ATLAS_PUBLIC_KEY
  private_key = var.ATLAS_PRIVATE_KEY
}

resource "mongodbatlas_advanced_cluster" "myCluster" {
  project_id                    = var.ATLAS_PROJECT_ID
  name                          = var.CLUSTER_NAME
  cluster_type                  = var.cluster.cluster_type
  mongo_db_major_version        = var.cluster.mongo_db_major_version
  backup_enabled                = var.cluster.backup_enabled
  pit_enabled                   = var.cluster.pit_enabled
  retain_backups_enabled        = try(var.cluster.retain_backups_enabled, null)
  config_server_management_mode = try(var.cluster.config_server_management_mode, null)

  # Topology (shards, region configs, instance sizes) comes from the captured
  # cluster.auto.tfvars.json produced by export_cluster_config.js.
  replication_specs = var.cluster.replication_specs

  // Optional: Add tags as needed
  // tags = { env = "production" }
}

# Atlas Search nodes are a separate resource, not part of the cluster.
resource "mongodbatlas_search_deployment" "search" {
  project_id   = var.ATLAS_PROJECT_ID
  cluster_name = mongodbatlas_advanced_cluster.myCluster.name

  specs = var.search_deployment.specs
}

# Use terraform output to display connection strings.
output "connection_strings" {
  value = mongodbatlas_advanced_cluster.myCluster.connection_strings
}
