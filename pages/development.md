---
title: Development
description: Run checks, evaluate models, and inspect a release archive.
weight: 5
llms: reference
menus:
  documentation:
    weight: 5
---

# Development

The repository keeps authored modules under `src/` and writes compiled package
assets under `dist/`. Do not edit generated files by hand.

## Install and Check

Install the locked dependencies:

```bash
npm ci
```

Run the complete package check:

```bash
npm run check
```

The check runs ESLint, strict JSDoc type checking, a production build, and the
Node test suite. Browser tests use mocked host APIs and do not download a model.

The project does not run Lighthouse or synthetic performance checks. Regression
tests verify deferred loading, generated output, retrieval, prompt fitting,
grounding, model selection, launcher states, and browser isolation.

## Build the Package

Compile command-line and browser assets:

```bash
npm run build
```

The build produces:

- `dist/cli/index.mjs`: bundled Node.js command
- `dist/browser/loader.js`: small host-page loader
- `dist/browser/frame.html` and `frame.js`: assistant interface
- `dist/browser/engine-worker.js`: WebLLM worker entry
- `dist/browser/chunks/`: shared runtime chunks
- `dist/browser/assistant.css`: frame styles
- `dist/browser/logo.svg`: footer project mark
- `dist/browser/lotus.svg`: attributed launcher source

## Build This Documentation Site

The site source lives under `pages/`. Keep a current SMGen checkout beside this
repository, then build and watch the site:

```bash
npm run dev
```

Open <http://localhost:8100>. The command selects `../smgen/smgen.sh` before a
system installation so an older global command cannot render the templates.
Set `SMGEN_BIN` when the checkout lives elsewhere.

Use `npm run site` for a single build. Both commands compile the package, then
invoke SMGen. SMGen calls `after-smgen.sh`, which builds the assistant from the
rendered pages and places it under `docs/__smgen-assistant/`.

## Evaluate Models

[`eval/questions.yaml`](https://github.com/seanmorris/smgen-assistant/blob/master/eval/questions.yaml)
contains role-based questions, alternate phrasings, expected source sections,
required facts, and multi-turn cases.

Probe a browser without downloading a model:

```bash
npm run eval -- \
  --probe-only true \
  --cdp http://device-address:9223 \
  --url http://localhost:8100/__smgen-assistant/frame.html?evaluation=1 \
  --output /tmp/smgen-assistant-device.json
```

Run selected questions against several configured models:

```bash
npm run eval -- \
  --models model-a,model-b \
  --scenarios create-first-site,select-menu-pages,deploy-github-pages \
  --variants first \
  --sequences false \
  --output /tmp/smgen-assistant-eval.json

node eval/summarize.mjs /tmp/smgen-assistant-eval.json
```

Each candidate runs in a separate page and worker. After its cases finish, the
runner closes the page, deletes that model's weights and runtime artifacts, and
verifies that no matching IndexedDB records remain. This limits disk and GPU
use to one evaluated model at a time.

Score retrieval, grounding, coverage, clarity, navigation, response time, and
device stability. An invented command, setting, filename, or deployment step
is a grounding failure.

## Inspect a Release

Run the checks and inspect the package archive:

```bash
npm pack --dry-run
```

The archive includes the executable, compiled assets, evaluation data, license,
and third-party notices. Confirm the shared version in `package.json` and
`src/shared/version.mjs` before tagging a release.

Commit the version, then push its matching stable tag:

```bash
VERSION="$(node -p "require('./package.json').version")"
git tag "v${VERSION}"
git push origin "v${VERSION}"
```

The `publish.yml` workflow accepts tags in the `v0.0.0` form. It rejects a tag
that differs from the package version, reruns the checks, inspects the archive,
and publishes it to npm with provenance.

Publish the first registry version interactively with two-factor
authentication. Then configure npm trusted publishing for
`seanmorris/smgen-assistant` and `publish.yml` and allow `npm publish`. Later
releases need no npm token.
