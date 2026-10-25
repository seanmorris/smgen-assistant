---
title: Browser Runtime
description: Understand assistant loading, model storage, WebGPU checks, and failures.
weight: 4
menus:
  documentation:
    weight: 4
---

# Browser Runtime

The initial page loads one small script. The loader checks the browser before it
adds the launcher, and it defers the larger runtime until the visitor opens the
panel.

## Loading Sequence

The browser performs these steps in order:

1. Load `loader.js` from the generated assistant directory.
2. Fetch `config.json`.
3. Request a WebGPU adapter.
4. Compare every configured model with the adapter features, buffer limits, and
   reported system memory.
5. Add the lotus launcher when at least one model is compatible.
6. Create the assistant iframe after the visitor opens the launcher.
7. Load the corpus, frame script, and WebLLM runtime inside the iframe.
8. Start the model download after the first question.

An unsupported device does not receive an inactive button. The loader remains
hidden and does not create the iframe.

## Model Downloads

The consent area shows the configured download and memory estimates. WebLLM
downloads model artifacts in chunks and stores them in IndexedDB. Later visits
reuse those records when the browser retains site data.

Changing models releases the active engine. The new model starts when the
visitor submits another question. Separate model choices use separate cached
artifacts.

Use the browser's site-data controls to remove cached model files. Clearing site
data also removes the saved model choice, panel size, and conversation state.

## WebGPU Compatibility

WebGPU is available only in a secure browser context. A browser normally treats
`http://localhost` as trustworthy for local development. Publish remote sites
over HTTPS.

The loader checks requirements declared in `.smgen-assistant.yaml`. Model IDs
that contain `q4f16` or `q0f16` require `shader-f16`. An f32 model can run on an
adapter that lacks that optional feature, provided its other limits fit.

WebGPU reports adapter limits but does not report free GPU memory. The Device
Memory API, when available, reports a coarse system-memory tier rather than
available memory. A compatibility result prevents known failures but cannot
guarantee a successful model load under current memory pressure.

## Launcher and Panel

The lotus shows the assistant state:

- closed petals: panel closed
- open petals: panel open
- pulsing petals: model loading or answer generation

The launcher uses black artwork on a light host page and white artwork on a
dark host page. It follows a `light` or `dark` class on the host document, then
falls back to the browser color preference.

Visitors can resize the panel from its upper-left handle. Arrow keys work while
the handle has focus. The expand button fills the available space above the
launcher and restores the prior size. The selected size persists for the
assistant path.

## Worker Isolation

WebLLM runs in a dedicated worker. Token generation therefore does not occupy
the host page's main thread. The frame reports activity to the launcher so the
lotus can pulse while the worker is busy.

The current release removes service workers left by older assistant builds
before it starts an engine. Model artifacts remain in IndexedDB.

## Troubleshooting

### The launcher is missing

Check `loader.js` and `config.json` in the Network panel. If both return 200,
inspect `navigator.gpu` and the configured model requirements. A missing
launcher is expected when WebGPU is unavailable or every model is incompatible.

### An f16 shader fails to compile

Confirm that the adapter exposes `shader-f16`. Configure an f32 model for
devices that lack the feature. The loader detects common f16 model IDs before
WebLLM compiles their shaders.

### The GPU device is lost

Select a smaller model, close other GPU-heavy pages, and retry after the browser
creates a new adapter. Device loss during generation releases the failed engine
before the next attempt.

### Assets return 404

Build with the public `BASE_URL`. The loader derives every assistant asset from
its own script URL, so a correct loader path also fixes frame, corpus, worker,
and chunk paths.

### The question is rejected as too long

Shorten the question. The loaded tokenizer checks the complete prompt against
the model's 2,048-token context before generation. The assistant keeps 384
tokens for the answer.
