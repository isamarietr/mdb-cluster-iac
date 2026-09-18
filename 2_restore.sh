#!/bin/sh
set -eu

MONGODB_URI=${1:-${MONGODB_URI:-}}
if [ -z "$MONGODB_URI" ]; then
	echo "Usage: $0 <mongodb-uri> (or set MONGODB_URI)" >&2
	exit 2
fi

node ./utils/restore_indexes.js "$MONGODB_URI" "./config/${CLUSTER_NAME:-cluster}_export.json"