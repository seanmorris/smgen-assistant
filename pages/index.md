---
title: Getting Started
description: Build a private in-browser documentation assistant for an SMGen site.
weight: 0
author:
  - name: Sean Morris
menus:
  documentation:
    title: Getting Started
    weight: 0
---

# smgen-assistant

smgen-assistant adds a local documentation assistant to an SMGen site. It
builds a static search corpus from the site's Markdown and runs WebLLM in the
visitor's browser. Questions, retrieved passages, and generated answers remain
on that device.

The published site does not need an application server. It serves HTML, the
assistant bundle, the documentation corpus, and a small configuration file as
static assets.

## Requirements

The build requires Node.js 20 or newer and an existing SMGen site. Visitors
need a browser with WebGPU and enough memory for at least one configured model.

Install the package in the site project:

```bash
npm install --save-dev smgen-assistant
```

## Add the Assistant

Add the deferred loader to `.smgen.yaml`:

```yaml
BODY_SCRIPTS:
  - /__smgen-assistant/loader.js
```

Create `after-smgen.sh` so every SMGen build regenerates the corpus and browser
assets:

```bash
#!/usr/bin/env bash
set -euo pipefail

npx --no-install smgen-assistant build \
  --pages "${PAGES_DIR}" \
  --output "${OUTPUT_DIR}" \
  --base-url "${BASE_URL}"
```

Build and serve the site:

```bash
chmod +x after-smgen.sh
smgen build
smgen serve
```

Open <http://localhost:8000>. The lotus launcher appears after the small loader
confirms that one configured model fits the browser's WebGPU adapter. The
iframe, corpus, WebLLM runtime, worker, and model remain unloaded until the
visitor opens the assistant.

## First Question

The first question starts the selected model download. The interface reports
the estimated download and memory use before it starts. WebLLM stores the model
in browser storage for later visits.

The assistant retrieves the closest Markdown sections, asks the model to
rephrase those passages, validates the answer, and links each accepted claim
to its source section. A failed validation returns a relevant documented
excerpt when one is available.

## Next Steps

- [Installation](getting-started.html): build output, SMGen hooks, and local verification
- [Configuration](configuration.html): models, device requirements, retrieval, and paths
- [Preparing Content](content.html): corpus selection, section links, and retrieval guidance
- [Browser Runtime](browser-runtime.html): loading, caching, compatibility, and failures
- [Deployment](deployment.html): GitHub Pages and subpath builds
- [Development](development.html): checks, evaluation, and release work
- [Privacy and Licensing](privacy-and-licensing.html): local data flow and third-party terms
