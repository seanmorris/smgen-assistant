// @ts-check

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";
import { handleAssistantWorkerMessage } from "./prompt-tokens.mjs";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event) => handleAssistantWorkerMessage({
  engine: handler.engine,
  handleTask: handler.handleTask.bind(handler),
  reloadIfUnmatched: handler.reloadIfUnmatched.bind(handler),
  onmessage: handler.onmessage.bind(handler)
}, event);
