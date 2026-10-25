---
title: Preparing Content
description: Select Markdown, create useful chunks, and link answers to exact sections.
weight: 3
menus:
  documentation:
    weight: 3
---

# Preparing Content

The builder turns authored Markdown into a static corpus. It removes YAML
frontmatter, splits content at headings, and keeps fenced code blocks intact.
Each chunk records its page title, section title, public URL, and source text.

## Select Pages

Every `.md` file under `PAGES_DIR` is included by default. Set `assistant: false`
in page frontmatter to exclude one page:

```yaml
---
title: Internal release notes
assistant: false
---
```

Directory `.fm.yaml` files accept the same field. The builder applies directory
metadata from the corpus root to the page directory, then applies page
frontmatter. A child directory or page can set `assistant: true` after an
ancestor excludes content.

The builder rejects symbolic links under `PAGES_DIR`. This prevents a corpus
from reading content outside the configured source tree.

## Set Titles and URLs

The source title comes from the first available value:

1. `title` frontmatter
2. `pagetitle` frontmatter
3. the first level-one heading
4. the source filename

The default URL changes the `.md` extension to `.html`. For example,
`guide/install.md` becomes `guide/install.html` under `baseUrl`.

Set `assistantUrl` when the published route differs:

```yaml
---
title: Install
assistantUrl: /handbook/install.html
---
```

The older `url` field works as a fallback. `assistantUrl` takes precedence when
both fields exist.

## Link Exact Sections

Run the assistant after SMGen renders the HTML. The builder reads generated
heading IDs and matches them to the Markdown headings. Source links can then
open the exact documented section:

```text
/handbook/install.html#build-the-site
```

An explicit fragment in `assistantUrl` remains unchanged. Without rendered
HTML, page links still work but generated heading fragments are unavailable.

## Write for Retrieval

Use a heading that names the task or setting described below it. Keep a
procedure's prerequisites, command, and result in the same section when the
section remains readable.

Prefer specific headings:

- `Set the GitHub Pages Base URL`
- `Exclude a Page from the Corpus`
- `Require shader-f16`

Broad headings such as `Details` or `Other` provide few terms for retrieval.
Repeat the full setting or command name in the prose when a reader may search
for it directly.

Long sections can exceed `chunkCharacters`. The chunker keeps fenced code
blocks intact and carries the section heading into each resulting chunk. Use
smaller sections when one heading covers several unrelated tasks.

## Grounded Answers

The prompt tells the model to use only selected passages, preserve commands and
configuration values, and cite its claims. The browser checks the completed
answer against those passages. It rejects unsupported technical literals,
missing citations, repeated output, incomplete answers, and output cut off at
the token limit.

When validation rejects the generation, the assistant selects relevant source
lines and code examples for an extractive answer. The folded source panel keeps
the complete retrieved passages available.

A small local model can still misunderstand a vague question or select an
adjacent section. Test common reader questions with the evaluation matrix and
rewrite unclear headings before increasing corpus or prompt limits.
