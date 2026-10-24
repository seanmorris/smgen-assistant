// @ts-check

import assert from "node:assert/strict";
import test from "node:test";
import { recentMessages } from "../src/shared/conversation.mjs";

test("recent conversation stays within count and character budgets", () => {
  const messages = [
    { content: "old" },
    { content: "a".repeat(900) },
    { content: "b".repeat(700) },
    { content: "current" }
  ];
  assert.deepEqual(recentMessages(messages, 4, 1000), messages.slice(2));
  assert.deepEqual(recentMessages(messages, 1, 1000), messages.slice(3));
});

test("recent conversation always keeps the newest message", () => {
  const messages = [{ content: "x".repeat(2000) }];
  assert.deepEqual(recentMessages(messages, 4, 1000), messages);
});
