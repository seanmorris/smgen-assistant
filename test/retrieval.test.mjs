// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { formatContext, retrieveChunks, tokenize } from "../src/shared/retrieval.mjs";

const chunks = [
  { id: "1", sourceId: "a", title: "Install", heading: "Install package", url: "/install.html", content: "Run npm install sample." },
  { id: "2", sourceId: "b", title: "PHP API", heading: "PhpCgiNode", url: "/api.html", content: "Call php.request() with a document root." },
  { id: "3", sourceId: "c", title: "Other", heading: "Overview", url: "/other.html", content: "General background material." }
];

test("tokenizer preserves technical identifiers", () => {
  assert.deepEqual(tokenize("PhpCgiNode php.request() foo-bar"), ["phpcginode", "php.request", "foo-bar"]);
});

test("retrieval boosts identifiers and the current page", () => {
  const selected = retrieveChunks(chunks, "How do I call php.request?", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "https://example.test/api.html"
  });
  assert.equal(selected[0]?.id, "2");
  assert.equal(selected.length, 1);
  assert.match(formatContext(selected), /\[Source 1\][\s\S]*\/api\.html/u);
});

test("retrieval enforces the character and result budgets", () => {
  const maxCharacters = 90;
  const selected = retrieveChunks(chunks, "package general", { maxChunks: 1, maxCharacters });
  assert.equal(selected.length, 1);
  assert.ok(formatContext(selected).length <= maxCharacters);
  assert.match(selected[0]?.content ?? "", /…$/u);
});

test("retrieval does not return an unrelated current page", () => {
  const selected = retrieveChunks(chunks, "xyzzynotfound", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "https://example.test/api.html"
  });
  assert.deepEqual(selected, []);
});

test("retrieval favors build instructions and varied source pages", () => {
  const pages = [
    { id: "start", sourceId: "start", title: "Getting Started", heading: "Create a Site", url: "/index.html#create-a-site", content: "Build a site by running ./smgen.sh build after writing Markdown pages." },
    { id: "deploy", sourceId: "deploy", title: "Deployment", heading: "GitHub Pages", url: "/deployment.html#github-pages", content: "Build and publish the generated site with GitHub Actions." },
    { id: "more", sourceId: "start", title: "Getting Started", heading: "Requirements", url: "/index.html#requirements", content: "Building needs PHP and Composer." }
  ];
  const selected = retrieveChunks(pages, "Walk me through building a site with SMGen", {
    maxChunks: 3,
    maxCharacters: 1000,
    currentUrl: "/index.html"
  });
  assert.equal(selected[0]?.id, "start");
  assert.equal(new Set(selected.map((chunk) => chunk.sourceId)).size, 2);
});

test("retrieval maps website language and root URLs to create-site guidance", () => {
  const pages = [
    { id: "start", sourceId: "start", title: "Getting Started", heading: "Create a Site", url: "/index.html#create-a-site", content: "Create a site with smgen init, then build and serve it." },
    { id: "config", sourceId: "config", title: "Configuration", heading: "Precedence", url: "/configuration.html#precedence", content: "SMGen loads configuration from several files." }
  ];
  const selected = retrieveChunks(pages, "Explain how to make a website with SMGen", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "http://localhost:9000/"
  });
  assert.equal(selected[0]?.id, "start");
});

test("retrieval treats the project name as context when a specific topic is present", () => {
  const pages = [
    { id: "start", sourceId: "start", title: "Getting Started", heading: "Create a Site", url: "/index.html#create-a-site", content: "Create an SMGen site." },
    { id: "config", sourceId: "config", title: "Configuration", heading: "Precedence", url: "/configuration.html#precedence", content: "SMGen configuration settings use .smgen.yaml." }
  ];
  const selected = retrieveChunks(pages, "How do I configure SMGen?", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "http://localhost:9000/"
  });
  assert.equal(selected[0]?.id, "config");
});

test("retrieval maps a project description question to its overview", () => {
  const pages = [
    { id: "overview", sourceId: "start", title: "Getting Started", heading: "SMGen", url: "/index.html#smgen", content: "SMGen converts Markdown to HTML. Pandoc renders content and Bash coordinates configuration." },
    { id: "start", sourceId: "start", title: "Getting Started", heading: "Create a Site", url: "/index.html#create-a-site", content: "Create an SMGen site with smgen init, then build it with SMGen." }
  ];
  const selected = retrieveChunks(pages, "What does SMGen do?", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "http://localhost:9000/"
  });
  assert.equal(selected[0]?.id, "overview");
});

