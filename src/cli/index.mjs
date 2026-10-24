// @ts-check

import { buildSiteAssistant } from "./build.mjs";
import { parseBuildOptions } from "./config.mjs";

export { buildSiteAssistant } from "./build.mjs";

const HELP = `Usage:
  smgen-assistant build [options]

Options:
  --pages <directory>   Markdown source directory (default: ./pages)
  --output <directory>  Generated site directory (default: ./docs)
  --base-url <path>     Site path prefix, such as /docs
  --config <file>       YAML configuration file
  -h, --help            Show this help
`;

/**
 * Run the command-line interface and return its process exit code.
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const parsed = await parseBuildOptions(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const result = await buildSiteAssistant(parsed.config);
  process.stdout.write(`Built ${result.pages} pages and ${result.chunks} chunks in ${result.destination}\n`);
  return 0;
}
