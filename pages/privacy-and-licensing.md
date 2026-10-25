---
title: Privacy and Licensing
description: Understand local processing, published corpus data, and third-party licenses.
weight: 6
menus:
  documentation:
    weight: 6
---

# Privacy and Licensing

smgen-assistant has no application server. The published site provides static
files, and the visitor's browser performs retrieval and model inference.

## Keep Questions Private

Questions stay private because smgen-assistant performs retrieval and model
inference in the visitor's browser. It does not send questions, retrieved
passages, or generated answers to an author-operated API.

The following data remains in the browser:

- the visitor's questions
- retrieved documentation passages
- generated answers
- the saved conversation
- model and panel preferences

WebLLM downloads runtime and model artifacts from the locations in its model
configuration. The browser may retain those files in IndexedDB.

## Published Corpus

`corpus.json` is a public static asset. It contains the Markdown text selected
for the assistant, plus page titles, section titles, and URLs. Do not place
secrets or private source material under an included `PAGES_DIR`.

Set `assistant: false` on content that should remain outside the corpus. This
setting removes the page from `corpus.json`; it does not make a generated HTML
page private.

## Output Safety

Assistant answers support headings, paragraphs, lists, block quotes, emphasis,
code, and links. The renderer creates DOM nodes directly. It treats raw HTML as
text and rejects executable URL schemes.

The assistant can link to a documented page or heading. It has no tools for
network browsing, command execution, or host-page mutation.

## Project License

smgen-assistant is licensed under the
[Apache License 2.0](https://github.com/seanmorris/smgen-assistant/blob/master/LICENSE).
That license covers the project code and original documentation.

## Third-Party Software and Models

The browser bundle includes
[WebLLM](https://github.com/mlc-ai/web-llm), which uses Apache License 2.0.
Model weights retain the license published by each model author. Review a
model's terms before adding it to a public configuration.

The default Qwen2.5 model uses Apache License 2.0. Gemma 2 is subject to the
[Gemma Terms of Use](https://ai.google.dev/gemma/terms).

## Lotus Artwork

The launcher uses
[Lotus flower animation.svg](https://commons.wikimedia.org/wiki/File:Lotus_flower_animation.svg)
by Denis Giffeler, Wikimedia Commons user Giffeler. The artwork uses
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).

smgen-assistant removes the original autonomous SMIL timing, applies
monochrome styling, and controls petal movement from the launcher state. The
copied SVG records the author, source, license, and modifications in its XML
metadata.

See the repository's
[third-party notices](https://github.com/seanmorris/smgen-assistant/blob/master/THIRD_PARTY_NOTICES.md)
for the maintained attribution list.
