---
title: Installation
description: Install smgen-assistant and add it to an SMGen build.
weight: 1
llms: start
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
- enough disk space for the package and generated browser bundle

Visitors need a WebGPU browser. Each configured model can add feature, buffer,
and memory requirements.

## Install the Package

Install smgen-assistant as a development dependency:

```bash
npm install --save-dev smgen-assistant
```

Confirm that the local executable is available:

```bash
npx --no-install smgen-assistant --help
```

## Activate the Plugin

Add the installed package to `PLUGINS` in `.smgen.yaml`:

```yaml
PLUGINS:
  - use: smgen-assistant
    options:
      config: .smgen-assistant.yaml
    watch:
      - .smgen-assistant.yaml
```

The plugin inserts `/__smgen-assistant/loader.js` on selected pages. SMGen
applies `BASE_URL` to that path. A project hosted at
`https://example.github.io/manual/` therefore requests
`/manual/__smgen-assistant/loader.js`.

The finalize hook builds the corpus and browser assets inside staged output. If
the assistant build fails, SMGen keeps the prior site. The `watch` entry makes
changes to `.smgen-assistant.yaml` trigger a rebuild.

Use SMGen's page selectors or `plugins: {smgen-assistant: false}` in page and
directory frontmatter when the launcher should appear on only part of a site.

## Keep a Bash Compatibility Hook

Sites that set `SMGEN_ENGINE=bash` can keep the earlier integration. Add the
loader to `BODY_SCRIPTS` and create `after-smgen.sh`:

```yaml
BODY_SCRIPTS:
  - /__smgen-assistant/loader.js
```

```bash
#!/usr/bin/env bash
set -euo pipefail

npx --no-install smgen-assistant build \
  --pages "${PAGES_DIR}" \
  --output "${OUTPUT_DIR}" \
  --base-url "${BASE_URL}"
```

Make the hook executable with `chmod +x after-smgen.sh`. SMGen restores the
prior output when the hook fails.

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
--smgen-context       Read paths from SMGen's finalize-hook context
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
    ├── logo.svg
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
