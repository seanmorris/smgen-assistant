#!/usr/bin/env bash

set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [ -n "${SMGEN_BIN:-}" ]; then
	smgen_command=${SMGEN_BIN}
	if [[ ${smgen_command} != /* ]]; then
		smgen_command="${project_dir}/${smgen_command}"
	fi
elif [ -x "${project_dir}/../smgen/smgen.sh" ]; then
	smgen_command="${project_dir}/../smgen/smgen.sh"
elif [ -x "${project_dir}/.smgen-core/smgen.sh" ]; then
	smgen_command="${project_dir}/.smgen-core/smgen.sh"
elif [ -x /app/smgen.sh ]; then
	smgen_command=/app/smgen.sh
elif command -v smgen >/dev/null 2>&1; then
	smgen_command=$(command -v smgen)
else
	echo "A current SMGen checkout is required." >&2
	echo "Clone https://github.com/seanmorris/smgen beside this repository or set SMGEN_BIN." >&2
	exit 1
fi

if [ ! -f "${smgen_command}" ] || ! grep -q 'auto_prepend_file=.*helpers/bootstrap.php' "${smgen_command}"; then
	echo "The selected SMGen command is too old for these templates: ${smgen_command}" >&2
	echo "Update SMGen or set SMGEN_BIN to a current smgen.sh checkout." >&2
	exit 1
fi

exec "${smgen_command}" "$@"