test("retrieval maps a novice introduction question to the overview", () => {
  const pages = [
    { id: "requirements", sourceId: "start", title: "Getting Started", heading: "Requirements", url: "/index.html#requirements", content: "A build requires Bash, PHP, yq, and Pandoc." },
    { id: "overview", sourceId: "start", title: "Getting Started", heading: "SMGen", url: "/index.html#smgen", content: "SMGen converts Markdown to HTML. Pandoc renders content and Bash coordinates configuration." }
  ];
  const selected = retrieveChunks(pages, "What is this thing, and why would I use it?", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "http://localhost:9000/navigation.html"
  });
  assert.equal(selected[0]?.id, "overview");
});

test("retrieval does not rank passages from conversational filler", () => {
  const selected = retrieveChunks([
    { id: "license", sourceId: "license", title: "License", heading: "Definitions", url: "/LICENSE.html", content: "Terms and conditions for use of the work." }
  ], "What is this thing, and why would I use it?", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "http://localhost:9000/navigation.html"
  });
  assert.deepEqual(selected, []);
});

test("retrieval routes novice page-location and menu-creation questions", () => {
  const pages = [
    { id: "writing", sourceId: "writing", title: "Writing Pages", heading: "Writing Pages", url: "/writing-pages.html#writing-pages", content: "Place source pages under PAGES_DIR, which defaults to pages/." },
    { id: "frontmatter", sourceId: "writing", title: "Writing Pages", heading: "Writing Pages > Page Frontmatter", url: "/writing-pages.html#page-frontmatter", content: "A page may begin with YAML frontmatter." },
    { id: "define", sourceId: "navigation", title: "Navigation and Plugins", heading: "Navigation and Plugins > Define Menus and Regions", url: "/navigation.html#define-menus-and-regions", content: "Templates place named menus in named regions." },
    { id: "legacy", sourceId: "navigation", title: "Navigation and Plugins", heading: "Navigation and Plugins > Legacy Navigation", url: "/navigation.html#legacy-navigation", content: "SMGen defines a built-in sidebar menu." }
  ];
  const options = { maxChunks: 2, maxCharacters: 1000, currentUrl: "http://localhost:9000/navigation.html" };
  assert.equal(retrieveChunks(pages, "Where do I put the words and pages for my site?", options)[0]?.id, "writing");
  assert.equal(retrieveChunks(pages, "Can I make a new kind of sidebar menu?", options)[0]?.id, "define");
  assert.equal(retrieveChunks(pages, "Can I make a new kind of sidebar menu?", { ...options, maxChunks: 4 }).length, 1);
});

test("retrieval routes varied project-maintenance language", () => {
  const pages = [
    { id: "start", sourceId: "start", title: "Getting Started", heading: "Create a Site", url: "/index.html#create-a-site", content: "Initialize an empty directory with smgen init, then build and serve it." },
    { id: "writing", sourceId: "writing", title: "Writing Pages", heading: "Writing Pages", url: "/writing-pages.html#writing-pages", content: "Source pages under pages/ keep their directory structure and receive an HTML extension." },
    { id: "assets", sourceId: "custom", title: "Customization", heading: "Customization > Add Styles and Scripts", url: "/customization.html#add-styles-and-scripts", content: "Put browser assets under static/ and add their published URLs to configuration." },
    { id: "public", sourceId: "deploy", title: "Deployment", heading: "Deployment > Set the Public URL", url: "/deployment.html#set-the-public-url", content: "Set BASE_URL to the site's public root before a production build." },
    { id: "precedence", sourceId: "config", title: "Configuration", heading: "Configuration > Precedence", url: "/configuration.html#precedence", content: "Calling-process values override project YAML settings." },
    { id: "legacy", sourceId: "navigation", title: "Navigation", heading: "Navigation > Legacy Navigation", url: "/navigation.html#legacy-navigation", content: "Pages without menus continue to use leftBarLink." },
    { id: "license", sourceId: "license", title: "License", heading: "Definitions", url: "/LICENSE.html#definitions", content: "The work is provided under this license. You have the right to use it." }
  ];
  /** @param {string} question */
  const first = (question) => retrieveChunks(pages, question, { maxChunks: 4, maxCharacters: 3000 })[0]?.id;
  assert.equal(first("What commands and files do I need to go from nothing to a local SMGen page?"), "start");
  assert.equal(first("If I create pages/guides/install.md, where does SMGen publish it?"), "writing");
  assert.equal(first("What is the right way to add my own CSS and JavaScript?"), "assets");
  assert.equal(first("My site will live under a subdirectory. How do I keep generated links working?"), "public");
  assert.equal(first("What should BASE_URL contain for a production build?"), "public");
  assert.equal(first("Where should I put a local override that beats the project YAML?"), "precedence");
  assert.equal(first("Will leftBarLink still work if I start adding named menus?"), "legacy");
});
