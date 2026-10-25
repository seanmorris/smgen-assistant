#!/usr/bin/env bash

set -euo pipefail

npm run build
bash scripts/run-smgen.sh build
