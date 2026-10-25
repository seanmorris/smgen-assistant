---
title: Installation
description: Install smgen-assistant and add it to an SMGen build.
weight: 1
menus:
  documentation:
    title: Installation
    weight: 1
---

# Installation

smgen-assistant builds its browser bundle and documentation corpus after SMGen
has rendered the site. Running it as an SMGen after-build hook keeps page URLs
and heading fragments aligned with the generated HTML.

## Requirements

The authoring environment needs:

- Node.js 20 or newer
- an SMGen site with Markdown under `PAGES_DIR`
- enough disk space for the installed WebLLM dependency and generated bundle

Visitors need a WebGPU browser. Each configured model can add feature, buffer,
and memory requirements.

## Install the Release

Install version 0.1.21 from its GitHub release asset:

```bash
npm install --save-dev \
  https://github.com/seanmorris/smgen-assistant/releases/download/v0.1.21/smgen-assistant-0.1.21.tgz
```

Confirm that the local executable is available:

```bash
npx --no-install smgen-assistant --help
```

## Load the Launcher

Add the loader path to `BODY_SCRIPTS` in `.smgen.yaml`:

```yaml
BODY_SCRIPTS:
  - /__smgen-assistant/loader.js
```

SMGen applies `BASE_URL` when it writes this script URL. A project hosted at
`https://example.github.io/manual/` therefore requests
`/manual/__smgen-assistant/loader.js`.

## Add the Build Hook

Create `after-smgen.sh` in the project root:

```bash
#!/usr/bin/env bash

set -euo pipefail

npx --no-install smgen-assistant build \
  --pages "${PAGES_DIR}" \
  --output "${OUTPUT_DIR}" \
  --base-url "${BASE_URL}"
```

Make the hook executable:

```bash
chmod +x after-smgen.sh
```

SMGen runs the hook after it installs a complete staged output. If the
assistant build fails, SMGen restores the prior output.

## Build the Site

Use an empty base URL for a root development server:

```bash
smgen build
smgen serve
```

Set the public base URL for a subpath deployment:

```bash
BASE_URL=https://example.github.io/manual smgen build
```

The assistant command accepts the same paths without a hook:

```text
smgen-assistant build [options]

--pages <directory>   Markdown source directory (default: ./pages)
--output <directory>  Generated site directory (default: ./docs)
--base-url <path>     Public path prefix, such as /manual
--config <file>       YAML configuration file
```

Command flags override `.smgen-assistant.yaml`. `BASE_URL` supplies the base
URL when neither the flag nor the file sets it.

## Generated Files

The command owns one directory under the generated site:

```text
docs/
└── __smgen-assistant/
    ├── assistant.css
    ├── config.json
    ├── corpus.json
    ├── engine-worker.js
    ├── frame.html
    ├── frame.js
    ├── loader.js
    ├── lotus.svg
    ├── service-worker.js
    └── chunks/
```

The build stages the complete directory before replacing the old copy. It does
not alter other generated site files.

## Verify the Integration

Open the generated page and inspect these requests:

1. The page loads `__smgen-assistant/loader.js`.
2. The loader fetches `__smgen-assistant/config.json`.
3. A compatible device shows the lotus launcher.
4. Opening the launcher loads `frame.html`, `assistant.css`, `frame.js`, and
   `corpus.json`.
5. Asking the first question starts the WebLLM runtime and model download.

The missing launcher can be correct behavior. The loader leaves it hidden when
WebGPU is unavailable or no configured model meets the adapter requirements.
See [Browser Runtime](browser-runtime.html) for compatibility checks.
