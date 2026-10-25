// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { sourceMatches } from "../eval/source-match.mjs";

test("evaluation source matching accepts a deployed site base path", () => {
  assert.equal(sourceMatches("/smgen/index.html#create-a-site", "/index.html#create-a-site"), true);
  assert.equal(sourceMatches("https://example.test/docs/navigation.html#menus", "/navigation.html#menus"), true);
  assert.equal(sourceMatches("/smgen/index.html#smgen", "/index.html#create-a-site"), false);
  assert.equal(sourceMatches("/smgen/other.html#create-a-site", "/index.html#create-a-site"), false);
});
