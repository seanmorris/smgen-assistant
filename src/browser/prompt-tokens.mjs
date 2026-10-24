// @ts-check

/**
 * Count the exact tokens WebLLM will prefill for a chat request.
 *
 * The pinned WebLLM release does not expose token counting on its public
 * worker API. This function reads the already loaded pipeline and tokenizer,
 * so counting does not download or initialize a second tokenizer.
 *
 * @param {unknown} runtime
 * @param {Array<{role: "system" | "user" | "assistant", content: string}>} messages
 * @returns {number}
 */
export function countRuntimePromptTokens(runtime, messages) {
  const engine = /** @type {{loadedModelIdToPipeline?: Map<string, unknown>}} */ (runtime);
  const pipeline = /** @type {{
   *   tokenizer: {encode: (value: string) => ArrayLike<number>},
   *   getConversationObject: () => {
   *     constructor: new (config: unknown) => {
   *       config: {system_prefix_token_ids?: number[]},
   *       override_system_message?: string,
   *       appendMessage: (role: string, content: string) => void,
   *       appendReplyHeader: (role: string) => void,
   *       getPromptArray: () => Array<string | unknown[]>
   *     },
   *     config: unknown
   *   }
   * } | undefined} */ ([...(engine.loadedModelIdToPipeline?.values() ?? [])][0]);
  if (!pipeline) throw new Error("The model tokenizer is not loaded.");
  const current = pipeline.getConversationObject();
  const Conversation = current.constructor;
  const conversation = new Conversation(current.config);
  for (const message of messages) {
    if (message.role === "system") {
      conversation.override_system_message = message.content;
    } else {
      conversation.appendMessage(message.role, message.content);
    }
  }
  conversation.appendReplyHeader("assistant");
  let tokens = conversation.config.system_prefix_token_ids?.length ?? 0;
  for (const prompt of conversation.getPromptArray()) {
    if (typeof prompt !== "string") throw new Error("Image prompts are not supported.");
    tokens += pipeline.tokenizer.encode(prompt).length;
  }
  return tokens;
}

/**
 * Handle the assistant token-count request before WebLLM sees it.
 *
 * @param {{
 *   engine: unknown,
 *   handleTask: (uuid: string, task: () => Promise<number>) => Promise<void>,
 *   reloadIfUnmatched?: (modelId: string[], chatOpts?: unknown[]) => Promise<void>,
 *   onmessage: (event: unknown, onComplete?: (value: unknown) => void, onError?: () => void) => void
 * }} handler
 * @param {unknown} event
 * @param {(value: unknown) => void} [onComplete]
 * @param {() => void} [onError]
 */
export function handleAssistantWorkerMessage(handler, event, onComplete, onError) {
  const data = /** @type {{kind?: string, uuid?: string, content?: {requestName?: string, requestMessage?: string}}} */ (
    /** @type {{data?: unknown}} */ (event)?.data ?? event
  );
  if (data.kind !== "customRequest" || data.content?.requestName !== "smgen-assistant:count-prompt" || !data.uuid) {
    handler.onmessage(event, onComplete, onError);
    return;
  }
  void handler.handleTask(data.uuid, async () => {
    const parsed = JSON.parse(data.content?.requestMessage ?? "{}");
    if (!parsed || !Array.isArray(parsed.messages) || !Array.isArray(parsed.modelId)) {
      throw new Error("The prompt request is invalid.");
    }
    await handler.reloadIfUnmatched?.(parsed.modelId, Array.isArray(parsed.chatOpts) ? parsed.chatOpts : undefined);
    const rawMessages = /** @type {unknown[]} */ (parsed.messages);
    const messages = rawMessages.map((item) => {
      const candidate = /** @type {{role?: unknown, content?: unknown} | null} */ (item);
      if (!candidate || typeof candidate.role !== "string" || !["system", "user", "assistant"].includes(candidate.role) || typeof candidate.content !== "string") {
        throw new Error("The prompt messages are invalid.");
      }
      return /** @type {{role: "system" | "user" | "assistant", content: string}} */ (candidate);
    });
    const count = countRuntimePromptTokens(handler.engine, messages);
    onComplete?.(count);
    return count;
  });
}
