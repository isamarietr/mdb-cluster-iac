
# The  public API key for MongoDB Atlas
variable "ATLAS_PUBLIC_KEY" {
  description = "The public API key for MongoDB Atlas (set via TF_VAR_ATLAS_PUBLIC_KEY / env.sh)"
}
# The  private API key for MongoDB Atlas
variable "ATLAS_PRIVATE_KEY" {
  description = "The private API key for MongoDB Atlas (set via TF_VAR_ATLAS_PRIVATE_KEY / env.sh)"
  sensitive   = true
}

#The Atlas Project ID used to create the cluster 
variable "ATLAS_PROJECT_ID" {
  description = "The Atlas Project ID used to create the cluster "
}

variable "CLUSTER_NAME" {
  description = "The name of the MongoDB Atlas cluster"
}

variable "SNAPSHOT_ID" {
  description = "The ID of the snapshot to restore"
  default     = "6aa2bfff729b34861f326c65"
}

# Cluster provisioning shape. Overridden by cluster.auto.tfvars.json, which is
# generated from the live cluster by export_cluster_config.js. Typed as `any`
# so the captured JSON drops in without a rigid schema.
variable "cluster" {
  description = "Atlas cluster topology/settings (see export_cluster_config.js)"
  type        = any
  default = {
    cluster_type                  = "SHARDED"
    mongo_db_major_version        = "8.0"
    backup_enabled                = true
    pit_enabled                   = false
    retain_backups_enabled        = true
    config_server_management_mode = "FIXED_TO_DEDICATED"
    replication_specs = [
      {
        region_configs = [
          {
            provider_name = "AWS"
            region_name   = "US_EAST_1"
            priority      = 7
            electable_specs = {
              instance_size = "M50"
              node_count    = 3
              disk_size_gb  = 4096
            }
          }
        ]
      },
      {
        region_configs = [
          {
            provider_name = "AWS"
            region_name   = "US_EAST_1"
            priority      = 7
            electable_specs = {
              instance_size = "M50"
              node_count    = 3
              disk_size_gb  = 4096
            }
          }
        ]
      }
    ]
  }
}

# Atlas Search deployment. Also overridden by cluster.auto.tfvars.json.
variable "search_deployment" {
  description = "Atlas Search deployment specs"
  type        = any
  default = {
    specs = [
      {
        instance_size = "S50_HIGHCPU_NVME"
        node_count    = 2
      }
    ]
  }
}