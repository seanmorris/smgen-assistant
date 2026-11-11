# Assistant evaluation questions

## Experimental retrieval comparison

Build the experimental branch and run the Node comparison against this
repository's own documentation:

```sh
npm ci
npm run build:experiment
npm run eval:retrieval -- --output /tmp/smgen-retrieval-node.json
node eval/summarize.mjs /tmp/smgen-retrieval-node.json
```

`assistant-questions.yaml` includes the paraphrase failures from the initial
investigation, additional topic and identifier controls, unrelated questions,
and a follow-up sequence. The original `questions.yaml` targets SMGen core
documentation and should be used only with that corpus. This small matrix is a
development check, not a held-out quality benchmark. Add other sites and unseen
questions before making adoption decisions.

The initial Linux run on 2026-11-05 used Node 22.23.2 and headless Chromium 152.
Both runtimes retrieved the expected section for 8/20 answerable cases with
lexical search, 15/20 with semantic search, and 14/20 with hybrid search. All
three modes returned no sources for the three unrelated questions. The CDP
run completed 69 cases without errors and without WebGPU. Small score differences
between native CPU and browser WASM inference can change secondary candidates
near the similarity threshold. These results do not measure generated answer
quality or performance on the Mac.

The Mac run on 2026-11-11 used Chrome 150, a 32 GB `MacIntel` device, and an
Apple Metal 3 WebGPU adapter. Its 69-case retrieval-only run matched the Linux
coverage exactly: lexical retrieved every expected section for 8/20 answerable
cases, semantic for 15/20, and hybrid for 14/20; all three rejected the three
unrelated questions. Median warm search took 1 ms, 9 ms, and 10 ms respectively.
The first semantic query took 1.608 seconds; hybrid initialization took 446 ms
after the embedding assets entered Chrome's HTTP cache.

The complete Mac run used `Qwen2.5-1.5B-Instruct-q4f32_1-MLC` for all three
modes and completed 69 cases without errors. Six generated answers per mode
passed grounding unchanged. The other generated answers used the extractive
fallback when validation rejected unsupported or incomplete content. Median
warm generation took 1.724 seconds with lexical retrieval, 1.433 seconds with
semantic retrieval, and 1.244 seconds with hybrid retrieval. On this matrix,
semantic retrieval improved source coverage substantially, hybrid fusion did
not improve on semantic retrieval, and the small chat model remained the main
limit on generated-answer acceptance.

A follow-up tuning run kept the `0.20` query relevance gate, admitted secondary
semantic candidates down to `0.18`, lowered the reciprocal-rank constant from
`60` to `5`, and raised the experimental site's passage limit from two to four.
Expected-source coverage rose from 70% to 90% for hybrid retrieval while all
three unrelated questions still returned no sources. The complete 23-case run
had no errors and kept generated-answer acceptance at 30%; median warm search
was 21 ms and median warm generation was 1.822 seconds. Six passages did not
recover another expected source. These values are promising defaults for this
corpus, not a general calibration; validate them on additional sites and unseen
questions before exposing them as stable configuration.

The next Mac run tightened the answer prompt around source wording and taught
coverage validation to recognize common reader/documentation terms without
accepting unsupported technical literals. Qwen2.5 1.5B accepted 11/20 generated
answers (55%) with a 2.020-second median warm generation time. Qwen3.5 9B
accepted 19/20 (95%) with a 4.342-second median; its only rejected answer joined
two technical literals that no supplied passage supported together. Both models
retained 90% expected-source coverage, rejected all three unrelated questions,
and completed without errors. The experimental configuration now recommends the
9B model on compatible devices while retaining 1.5B as the smaller option.

The Node run caches query vectors across modes to compare identical inputs;
use browser runs for timing and download measurements. Reports include errors
in retrieval denominators and distinguish retrieved passages from passages
that survive exact prompt fitting. Generated-answer acceptance measures the
existing validator, not independently verified correctness. Review required
facts and unsupported claims separately.

Serve the generated files, then make this server reachable from the Mac:

```sh
python3 -m http.server 9000 --bind 0.0.0.0 --directory docs
```

`--cdp` is the Mac Chrome debugging endpoint as seen from the machine running
the evaluator. `--url` is the assistant URL as seen from Chrome on the Mac.
Use HTTPS or forward the site server to the Mac's localhost; a plain LAN HTTP
address does not provide the secure context required by local search/WebGPU.
Use a dedicated Chrome profile with remote debugging enabled. Set the URLs
below to the actual network endpoints:

