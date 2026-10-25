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

test("retrieval focuses long passages on relevant paragraphs", () => {
  const long = {
    id: "long",
    sourceId: "guide",
    title: "Guide",
    heading: "Configure Widgets",
    url: "/guide.html#widgets",
    content: [
      "Widgets use the site configuration.",
      "Unrelated background. ".repeat(50),
      "Set `WIDGET_COLOR` to configure the widget color.",
      "More unrelated detail. ".repeat(50)
    ].join("\n\n")
  };
  const [selected] = retrieveChunks([long], "How do I configure WIDGET_COLOR?", { maxChunks: 1, maxCharacters: 2000 });
  assert.match(selected?.content ?? "", /Widgets use the site configuration/u);
  assert.match(selected?.content ?? "", /WIDGET_COLOR/u);
  assert.doesNotMatch(selected?.content ?? "", /More unrelated detail/u);
  assert.ok((selected?.content.length ?? Infinity) <= 1200);
});

test("retrieval keeps list introductions and explicitly requested asset details", () => {
  const timeline = {
    id: "timeline",
    sourceId: "navigation",
    title: "Navigation",
    heading: "Timeline Menus",
    url: "/navigation.html#timeline-menus",
    content: [
      "A timeline renders:",
      "- a linked calendar\n- expandable year and month groups",
      "Background about archive history. ".repeat(30),
      "SMGen chooses dates in this order:",
      "1. `date`\n2. `created`\n3. filesystem birth time\n4. first Git addition time\n5. filesystem modification time",
      "Timeline markup uses native `details`. It adds no JavaScript and links `archive.css` only for a populated timeline."
    ].join("\n\n")
  };
  const [selected] = retrieveChunks([timeline], "How does the calendar group years and months, which dates does it use, and which browser assets load?", {
    maxChunks: 2,
    maxCharacters: 3000
  });
  assert.match(selected?.content ?? "", /A timeline renders:\n\n- a linked calendar/u);
  assert.match(selected?.content ?? "", /chooses dates in this order:\n\n1\. `date`/u);
  assert.match(selected?.content ?? "", /no JavaScript.*`archive\.css`/u);
  assert.doesNotMatch(selected?.content ?? "", /Background about archive history/u);
});

