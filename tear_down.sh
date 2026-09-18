#!/bin/sh
set -eu

MONGODB_URI=${1:?"Usage: $0 <mongodb-uri>"}

node export_cluster_config.js
mongosh "$MONGODB_URI" --quiet --file export_indexes.js
terraform -chdir=terraform destroy