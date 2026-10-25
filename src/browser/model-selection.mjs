// @ts-check

/** @typedef {import('../shared/types.mjs').AssistantModel} AssistantModel */

const MEBIBYTE = 1024 * 1024;

/**
 * Report whether a WebLLM model name selects half-precision shaders.
 *
 * @param {string} modelId
 * @returns {boolean}
 */
export function modelNeedsShaderF16(modelId) {
  return /-q\d+f16(?:_|-|$)/iu.test(modelId);
}

/**
 * Collect explicit model requirements and the requirement encoded by an f16 model ID.
 *
 * @param {AssistantModel | string} model
 * @returns {string[]}
 */
export function modelRequiredFeatures(model) {
  const id = typeof model === "string" ? model : model.id;
  const configured = typeof model === "string" ? [] : (model.requiredFeatures ?? []);
  const features = new Set(configured);
  if (modelNeedsShaderF16(id)) features.add("shader-f16");
  return [...features];
}

/**
 * Find a WebLLM runtime requirement that the adapter cannot meet.
 *
 * @param {GPUAdapter} adapter
 * @param {AssistantModel | string} model
 * @returns {string | null}
 */
export function adapterCompatibilityIssue(adapter, model) {
  const configuredBufferMB = typeof model === "string" ? undefined : model.minStorageBufferMB;
  const checks = [
    ["maximum buffer size", adapter.limits.maxBufferSize, 256 * MEBIBYTE],
    ["maximum storage buffer binding size", adapter.limits.maxStorageBufferBindingSize,
      Math.max(128 * MEBIBYTE, (configuredBufferMB ?? 0) * MEBIBYTE)],
    ["compute workgroup storage", adapter.limits.maxComputeWorkgroupStorageSize, 32 * 1024],
    ["storage buffers per shader stage", adapter.limits.maxStorageBuffersPerShaderStage, 10]
  ];
  for (const [label, available, required] of checks) {
    if (/** @type {number} */ (available) < /** @type {number} */ (required)) {
      return `This WebGPU adapter provides insufficient ${label} for this model.`;
    }
  }
  for (const feature of modelRequiredFeatures(model)) {
    if (!adapter.features.has(/** @type {GPUFeatureName} */ (feature))) {
      return `This model requires the WebGPU ${feature} feature.`;
    }
  }
  return null;
}

/**
 * Choose the strongest compatible model according to the site's quality ranks.
 *
 * Models without quality ranks retain their configured order. Equal explicit ranks prefer the
 * model with the lower memory estimate, then the smaller download.
 *
 * @param {GPUAdapter} adapter
 * @param {AssistantModel[]} models
 * @returns {AssistantModel | null}
 */
export function recommendModel(adapter, models) {
  const compatible = models
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => adapterCompatibilityIssue(adapter, model) === null);
  if (!compatible.length) return null;
  if (!compatible.some(({ model }) => model.quality !== undefined)) return compatible[0]?.model ?? null;
  compatible.sort((left, right) => {
    const quality = (right.model.quality ?? 0) - (left.model.quality ?? 0);
    if (quality) return quality;
    const memory = (left.model.memoryMB ?? Number.POSITIVE_INFINITY)
      - (right.model.memoryMB ?? Number.POSITIVE_INFINITY);
    if (memory) return memory;
    const download = (left.model.downloadMB ?? Number.POSITIVE_INFINITY)
      - (right.model.downloadMB ?? Number.POSITIVE_INFINITY);
    return download || left.index - right.index;
  });
  return compatible[0]?.model ?? null;
}

/**
 * Create a serializable capability report for local cross-device evaluation.
 *
 * @param {GPUAdapter} adapter
 * @param {AssistantModel[]} models
 * @returns {Record<string, unknown>}
 */
export function buildDeviceReport(adapter, models) {
  const info = adapter.info ?? { vendor: "", architecture: "", device: "", description: "" };
  const recommended = recommendModel(adapter, models);
  return {
    adapter: {
      info: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description
      },
      features: [...adapter.features].sort(),
      limits: {
        maxBufferSize: adapter.limits.maxBufferSize,
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
        maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage
      }
    },
    recommendedModelId: recommended?.id ?? null,
    models: models.map((model) => {
      const issue = adapterCompatibilityIssue(adapter, model);
      return { id: model.id, compatible: issue === null, issue };
    })
  };
}
