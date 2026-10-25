# SMGen Assistant Site Outline

I. Home
   A. Identify the project
      1. State that the assistant answers questions from an SMGen site's Markdown.
      2. State that inference runs in the visitor's browser through WebLLM.
      3. Link to setup, configuration, content preparation, and browser support.
   B. Show the shortest working setup
      1. Install the package.
      2. Build the assistant corpus and browser assets.
      3. Load the generated launcher from the published site.
   C. Set expectations
      1. Explain the initial model download and browser cache.
      2. Explain that the launcher appears only when a configured model fits the device.
      3. State the privacy boundary for questions, documents, and model inference.

II. Getting Started
   A. List requirements
      1. Require Node.js 20 or newer.
      2. Require an SMGen site with Markdown under its pages directory.
      3. Require a WebGPU browser for visitors who use the assistant.
   B. Install the command
      1. Show the package installation command.
      2. Explain the executable and generated output.
   C. Build the assistant
      1. Show a development build at the site root.
      2. Show a subpath build for GitHub Pages.
      3. Identify the generated loader, frame, corpus, configuration, and model worker files.
   D. Embed the launcher
      1. Add the deferred loader script to SMGen configuration.
      2. Explain the capability check before the launcher becomes visible.
      3. Explain that WebLLM remains unloaded until the visitor opens the panel.

III. Configuration
   A. Define the configuration file
      1. Show the top-level assistant settings.
      2. Explain values that affect retrieval and answer generation.
   B. Configure one or more models
      1. Define model ID, label, required features, memory floor, buffer limit, and quality rank.
      2. Explain automatic selection of the highest-ranked compatible model.
      3. Explain visitor selection when several models fit.
   C. Keep prompts within model limits
      1. Explain the tokenizer-based prompt budget.
      2. Explain question, history, and source truncation.
      3. Explain how the UI reports an oversized question.
   D. Configure site paths
      1. Set the pages input directory.
      2. Set the output directory.
      3. Set the public base URL for subpath hosting.

IV. Preparing Content
   A. Build the corpus from Markdown
      1. Explain heading-based chunks.
      2. Explain page titles, section titles, URLs, and fragments.
      3. Explain which files the builder includes or skips.
   B. Improve retrieval
      1. Use descriptive headings that match reader questions.
      2. Put procedures and their prerequisites in the same section when practical.
      3. Replace ambiguous labels with terms readers will search for.
      4. Mark passages with optional question-form comments when one topic contains different answer types.
      5. Use retrieval-only keywords for reader terms that should not enter the visible prose.
      6. Exclude passages marked for a conflicting question form while keeping unannotated topical passages eligible.
   C. Improve grounded answers
      1. Explain that source text constrains the answer.
      2. Explain linked citations to page fragments.
      3. State the limits of a small local language model.

V. Browser Runtime
   A. Describe the loading sequence
      1. Fetch the small assistant configuration.
      2. Inspect the WebGPU adapter against every configured model.
      3. Show the launcher only when one model can run.
      4. Load the frame and WebLLM after the visitor opens the assistant.
   B. Describe model downloads and storage
      1. Explain model chunk downloads and browser caching.
      2. Explain that changing models can require another download.
      3. Explain how a visitor clears cached model data.
   C. Explain launcher states
      1. Show the closed lotus bud.
      2. Open the petals with the chat panel.
      3. Pulse the petals while the model works.
   D. Troubleshoot failures
      1. Cover unavailable WebGPU adapters.
      2. Cover missing shader-f16 support.
      3. Cover memory pressure and device loss.
      4. Cover static asset paths under a deployment subpath.

VI. Development and Evaluation
   A. Work on the package
      1. Install locked dependencies.
      2. Run lint, strict JSDoc type checking, tests, and the production build.
      3. Describe the source and generated directories.
   B. Evaluate answer quality
      1. Run the role-based evaluation set.
      2. Compare correctness, grounding, completeness, latency, and device stability.
      3. Delete an unsuitable cached model before downloading another large candidate.
   C. Release the package
      1. Update the shared version fields.
      2. Inspect the package archive.
      3. Publish a tagged GitHub release and attach the archive.

VII. Privacy and Licensing
   A. Define the local data flow
      1. State where the question is processed.
      2. State how the generated corpus reaches the browser.
      3. Identify network requests needed for site assets and model downloads.
   B. Record third-party material
      1. Credit WebLLM and configured model authors under their licenses.
      2. Credit Denis Giffeler's lotus animation under CC BY 4.0.
      3. Link to the repository's third-party notices.
   C. State the project license
      1. Link to Apache License 2.0.
      2. Separate the package license from third-party licenses.

VIII. GitHub Pages Deployment
   A. Build the documentation with SMGen
      1. Check out SMGen at a pinned revision.
      2. Install SMGen and package dependencies.
      3. Build the assistant package before generating its browser bundle.
      4. Generate the static documentation into docs.
   B. Publish through GitHub Actions
      1. Obtain the repository base URL from GitHub Pages.
      2. Pass the base URL to SMGen and the assistant builder.
      3. Upload the complete docs directory as one Pages artifact.
      4. Deploy only validated pushes to master.
   C. Verify the deployment
      1. Check primary documentation pages.
      2. Check CSS, JavaScript, corpus, worker, and lotus asset responses.
      3. Confirm the launcher gate and deferred runtime in a WebGPU browser.
