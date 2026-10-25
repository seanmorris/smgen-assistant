// @ts-check

/**
 * @typedef {object} CorpusSource
 * @property {string} id
 * @property {string} title
 * @property {string} url
 */

/**
 * @typedef {object} CorpusChunk
 * @property {string} id
 * @property {string} sourceId
 * @property {string} title
 * @property {string} url
 * @property {string} heading
 * @property {string} content
 */

/**
 * @typedef {object} Corpus
 * @property {1} version
 * @property {CorpusSource[]} sources
 * @property {CorpusChunk[]} chunks
 */

/**
 * @typedef {object} AssistantModel
 * @property {string} id
 * @property {string} label
 * @property {number} [downloadMB]
 * @property {number} [memoryMB]
 * @property {number} [quality]
 * @property {string[]} [requiredFeatures]
 * @property {number} [minStorageBufferMB]
 */

/**
 * @typedef {object} PublicAssistantConfig
 * @property {1} version
 * @property {string} title
 * @property {string} greeting
 * @property {AssistantModel} model
 * @property {AssistantModel[]} models
 * @property {{maxChunks: number, maxCharacters: number}} retrieval
 */

export {};
