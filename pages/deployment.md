---
title: Deployment
description: Build and publish smgen-assistant documentation through GitHub Pages.
weight: 7
menus:
  documentation:
    weight: 7
---

# Deployment

smgen-assistant produces static files under the SMGen output directory. Any
static host can serve the result. The host does not need Node.js, SMGen, PHP,
Pandoc, or `yq` after the build finishes.

## Set the Public URL

Pass the site's final public root through `BASE_URL`:

```bash
BASE_URL=https://example.github.io/project smgen build
```

SMGen applies the value to page assets. `after-smgen.sh` passes the same value
to smgen-assistant, which extracts the path prefix for its generated URLs.

An empty development value publishes root-relative URLs:

```bash
BASE_URL= smgen build
```

## Deploy with GitHub Actions

This repository uses `.github/workflows/pages.yml`. The workflow:

1. checks out smgen-assistant and a pinned SMGen revision
2. installs Node.js, PHP, Pandoc, and `yq`
3. runs the package regression suite
4. obtains the repository base URL from GitHub Pages
5. builds the site and assistant bundle
6. uploads `docs/` as one Pages artifact
7. deploys validated pushes to `master`

The build step passes the URL returned by `actions/configure-pages`:

```yaml
- name: Build documentation
  env:
    BASE_URL: ${{ steps.pages.outputs.base_url }}
    SMGEN_BIN: .smgen-core/smgen.sh
  run: npm run site
```

Configure the repository's Pages source as GitHub Actions. The deployment job
needs `pages: write` and `id-token: write`; the rest of the workflow uses
read-only repository access.

## Build Atomically

SMGen renders a complete temporary output and replaces `docs/` after every page
succeeds. It then runs `after-smgen.sh`. If the assistant build fails, SMGen
restores the prior output.

smgen-assistant also stages `docs/__smgen-assistant/` before replacing its old
copy. A failed corpus or asset build cannot leave a partial assistant directory.

## Verify the Published Site

Check these URLs after deployment:

```text
https://example.github.io/project/index.html
https://example.github.io/project/default.css
https://example.github.io/project/site.css
https://example.github.io/project/__smgen-assistant/loader.js
https://example.github.io/project/__smgen-assistant/config.json
https://example.github.io/project/__smgen-assistant/corpus.json
https://example.github.io/project/__smgen-assistant/lotus.svg
```

Open the site in a WebGPU browser. Confirm that an incompatible device receives
no launcher, a compatible device loads no iframe before activation, and opening
the panel resolves every assistant asset under the repository path.

GitHub Pages serves the site over HTTPS, which satisfies the secure-context
requirement for WebGPU.
