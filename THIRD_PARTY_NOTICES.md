# Third-party notices

smgen-assistant bundles [WebLLM](https://github.com/mlc-ai/web-llm), which is licensed under Apache License 2.0.

The experimental semantic search worker bundles parts of
[LangChain.js](https://github.com/langchain-ai/langchainjs) under the MIT license,
[Transformers.js](https://github.com/huggingface/transformers.js) under Apache
License 2.0, and [ONNX Runtime](https://github.com/microsoft/onnxruntime) under
the MIT license. ONNX's JavaScript loader and WebAssembly binary are served as
static assistant assets. Their license notices are retained with the build.

Semantic search downloads the pinned quantized
[Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
embedding model. Its model card provides its attribution and license.

WebLLM packages model runtime code. Model weights retain the license published by each model author. The default Qwen2.5 model uses the Apache License 2.0. Site operators can select another compatible model and must review its license before distribution.

The configuration example also lists Gemma 2. Gemma is provided under and subject to the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).

The launcher uses [Lotus flower animation.svg](https://commons.wikimedia.org/wiki/File:Lotus_flower_animation.svg) by Denis Giffeler, Wikimedia Commons user Giffeler. The artwork is licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). smgen-assistant removes the original autonomous SMIL timing, applies monochrome styling, and controls the petal animation from the launcher state. The copied SVG contains the attribution, source, license, and modification notice in its XML metadata.