```sh
export SMGEN_CDP_URL=http://mac-host:9223
export SMGEN_EVAL_URL=http://localhost:9000/__smgen-assistant/frame.html

# Verify the connection, asset version, secure context, and device first.
npm run eval -- --cdp "$SMGEN_CDP_URL" --url "$SMGEN_EVAL_URL" \
  --probe-only true --output /tmp/smgen-mac-device.json

# Compare browser retrieval without loading a chat model or requiring WebGPU.
npm run eval -- --cdp "$SMGEN_CDP_URL" --url "$SMGEN_EVAL_URL" \
  --retrieval-only true --retrieval-modes lexical,semantic,hybrid \
  --questions eval/assistant-questions.yaml --variants all --sequences true \
  --output /tmp/smgen-mac-retrieval.json
node eval/summarize.mjs /tmp/smgen-mac-retrieval.json

# Then compare complete answers with the same model in every retrieval mode.
npm run eval -- --cdp "$SMGEN_CDP_URL" --url "$SMGEN_EVAL_URL" \
  --models Qwen2.5-1.5B-Instruct-q4f32_1-MLC \
  --retrieval-modes lexical,semantic,hybrid --keep-model-cache true \
  --questions eval/assistant-questions.yaml --variants all --sequences true \
  --output /tmp/smgen-mac-answers.json
node eval/summarize.mjs /tmp/smgen-mac-answers.json
```

Each mode runs in a separate page/worker. Model artifacts remain cached between
modes. `--keep-model-cache true` also retains them after the comparison, avoiding
repeat downloads on the Mac. Retrieval-only runs never delete model caches.
The first semantic request in each worker includes model initialization; later
requests report warm search time. Browser HTTP/model caches can affect cold
timings, so record the cache state alongside a run. Source and model loading
remain lazy: lexical mode does not fetch the embedding model or semantic index.

For manual comparison, open `frame.html?evaluation=1&retrieval=lexical`,
`&retrieval=semantic`, or `&retrieval=hybrid`. These URL overrides only apply
when `evaluation=1`; normal visitors use the site's configuration.

## Original model evaluation

[`questions.yaml`](questions.yaml) groups documentation questions by user role.
Each scenario contains three independent phrasings, the source sections that
should support the answer, and the facts that a useful answer should preserve.

Run each standalone variant in a new conversation. Asking all three phrasings
in one conversation changes retrieval by adding follow-up context and makes the
results harder to compare. Run each `conversationSequences` case in one
conversation because those cases intentionally test follow-up handling.

For a reproducible browser run, build the assistant with every candidate in its
`models` list, open Chrome with remote debugging, and run:

```sh
npm run eval -- \
  --models model-a,model-b \
  --scenarios create-first-site,select-menu-pages,deploy-github-pages \
  --variants first \
  --sequences false \
  --clear-http-cache true \
  --output /tmp/smgen-assistant-eval.json

node eval/summarize.mjs /tmp/smgen-assistant-eval.json
```

Inspect a device before downloading a model:

```sh
npm run eval -- \
  --probe-only true \
  --cdp http://device-address:9223 \
  --url http://localhost:9000/__smgen-assistant/frame.html?evaluation=1 \
  --output /tmp/smgen-assistant-device.json
```

The report records the adapter identity exposed by the browser, WebGPU features,
relevant limits, compatibility for every configured model, and the recommended
model ID. Adapter identity may be empty because browsers can withhold it. The
probe does not load WebLLM or download a model. WebGPU does not expose free GPU
memory, so a compatible result still needs a real load and answer test.

The runner opens `frame.html?evaluation=1`. Only that explicit mode reports the
retrieved and fitted sources, raw generation, validation result, displayed
answer, token usage, and timing to the same-origin test page. Ordinary embedded
frames do not emit question or answer telemetry.

Each model runs in a separate page and dedicated worker. After its cases finish,
the runner closes that page, removes the model weights, tokenizer, configuration,
and WebAssembly artifact from IndexedDB, and verifies that no matching records
remain before opening the next model. This keeps both GPU memory and disk use to
one evaluated model at a time.

Use `--clear-http-cache true` only with a disposable browser profile. Model
downloads also pass through Chromium's ordinary HTTP cache, so this option
clears that profile-wide cache after every candidate. Start the browser with a
separate `--user-data-dir`; never point a cache-clearing run at your daily
browser profile.

For every answer, record:

- whether at least one listed source section was retrieved
- whether every technical claim is supported by a cited passage
- whether all `requiredFacts` are present and accurate
- whether source links open the relevant heading fragment
- whether the answer directly addresses the question without repeated filler
- time to first visible text and total response time, for observation only

Score the answer from 0 to 2 in each of these categories:

| Category | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Retrieval | No relevant source | Related page, wrong section | Expected section |
| Grounding | Unsupported claims | Minor unsupported detail | Every claim supported |
| Coverage | Misses the goal | Partly answers | Covers the required facts |
| Clarity | Confusing or repetitive | Understandable | Direct and concise |
| Navigation | Missing or wrong links | Correct page | Correct heading fragment |

Any invented command, setting, file, or deployment step is a grounding failure,
even when the rest of the answer sounds plausible. An extractive fallback may
still score well when it answers the question. Record it separately so fallback
frequency can be compared between builds.
