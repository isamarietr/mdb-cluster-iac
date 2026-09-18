#!/bin/sh
set -eu

source ./export_config.sh $MONGODB_URI
terraform -chdir=terraform destroy