test("retrieval keeps selector prose beside plugin YAML", () => {
  const plugins = {
    id: "plugins",
    sourceId: "navigation",
    title: "Navigation",
    heading: "Menu Plugins",
    url: "/navigation.html#menu-plugins",
    content: [
      "List plugin manifests:",
      "```yaml\nPLUGINS:\n  - plugins/guides/smgen.plugin.yaml\n```",
      "A plugin manifest can select pages:",
      "```yaml\nselectors:\n  - include: [\"guides/**/*.md\"]\n    exclude: [\"guides/drafts/**\"]\n    where:\n      audience: public\n```",
      "A selector supports:",
      "- `include`: source-relative globs.\n- `exclude`: removed globs.\n- `where`: exact frontmatter matches.\n- `defaults`: selected-page link settings.",
      "Unrelated plugin callback detail. ".repeat(40)
    ].join("\n\n")
  };
  const [selected] = retrieveChunks([plugins], "How can a plugin select pages with include, exclude, and where rules?", {
    maxChunks: 1,
    maxCharacters: 3000
  });
  assert.match(selected?.content ?? "", /A plugin manifest can select pages:\n\n```yaml/u);
  assert.match(selected?.content ?? "", /A selector supports:\n\n- `include`.*- `where`/su);
});

test("retrieval does not return an unrelated current page", () => {
  const selected = retrieveChunks(chunks, "xyzzynotfound", {
    maxChunks: 2,
    maxCharacters: 1000,
    currentUrl: "https://example.test/api.html"
  });
  assert.deepEqual(selected, []);
});

test("retrieval keeps related setup passages ahead of deployment", () => {
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
  assert.deepEqual(selected.map(({ id }) => id), ["start", "more"]);
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

test("focused maintenance questions omit lexical distractors", () => {
  const pages = [
    { id: "timeline", sourceId: "navigation", title: "Navigation", heading: "Navigation > Timeline Menus", url: "/navigation.html#timeline-menus", content: "A timeline renders a calendar with year and month groups and conditionally loads archive.css." },
    { id: "start", sourceId: "start", title: "Getting Started", heading: "Create a Site", url: "/index.html#create-a-site", content: "Create a site with a first page." },
    { id: "assets", sourceId: "custom", title: "Customization", heading: "Customization > Add Styles and Scripts", url: "/customization.html#add-styles-and-scripts", content: "Add CSS and JavaScript from static/. The watch command rebuilds changed assets." },
    { id: "license", sourceId: "license", title: "License", heading: "Definitions", url: "/LICENSE.html#definitions", content: "The right to use the work is subject to this license." },
    { id: "public", sourceId: "deploy", title: "Deployment", heading: "Deployment > Set the Public URL", url: "/deployment.html#set-the-public-url", content: "Set BASE_URL for generated links when a site uses a subdirectory." },
    { id: "links", sourceId: "navigation", title: "Navigation", heading: "Navigation > Add Explicit Links", url: "/navigation.html#add-explicit-links", content: "Add explicit navigation links to a menu." },
    { id: "precedence", sourceId: "config", title: "Configuration", heading: "Configuration > Precedence", url: "/configuration.html#precedence", content: "Calling-process shell values win over .smgen.yaml." },
    { id: "faq", sourceId: "faq", title: "FAQ", heading: "Why did a build edit my page source?", url: "/faq.html#edit", content: "A build may write a derived creation date." }
  ];
  const options = { maxChunks: 2, maxCharacters: 3000 };
  assert.deepEqual(retrieveChunks(pages, "How do I make a Blogger-style archive with years, months, and a calendar?", options).map(({ id }) => id), ["timeline"]);
  assert.deepEqual(retrieveChunks(pages, "What is the right way to add my own CSS and JavaScript?", options).map(({ id }) => id), ["assets"]);
  assert.deepEqual(retrieveChunks(pages, "My site is under a subdirectory. How do I keep generated links working?", options).map(({ id }) => id), ["public"]);
  assert.deepEqual(retrieveChunks(pages, "My shell value and .smgen.yaml disagree. Which one wins?", options).map(({ id }) => id), ["precedence"]);
});

test("compound page and feed questions retain each directly requested section", () => {
  const pages = [
    { id: "writing", sourceId: "writing", title: "Writing Pages", heading: "Writing Pages", url: "/writing-pages.html#writing-pages", content: "Put Markdown under pages/. The source path becomes an HTML URL." },
    { id: "frontmatter", sourceId: "writing", title: "Writing Pages", heading: "Writing Pages > Page Frontmatter", url: "/writing-pages.html#page-frontmatter", content: "A page title belongs in YAML frontmatter." },
    { id: "define-feeds", sourceId: "rss", title: "RSS", heading: "RSS > Define Feeds", url: "/rss.html#define-feeds", content: "Define main and releases feeds." },
    { id: "select-pages", sourceId: "rss", title: "RSS", heading: "RSS > Select Pages", url: "/rss.html#select-pages", content: "Use feeds in page frontmatter to publish an article to named feeds." },
    { id: "dates", sourceId: "rss", title: "RSS", heading: "RSS > Dates and Item Data", url: "/rss.html#dates-and-item-data", content: "RSS uses date then created and rejects a selected page without either." }
  ];
  const options = { maxChunks: 2, maxCharacters: 3000 };
  assert.deepEqual(retrieveChunks(pages, "Where do I put a new Markdown page with a title, and what URL will it get?", options).map(({ id }) => id), ["writing", "frontmatter"]);
  assert.deepEqual(new Set(retrieveChunks(pages, "Which frontmatter puts one article in both RSS feeds, which date does RSS use, and what happens without one?", options).map(({ id }) => id)), new Set(["select-pages", "dates"]));
});

test("compound questions retain passages for each requested task", () => {
  const pages = [
    { id: "define", sourceId: "navigation", title: "Navigation", heading: "Navigation > Define Menus and Regions", url: "/navigation.html#define-menus-and-regions", content: "Define a menu under MENUS and place it in MENU_REGIONS.sidebar." },
    { id: "membership", sourceId: "navigation", title: "Navigation", heading: "Navigation > Select Menus from Pages", url: "/navigation.html#select-menus-from-pages", content: "Use menus in page frontmatter to join a named menu." },
    { id: "actions", sourceId: "deployment", title: "Deployment", heading: "Deployment > GitHub Pages with Actions", url: "/deployment.html#github-pages-with-actions", content: "An Actions deployment builds the site and uploads docs/." },
    { id: "public", sourceId: "deployment", title: "Deployment", heading: "Deployment > Set the Public URL", url: "/deployment.html#set-the-public-url", content: "Set BASE_URL to the public root before a production build." }
  ];
  const options = { maxChunks: 4, maxCharacters: 3000 };
  const menuIds = retrieveChunks(pages, "How do I add a second sidebar menu and choose which pages belong to it?", options).map(({ id }) => id);
  assert.ok(menuIds.includes("define"));
  assert.ok(menuIds.includes("membership"));
  const deploymentIds = retrieveChunks(pages, "My site will live under a subdirectory on GitHub Pages. What should the build and deployment do?", options).map(({ id }) => id);
  assert.ok(deploymentIds.includes("actions"));
  assert.ok(deploymentIds.includes("public"));
});
