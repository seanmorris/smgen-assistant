---
title: Configuration
description: Configure assistant models, device limits, retrieval, and build paths.
weight: 2
llms: reference
menus:
  documentation:
    weight: 2
---

# Configuration

Place optional settings in `.smgen-assistant.yaml` at the project root. The
file controls the public interface, model choices, retrieval limits, corpus
chunks, and build paths.

## Complete Example

```yaml
title: Ask the manual
greeting: Ask a question about this project.
chunkCharacters: 4000

retrieval:
  maxChunks: 2
  maxCharacters: 3000

models:
  - id: Qwen3.5-9B-q4f16_1-MLC
    label: "Qwen3.5 9B: Strongest answers"
    downloadMB: 4823
    memoryMB: 6434
    minDeviceMemoryGB: 16
    quality: 50
  - id: Qwen3-8B-q4f16_1-MLC
    label: "Qwen3 8B: Faster answers"
    downloadMB: 4624
    memoryMB: 5696
    minDeviceMemoryGB: 16
    quality: 40
  - id: gemma-2-2b-it-q4f16_1-MLC
    label: "Gemma 2 2B: Efficient f16"
    downloadMB: 1493
    memoryMB: 1896
    quality: 30
  - id: gemma-2-2b-it-q4f32_1-MLC
    label: "Gemma 2 2B: Compatible f32"
    downloadMB: 1493
    memoryMB: 2509
    quality: 20
  - id: Qwen2.5-1.5B-Instruct-q4f32_1-MLC
    label: "Qwen2.5 1.5B: Smallest"
    downloadMB: 880
    memoryMB: 1889
    quality: 10
```

## Interface Text

- `title`: heading shown in the assistant panel. Default: `Ask this site`.
- `greeting`: first assistant message. Default: `Ask a question about this documentation.`

Keep the greeting short. The model does not generate it, and it occupies space
above the first question.

## Models

Use `models` to offer one or more choices. Each entry accepts:

- `id`: model ID from the model list bundled with WebLLM 0.2.86.
- `label`: text shown to the visitor.
- `downloadMB`: displayed download estimate in megabytes.
- `memoryMB`: displayed GPU memory estimate in megabytes.
- `quality`: author-assigned positive integer used for recommendations.
- `requiredFeatures`: WebGPU features required by the model.
- `minStorageBufferMB`: minimum storage buffer binding size in megabytes.
- `minDeviceMemoryGB`: minimum reported system memory tier in gigabytes.

The estimates inform the visitor and break recommendation ties. WebGPU does not
report free GPU memory, so `memoryMB` cannot prove that the model will fit.

The browser disables choices that fail a declared device check. A model ID
containing `q4f16` or `q0f16` also requires the `shader-f16` feature. Declare
other requirements explicitly:

```yaml
models:
  - id: example-model-q4f16_1-MLC
    label: Example model
    quality: 30
    requiredFeatures: [shader-f16]
    minStorageBufferMB: 256
    minDeviceMemoryGB: 16
```

The browser recommends the compatible model with the highest `quality` value.
Equal values prefer the lower `memoryMB`, then the lower `downloadMB`. A saved
compatible choice takes precedence. Without quality values, configuration order
determines the initial choice.

When the Device Memory API does not report a tier, the browser prefers a
compatible model without `minDeviceMemoryGB`. Models with a memory floor remain
selectable because the browser lacks evidence to reject them.

Use `model` instead of `models` for one choice:

```yaml
model:
  id: Qwen2.5-1.5B-Instruct-q4f32_1-MLC
  label: Qwen2.5 1.5B
  downloadMB: 880
  memoryMB: 1889
```

Do not define `model` and `models` in the same file.

## Retrieval

- `retrieval.maxChunks`: maximum source chunks selected for one question.
  Default: `2`.
- `retrieval.maxCharacters`: maximum formatted source characters selected for
  one question. Default: `3000`.
- `chunkCharacters`: target maximum size of one corpus chunk. Default: `4000`.

The browser ranks chunks by exact phrases, headings, technical identifiers,
body terms, term rarity, and the current page. It trims long passages around
query terms before it builds the prompt.

The model uses a 2,048-token context and reserves 384 tokens for the answer.
The loaded tokenizer measures the complete prompt. Prompt fitting removes old
question context, lower-ranked sources, and excess source text in that order.
An oversized question receives an inline validation message.

## Build Paths

The YAML file can set the three command paths:

```yaml
pages: ./pages
output: ./docs
baseUrl: /manual
```

- `pages`: Markdown source directory. Default: `./pages`.
- `output`: generated site directory. Default: `./docs`.
- `baseUrl`: public path prefix. Default: `BASE_URL`, then empty.

Command flags override YAML values. The build rejects symbolic output
boundaries and overlapping pages and output directories.

## Change Models

Changing the selection releases the active engine. The next question downloads
or opens the new model. The browser stores the choice for that assistant URL,
and WebLLM caches each downloaded model separately.

Choose models on the devices that will use the site. The
[Development](development.html) page describes the device probe and evaluation
runner.
