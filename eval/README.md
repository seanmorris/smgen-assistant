# Assistant evaluation questions

[`questions.yaml`](questions.yaml) groups documentation questions by user role.
Each scenario contains three independent phrasings, the source sections that
should support the answer, and the facts that a useful answer should preserve.

Run each standalone variant in a new conversation. Asking all three phrasings
in one conversation changes retrieval by adding follow-up context and makes the
results harder to compare. Run each `conversationSequences` case in one
conversation because those cases intentionally test follow-up handling.

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
