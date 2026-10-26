#!/usr/bin/env bash

set -euo pipefail

[ "${SMGEN_ENGINE:-bash}" != "php" ] || exit 0

node ./bin/smgen-assistant.mjs build \
	--pages "${PAGES_DIR}" \
	--output "${OUTPUT_DIR}" \
	--base-url "${BASE_URL}"
