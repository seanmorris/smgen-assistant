# smgen-assistant

smgen-assistant adds a local AI documentation assistant to an [SMGen](https://seanmorris.github.io/smgen/) site. It builds a static search corpus from the site's Markdown and runs [WebLLM](https://github.com/mlc-ai/web-llm) in the visitor's browser.

The [hosted documentation](https://seanmorris.github.io/smgen-assistant/) covers installation, configuration, content preparation, browser behavior, deployment, and development.

The initial page loads one small script. It fetches the generated configuration and checks the WebGPU adapter before showing the launcher. The assistant frame, corpus, WebLLM runtime, worker, and model wait until the visitor opens the assistant. The visitor can type immediately. The first question starts the model download and continues automatically when the model is ready.

## Requirements

The build requires Node.js 20 or newer. Visitors need a browser with WebGPU.

The default model is `Qwen2.5-1.5B-Instruct-q4f32_1-MLC`. Its current estimate is an 880 MB download and 1,889 MB of GPU memory. The f32 build works on WebGPU adapters without the optional `shader-f16` feature. The package pins WebLLM 0.2.86. WebLLM stores model artifacts in IndexedDB to avoid Cache API failures on redirected model shards.

The browser loads a 2,048-token context and reserves 384 tokens for each answer. Before generation, the model's loaded tokenizer verifies that the complete prompt uses no more than 1,664 tokens. The assistant removes old question context, lower-ranked passages, and excess text from the last passage in that order. A question that still does not fit receives an inline validation message without unloading the model.

## Install

Install the package in the site project:

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

Activate the installed package in `.smgen.yaml`:

```yaml
PLUGINS:
  - use: smgen-assistant
    options:
      config: .smgen-assistant.yaml
    watch:
      - .smgen-assistant.yaml
```

The plugin inserts the loader on selected pages and builds the corpus inside
SMGen's staged output. A failed assistant build leaves the previous site in
place. `smgen watch` monitors the manifest, package watch paths, and the project
configuration listed above.

Sites using the Bash compatibility engine can keep the earlier integration:

```bash
#!/usr/bin/env bash
set -euo pipefail

npx --no-install smgen-assistant build \
  --pages "${PAGES_DIR}" \
  --output "${OUTPUT_DIR}" \
  --base-url "${BASE_URL}"
```

Those sites also add `/__smgen-assistant/loader.js` to `BODY_SCRIPTS`. The
legacy hook remains supported through SMGen's current major release.

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

`url` also works as a fallback override. `assistantUrl` takes precedence when both fields exist. The builder reads heading IDs from generated HTML and adds them to source URLs. An explicit fragment in `assistantUrl` remains unchanged.

## Configuration

Place optional settings in `.smgen-assistant.yaml`:

```yaml
title: Ask the manual
greeting: Ask a question about this project.
chunkCharacters: 4000

models:
  - id: Qwen3.5-9B-q4f16_1-MLC
    label: Qwen3.5 9B · Strongest
    downloadMB: 4823
    memoryMB: 6434
    minDeviceMemoryGB: 16
    quality: 40
  - id: Qwen3-8B-q4f16_1-MLC
    label: Qwen3 8B · Large
    downloadMB: 4624
    memoryMB: 5696
    minDeviceMemoryGB: 16
    quality: 30
  - id: gemma-2-2b-it-q4f16_1-MLC
    label: Gemma 2 2B · f16
    downloadMB: 1493
    memoryMB: 1896
    quality: 20
  - id: gemma-2-2b-it-q4f32_1-MLC
    label: Gemma 2 2B · f32
    downloadMB: 1493
    memoryMB: 2509
    quality: 20
  - id: Qwen2.5-1.5B-Instruct-q4f32_1-MLC
    label: Qwen2.5 1.5B · Smaller
    downloadMB: 880
    memoryMB: 1889
    quality: 10

retrieval:
  maxChunks: 2
  maxCharacters: 3000
```

When `models` contains more than one entry, the visitor can select one before
asking a question. Set `quality` to an author-assigned positive integer. The
browser recommends the compatible model with the highest value. Equal values
prefer the lower `memoryMB`, then the smaller `downloadMB`. This selects the f16
Gemma build on adapters that expose `shader-f16` and the equivalent f32 build on
other adapters. Without any `quality` values, the first compatible entry keeps
the previous behavior. A compatible saved choice takes precedence over the
recommendation.

The picker disables choices whose reported device memory, WebGPU features, or
limits do not meet their declared requirements. An ID containing `q4f16` or
`q0f16` automatically requires `shader-f16`. Use `requiredFeatures` for other
WebGPU features, `minStorageBufferMB` for a larger storage buffer binding, and
`minDeviceMemoryGB` to keep a large model off smaller devices:

```yaml
  - id: example-model-q4f16_1-MLC
    label: Example model
    quality: 30
    requiredFeatures: [shader-f16]
    minStorageBufferMB: 256
    minDeviceMemoryGB: 16
```

The browser reports approximate system memory when it supports the Device
Memory API. Browsers may clamp high-memory devices to a lower tier for privacy,
so a floor above that clamp can hide a model from capable hardware. A model
above the reported tier is unavailable. When the browser does not report
memory, models with `minDeviceMemoryGB` remain selectable. The browser
recommends a compatible model without a memory tier when one is available.

Changing the choice releases the active engine and defers the new download
until the next question. The choice persists for that assistant URL, and
WebLLM caches each downloaded model separately.

Use `model` with one mapping when the site should offer only one choice. This
older form remains supported. Model IDs must exist in the model list included
with WebLLM 0.2.86. Models with `f16` in their quantization name require a
WebGPU adapter with `shader-f16`. The assistant checks WebLLM's required adapter
limits before loading a model. WebGPU does not report available VRAM, and the
Device Memory API does not report free memory. Choose conservative thresholds
for the intended devices. `memoryMB` informs the visitor and breaks equal
quality ranks. It cannot prove that enough memory is free. `downloadMB` only
informs the visitor. Omit either estimate when it is unknown.

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

Optional comment annotations can separate passages that answer different forms
of the same question:

```markdown
<!-- <what keywords="definition, purpose"> -->
Definition text.
<!-- </what> -->

<!-- <how keywords="configure, setup"> -->
Procedure text.
<!-- </how> -->
```

The builder supports `what`, `why`, `where`, `when`, `how`, and `who`. It strips
the comments from model context, stores the form on each chunk, and uses
comma-separated `keywords` only for retrieval. A matching form receives a
modest ranking boost without excluding passages marked for another form.

The browser ranks chunks with exact phrase, title, heading, technical identifier, body, term rarity, and current-page matches. It favors useful passages from more than one page, then keeps the summary and query-relevant paragraphs from long passages. Each retrieval receives at most `retrieval.maxChunks` chunks and `retrieval.maxCharacters` formatted characters. The default is two chunks so small models can distinguish the strongest passages.

The prompt asks the model to rephrase only the selected passages in one to four short bullets and preserve commands and configuration values. It tells the model to favor the highest-ranked passages and avoid inferred steps. The browser matches each bullet to its supporting passage and adds a citation that links to the exact documented section. Referential follow-up questions receive the latest earlier question as context. The assistant never sends prior model answers back to the model.

The frame holds generated text until it can check the complete answer. It validates the cited Markdown without compiling a grammar in the visitor's browser. It rejects an answer that stops at the token limit, repeats itself, omits concrete topics from the question, loses contact with the cited topic, or introduces a technical literal absent from the cited passage. Ordinary prose can use different wording. If validation fails, it ranks exact lines, adjacent lists, and relevant YAML or command examples against the question, then links the result to its documented sections. The complete excerpts remain available in a folded panel.

The browser loads the full corpus when the visitor opens the assistant. A few megabytes of source Markdown fits this design. A corpus measured in tens of megabytes should use a partitioned index so the browser can fetch candidates on demand.

## Loading and browser isolation

`loader.js` derives its asset path from its own script URL, so root and nested `BASE_URL` deployments use the same output. It shows the launcher only when the adapter can run at least one configured model. It creates the iframe only after activation. An open assistant returns after an ordinary static page navigation through tab-scoped state.

Visitors can resize the panel with its upper-left handle or the handle's arrow-key controls. The expand button fills the space above the launcher and restores the previous size. The custom size persists for the assistant path. Small screens use the available space above the launcher.

The panel and lotus launcher follow a `light` or `dark` class on the host document. If the host does not set either class, they follow the visitor's browser preference. The lotus opens with the panel and pulses while the assistant processes a question.

WebLLM runs in a dedicated worker so generation cannot block the page. A new assistant release retires service workers left by older releases before loading the model. The model files remain in browser storage between visits.

## Privacy and output safety

Questions, retrieved documentation, and generated answers stay in the browser. WebLLM downloads model artifacts from the locations in its model configuration. smgen-assistant does not send questions to an application server.

Assistant output supports headings, paragraphs, lists, block quotes, emphasis, code, and links. The renderer creates DOM nodes directly. It treats raw HTML as text and rejects executable URL schemes. Clicking a source is the only action that changes the host page. The assistant has no tools for network browsing, code execution, or page mutation.

## Development

Install dependencies and run the required checks:

```sh
npm install
npm run check
```

`npm run check` runs ESLint, strict JSDoc type checking, a production build, and Node's test runner. Browser tests use a mocked host environment and do not download a model. The project does not run Lighthouse or synthetic performance checks.

The [`eval/questions.yaml`](eval/questions.yaml) matrix provides role-based
manual questions, alternate phrasings, expected documentation sections, and a
small scoring rubric. It also includes two multi-turn cases for follow-up
context.

`npm pack --dry-run` shows the release contents. The package includes compiled browser assets because a generated site must serve WebLLM without a bundler.

### Publish a Release

Update `package.json`, `package-lock.json`, and `src/shared/version.mjs`, commit
the version, then push the matching stable tag:

```sh
VERSION="$(node -p "require('./package.json').version")"
git tag "v${VERSION}"
git push origin "v${VERSION}"
```

The `publish.yml` workflow accepts tags in the `v0.0.0` form. It rejects a tag
that differs from the package version, runs the package checks, inspects the
archive, and publishes it to npm with provenance.

Publish the first registry version interactively with two-factor
authentication. Then configure npm trusted publishing for
`seanmorris/smgen-assistant` and `publish.yml` and allow `npm publish`. Later
releases need no npm token.

## License

smgen-assistant uses the Apache License 2.0. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for WebLLM and model licensing notes.
