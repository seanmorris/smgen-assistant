# Assistant evaluation questions

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
