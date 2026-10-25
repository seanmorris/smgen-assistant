#!/usr/bin/env bash

set -euo pipefail

node ./bin/smgen-assistant.mjs build \
	--pages "${PAGES_DIR}" \
	--output "${OUTPUT_DIR}" \
	--base-url "${BASE_URL}"
