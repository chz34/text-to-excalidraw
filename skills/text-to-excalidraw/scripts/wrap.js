/**
 * Wraps an Excalidraw elements array into a complete .excalidraw file object.
 * @param {object[]} elements - Array of ExcalidrawElement objects
 * @param {object} [appStateOverrides] - Optional appState overrides
 * @returns {object} Complete .excalidraw file object
 */
export function wrapElements(elements, appStateOverrides = {}) {
  if (!Array.isArray(elements)) {
    throw new TypeError(`wrapElements: elements must be an array, got ${typeof elements}`);
  }
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: "#ffffff",
      ...appStateOverrides,
    },
    files: {},
  };
}

// CLI entry point: reads elements JSON array from stdin, writes .excalidraw to --out or stdout
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx !== -1 ? process.argv[outIdx + 1] : null;

  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  const elements = JSON.parse(input);
  const result = wrapElements(elements);
  const json = JSON.stringify(result, null, 2);

  if (outPath) {
    writeFileSync(outPath, json, "utf8");
  } else {
    process.stdout.write(json + "\n");
  }
}
