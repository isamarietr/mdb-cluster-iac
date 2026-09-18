# env.sh — single source of truth for Atlas credentials/targets.
# 
# TODO: !!! Copy this file to env.sh and fill in your real Atlas credentials/targets. !!!
#
# Usage (from this directory):
#   source env.sh
#
# Values are typed ONCE below. The TF_VAR_* exports simply mirror them so
# Terraform (which only auto-reads TF_VAR_-prefixed env vars) picks them up,
# while the Node.js scripts read the plain names.
#
# Do NOT commit real keys — env.sh is gitignored.

# --- define each value once ---
export ATLAS_PUBLIC_KEY="ATLAS_PUBLIC_KEY"
export ATLAS_PRIVATE_KEY="ATLAS_PRIVATE_KEY"
export ATLAS_PROJECT_ID="ATLAS_PROJECT_ID"
export CLUSTER_NAME="CLUSTER_NAME"
export MONGODB_URI="mongodb+srv://<username>:<password>@cluster0.mongodb.net/test"

# --- mirror to the names Terraform expects (no need to edit) ---
export TF_VAR_ATLAS_PUBLIC_KEY="$ATLAS_PUBLIC_KEY"
export TF_VAR_ATLAS_PRIVATE_KEY="$ATLAS_PRIVATE_KEY"
export TF_VAR_ATLAS_PROJECT_ID="$ATLAS_PROJECT_ID"
export TF_VAR_CLUSTER_NAME="$CLUSTER_NAME"
