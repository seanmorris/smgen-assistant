# smgen-assistant

smgen-assistant adds a local AI documentation assistant to an [SMGen](https://github.com/seanmorris/smgen) site. It builds a static search corpus from the site's Markdown and runs [WebLLM](https://github.com/mlc-ai/web-llm) in the visitor's browser.

The initial page loads one small script. The assistant frame, corpus, WebLLM runtime, worker, and model wait until the visitor opens the assistant. The model download requires another explicit click after the interface shows its download and GPU memory estimates.

## Requirements

The build requires Node.js 20 or newer. Visitors need a browser with WebGPU. Model loading also requires HTTPS or localhost when the browser uses the service-worker engine.

The default model is `Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC`. Its current estimate is a 300 MB download and 1,061 MB of GPU memory. The f32 build works on WebGPU adapters without the optional `shader-f16` feature. The package pins the WebLLM 0.2.79 runtime and `v0_2_48` model library used by the WebLLM Chat example. WebLLM stores model artifacts in IndexedDB to avoid Cache API failures on redirected model shards.

The browser loads a 2,048-token context and limits answers to 384 tokens. The default retrieval and conversation budgets keep the longer documentation prompt from monopolizing the GPU.

## Install

Add the package to the site project:

```sh
npm install --save-dev smgen-assistant
```

Build the assistant after SMGen has generated the site:

```sh
npx smgen-assistant build \
  --pages ./pages \
  --output ./docs \
  --base-url "${BASE_URL:-}"
```

The command writes only `docs/__smgen-assistant/`. It stages the complete directory before replacing the prior version. A failed build retains the previous assistant directory.

## SMGen setup

Add the loader to `.smgen.yaml`:

```yaml
BODY_SCRIPTS:
  - /__smgen-assistant/loader.js
```

SMGen applies `BASE_URL` to that path when it renders each page. Add `after-smgen.sh` to generate the assistant beside those pages:

```bash
#!/usr/bin/env bash
set -euo pipefail

npx --no-install smgen-assistant build \
  --pages "${PAGES_DIR}" \
  --output "${OUTPUT_DIR}" \
  --base-url "${BASE_URL}"
```

SMGen restores its prior output when `after-smgen.sh` fails. `smgen watch` also watches the hook and runs it after each rebuild.

## Content selection

The builder includes every `.md` file under `PAGES_DIR` by default. Set `assistant: false` in page frontmatter to exclude one page:

```yaml
---
title: Internal release notes
assistant: false
---
```

The same field works in `.fm.yaml` and follows SMGen's directory inheritance. Metadata from the page overrides inherited metadata. A child directory or page can set `assistant: true` after an ancestor excludes content.

The builder uses `title`, then `pagetitle`, then the first level-one heading as the source title. It maps `guide/install.md` to `guide/install.html`. Set `assistantUrl` when the published URL differs:

```yaml
---
title: Install
assistantUrl: /handbook/install.html
---
```

`url` also works as a fallback override. `assistantUrl` takes precedence when both fields exist.

## Configuration

Place optional settings in `.smgen-assistant.yaml`:

```yaml
title: Ask the manual
greeting: Ask a question about this project.
chunkCharacters: 4000

model:
  id: Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC
  label: Qwen2.5 Coder 0.5B
  downloadMB: 300
  memoryMB: 1061

retrieval:
  maxChunks: 4
  maxCharacters: 3000
```

The model ID must exist in the model list included with WebLLM 0.2.79. Models with `f16` in their quantization name require a WebGPU adapter with `shader-f16`. The assistant checks WebLLM's required adapter limits before loading a model. WebGPU does not report available VRAM, so choose a model with a conservative `memoryMB` estimate. The size fields inform the visitor before download; they do not constrain WebLLM.

The configuration file can also supply `pages`, `output`, and `baseUrl`. Command flags override file settings. `BASE_URL` from the environment applies when neither the flag nor the file sets it.

```text
smgen-assistant build [options]

--pages <directory>   Markdown source directory (default: ./pages)
--output <directory>  Generated site directory (default: ./docs)
--base-url <path>     Site path prefix, such as /docs
--config <file>       YAML configuration file
```

## How retrieval works

The builder strips YAML frontmatter and splits Markdown at headings. It keeps fenced code blocks intact. Each chunk records a stable source ID, title, heading, and public URL.

The browser ranks chunks with exact phrase, title, heading, technical identifier, body, and current-page matches. Each prompt receives at most `retrieval.maxChunks` chunks and `retrieval.maxCharacters` characters. Source links come from the corpus and render separately from model-generated citation markers.

The browser loads the full corpus when the visitor opens the assistant. A few megabytes of source Markdown fits this design. A corpus measured in tens of megabytes should use a partitioned index so the browser can fetch candidates on demand.

## Loading and browser isolation

`loader.js` derives its asset path from its own script URL, so root and nested `BASE_URL` deployments use the same output. It creates the iframe only after activation. An open assistant returns after an ordinary static page navigation through tab-scoped state.

The frame registers `service-worker.js` with the `__smgen-assistant/` scope. That scope keeps it separate from a root service worker such as php-wasm's request handler. If the service-worker engine cannot start, the frame retries with a dedicated worker.

The service worker can be terminated by the browser. WebLLM checks the requested model when a new client reconnects and reloads it from browser storage when required.

## Privacy and output safety

Questions, retrieved documentation, and generated answers stay in the browser. WebLLM downloads model artifacts from the locations in its model configuration. smgen-assistant does not send questions to an application server.

Assistant output supports headings, paragraphs, lists, block quotes, emphasis, code, and links. The renderer creates DOM nodes directly. It treats raw HTML as text and rejects executable URL schemes. The assistant has no tools for network browsing, code execution, or page mutation.

## Development

Install dependencies and run the required checks:

```sh
npm install
npm run check
```

`npm run check` runs ESLint, strict JSDoc type checking, a production build, and Node's test runner. Browser tests use a mocked host environment and do not download a model. The project does not run Lighthouse or synthetic performance checks.

`npm pack --dry-run` shows the release contents. The package includes compiled browser assets because a generated site must serve WebLLM without a bundler.

## License

smgen-assistant uses the Apache License 2.0. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for WebLLM and model licensing notes.
