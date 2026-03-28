import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { wrapElements } from "./wrap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "convert.js");

const SAMPLE_ELEMENTS = [
  {
    id: "r1", type: "rectangle", x: 100, y: 100, width: 200, height: 80,
    strokeColor: "#1e1e1e", backgroundColor: "#e7f5ff", fillStyle: "solid",
    strokeWidth: 2, roughness: 1, opacity: 100, angle: 0, version: 1,
    versionNonce: 1, isDeleted: false, groupIds: [], boundElements: [], updated: 1,
    link: null, locked: false,
  },
  {
    id: "t1", type: "text", x: 108, y: 128, width: 184, height: 44,
    text: "Hello", fontSize: 20, fontFamily: 1,
    textAlign: "center", verticalAlign: "middle", containerId: "r1",
    originalText: "Hello", lineHeight: 1.25,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, roughness: 1, opacity: 100, angle: 0, version: 1,
    versionNonce: 2, isDeleted: false, groupIds: [], boundElements: [], updated: 1,
    link: null, locked: false,
  },
];

function makeTempExcalidraw() {
  const dir = mkdtempSync(join(tmpdir(), "excalidraw-test-"));
  const filePath = join(dir, "test.excalidraw");
  writeFileSync(filePath, JSON.stringify(wrapElements(SAMPLE_ELEMENTS)), "utf8");
  return filePath;
}

// ── Error handling (no heavy deps needed) ──────────────────────────────────

test("exits with code 1 and prints Usage when no input file given", () => {
  const result = spawnSync("node", [CLI], { encoding: "utf8" });
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
  assert.ok(result.stderr.includes("Usage:"), `expected 'Usage:' in stderr: ${result.stderr}`);
});

test("exits with code 1 when input file does not exist", () => {
  const result = spawnSync("node", [CLI, "/nonexistent/missing.excalidraw"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes("Cannot read input file"), `stderr: ${result.stderr}`);
});

test("exits with code 1 for unknown --format value", () => {
  const inputFile = makeTempExcalidraw();
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "gif"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("Unknown format"), `stderr: ${result.stderr}`);
  } finally {
    unlinkSync(inputFile);
  }
});

// ── Integration tests (require installed npm deps) ─────────────────────────

test("exports valid SVG from .excalidraw file", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const outFile = inputFile.replace(".excalidraw", ".svg");
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "svg", "--out", outFile], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(outFile), "SVG output file should exist");
    const svg = readFileSync(outFile, "utf8");
    assert.ok(svg.trimStart().startsWith("<svg"), `SVG should start with <svg, got: ${svg.slice(0, 80)}`);
    assert.ok(svg.includes("</svg>"), "SVG should close with </svg>");
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(outFile)) unlinkSync(outFile);
  }
});

test("exports valid PNG from .excalidraw file", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const outFile = inputFile.replace(".excalidraw", ".png");
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "png", "--out", outFile], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(outFile), "PNG output file should exist");
    const buf = readFileSync(outFile);
    assert.equal(buf[0], 0x89, "byte 0 should be 0x89");
    assert.equal(buf[1], 0x50, "byte 1 should be 0x50 (P)");
    assert.equal(buf[2], 0x4e, "byte 2 should be 0x4E (N)");
    assert.equal(buf[3], 0x47, "byte 3 should be 0x47 (G)");
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(outFile)) unlinkSync(outFile);
  }
});

test("auto-derives output path when --out is omitted", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const expectedOut = inputFile.replace(".excalidraw", ".svg");
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "svg"], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(expectedOut), "auto-named output file should exist");
    assert.ok(result.stdout.includes(expectedOut), `stdout should mention output path: ${result.stdout}`);
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(expectedOut)) unlinkSync(expectedOut);
  }
});

test("--scale 2 produces a larger PNG than --scale 1", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const out1x = inputFile.replace(".excalidraw", "-1x.png");
  const out2x = inputFile.replace(".excalidraw", "-2x.png");
  try {
    spawnSync("node", [CLI, inputFile, "--format", "png", "--scale", "1", "--out", out1x], {
      encoding: "utf8", timeout: 60000,
    });
    spawnSync("node", [CLI, inputFile, "--format", "png", "--scale", "2", "--out", out2x], {
      encoding: "utf8", timeout: 60000,
    });
    assert.ok(existsSync(out1x) && existsSync(out2x), "both PNG files should exist");
    const size1 = readFileSync(out1x).length;
    const size2 = readFileSync(out2x).length;
    assert.ok(size2 > size1, `2x PNG (${size2}B) should be larger than 1x PNG (${size1}B)`);
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(out1x)) unlinkSync(out1x);
    if (existsSync(out2x)) unlinkSync(out2x);
  }
});

test("--dark flag is accepted without error", { timeout: 60000 }, () => {
  const inputFile = makeTempExcalidraw();
  const outFile = inputFile.replace(".excalidraw", "-dark.svg");
  try {
    const result = spawnSync("node", [CLI, inputFile, "--format", "svg", "--dark", "--out", outFile], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(outFile), "dark SVG output should exist");
  } finally {
    if (existsSync(inputFile)) unlinkSync(inputFile);
    if (existsSync(outFile)) unlinkSync(outFile);
  }
});
