#!/usr/bin/env node
/**
 * validate.js — Validate coordinate relationships in an .excalidraw file
 *
 * Usage:
 *   node validate.js <file.excalidraw>
 *   node validate.js <file.excalidraw> --json      # JSON output
 *   node validate.js <file.excalidraw> --strict     # exit 1 on warnings too
 *
 * Exit codes: 0 = no issues, 1 = errors found, 2 = parse/IO error
 */

import { readFileSync } from "node:fs";

// ─── tolerance constants ─────────────────────────────────────────────────────
const COORD_TOL = 5;   // px: acceptable delta for coordinate math checks
const EDGE_TOL  = 20;  // px: acceptable distance from arrow endpoint to element edge

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Four edge midpoints of a bounding box (correct for rectangle, diamond, ellipse) */
function edgeMidpoints(el) {
  const { x, y, width: w, height: h } = el;
  return {
    top:    { x: x + w / 2, y },
    bottom: { x: x + w / 2, y: y + h },
    left:   { x,             y: y + h / 2 },
    right:  { x: x + w,     y: y + h / 2 },
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Minimum distance from point p to any edge midpoint of element el */
function minEdgeDist(p, el) {
  const edges = edgeMidpoints(el);
  return Math.min(...Object.values(edges).map((e) => dist(p, e)));
}

/** Closest edge name and its midpoint */
function closestEdge(p, el) {
  const edges = edgeMidpoints(el);
  let best = null, bestD = Infinity;
  for (const [name, pt] of Object.entries(edges)) {
    const d = dist(p, pt);
    if (d < bestD) { bestD = d; best = { name, pt, d }; }
  }
  return best;
}

/** Is point p inside the bounding box of el (with optional margin)? */
function insideBbox(p, el, margin = 0) {
  return (
    p.x >= el.x - margin &&
    p.x <= el.x + el.width  + margin &&
    p.y >= el.y - margin &&
    p.y <= el.y + el.height + margin
  );
}

function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

function edgeHint(el) {
  const e = edgeMidpoints(el);
  return (
    `top=(${fmt(e.top.x)},${fmt(e.top.y)}) ` +
    `bottom=(${fmt(e.bottom.x)},${fmt(e.bottom.y)}) ` +
    `left=(${fmt(e.left.x)},${fmt(e.left.y)}) ` +
    `right=(${fmt(e.right.x)},${fmt(e.right.y)})`
  );
}

// ─── issue collector ──────────────────────────────────────────────────────────

class IssueList {
  constructor() { this.items = []; }

  add(level, elementId, code, message, hint = "") {
    this.items.push({ level, elementId, code, message, hint });
  }

  error(id, code, msg, hint)   { this.add("error",   id, code, msg, hint); }
  warning(id, code, msg, hint) { this.add("warning", id, code, msg, hint); }

  get errors()   { return this.items.filter((i) => i.level === "error"); }
  get warnings() { return this.items.filter((i) => i.level === "warning"); }
}

// ─── validation checks ───────────────────────────────────────────────────────

function checkUniqueIds(elements, issues) {
  const seen = new Map();
  for (const el of elements) {
    if (seen.has(el.id)) {
      issues.error(el.id, "DUPLICATE_ID",
        `Duplicate id "${el.id}" — ids must be unique across all elements.`,
        `Rename one of the elements with id "${el.id}".`);
    } else {
      seen.set(el.id, el);
    }
  }
}

function checkArrowPointsConsistency(arrow, issues) {
  const pts = arrow.points;
  if (!Array.isArray(pts) || pts.length < 2) {
    issues.error(arrow.id, "ARROW_POINTS_MISSING",
      `Arrow "${arrow.id}" has fewer than 2 points.`,
      `points must be [[0,0],[dx,dy]] at minimum.`);
    return;
  }
  if (pts[0][0] !== 0 || pts[0][1] !== 0) {
    issues.error(arrow.id, "ARROW_POINTS_ORIGIN",
      `Arrow "${arrow.id}" first point is [${pts[0]}] instead of [0,0].`,
      `points[0] must always be [0,0] (coordinates are relative to arrow.x/y).`);
  }
  const last = pts[pts.length - 1];
  const dx = last[0], dy = last[1];
  if (Math.abs(dx - arrow.width) > COORD_TOL) {
    issues.error(arrow.id, "ARROW_WIDTH_MISMATCH",
      `Arrow "${arrow.id}" width=${arrow.width} but points last x=${dx} (delta=${Math.abs(dx - arrow.width).toFixed(1)}px).`,
      `Set width=${dx}  OR change points last x to ${arrow.width}.`);
  }
  if (Math.abs(dy - arrow.height) > COORD_TOL) {
    issues.error(arrow.id, "ARROW_HEIGHT_MISMATCH",
      `Arrow "${arrow.id}" height=${arrow.height} but points last y=${dy} (delta=${Math.abs(dy - arrow.height).toFixed(1)}px).`,
      `Set height=${dy}  OR change points last y to ${arrow.height}.`);
  }
}

function checkArrowEndpoints(arrow, elementMap, issues) {
  const pts = arrow.points;
  if (!Array.isArray(pts) || pts.length < 2) return;

  const last   = pts[pts.length - 1];
  const startPt = { x: arrow.x, y: arrow.y };
  const endPt   = { x: arrow.x + last[0], y: arrow.y + last[1] };

  if (arrow.startBinding) {
    const src = elementMap.get(arrow.startBinding.elementId);
    if (src) {
      const d = minEdgeDist(startPt, src);
      if (d > EDGE_TOL) {
        const ce = closestEdge(startPt, src);
        issues.error(arrow.id, "ARROW_START_FAR_FROM_EDGE",
          `Arrow "${arrow.id}" start (${fmt(startPt.x)},${fmt(startPt.y)}) is ${fmt(d)}px from nearest edge of "${src.id}" — closest is ${ce.name} edge (${fmt(ce.pt.x)},${fmt(ce.pt.y)}).`,
          `Move arrow start to the ${ce.name} edge midpoint: x=${fmt(ce.pt.x)}, y=${fmt(ce.pt.y)}.  All edges: ${edgeHint(src)}`);
      }
    }
  }

  if (arrow.endBinding) {
    const tgt = elementMap.get(arrow.endBinding.elementId);
    if (tgt) {
      const d = minEdgeDist(endPt, tgt);
      if (d > EDGE_TOL) {
        const ce = closestEdge(endPt, tgt);
        issues.error(arrow.id, "ARROW_END_FAR_FROM_EDGE",
          `Arrow "${arrow.id}" end (${fmt(endPt.x)},${fmt(endPt.y)}) is ${fmt(d)}px from nearest edge of "${tgt.id}" — closest is ${ce.name} edge (${fmt(ce.pt.x)},${fmt(ce.pt.y)}).`,
          `Adjust to reach the ${ce.name} edge: set points last to [${fmt(ce.pt.x - arrow.x)},${fmt(ce.pt.y - arrow.y)}], width=${fmt(ce.pt.x - arrow.x)}, height=${fmt(ce.pt.y - arrow.y)}.`);
      }
    }
  }

  // Warn about unbound ends
  if (!arrow.startBinding && !arrow.endBinding) {
    issues.warning(arrow.id, "ARROW_UNBOUND",
      `Arrow "${arrow.id}" has no startBinding or endBinding (free-floating).`,
      `Add startBinding and endBinding so the arrow stays connected when elements move.`);
  } else if (!arrow.startBinding) {
    issues.warning(arrow.id, "ARROW_START_UNBOUND",
      `Arrow "${arrow.id}" missing startBinding.`,
      `Add startBinding: {"elementId":"<id>","focus":0,"gap":1}.`);
  } else if (!arrow.endBinding) {
    issues.warning(arrow.id, "ARROW_END_UNBOUND",
      `Arrow "${arrow.id}" missing endBinding.`,
      `Add endBinding: {"elementId":"<id>","focus":0,"gap":1}.`);
  }
}

function checkBindingReferences(elements, elementMap, issues) {
  for (const el of elements) {
    if (el.type === "arrow") {
      for (const side of ["startBinding", "endBinding"]) {
        const b = el[side];
        if (b && !elementMap.has(b.elementId)) {
          issues.error(el.id, "BINDING_REF_MISSING",
            `Arrow "${el.id}" ${side}.elementId="${b.elementId}" does not exist.`,
            `Create element with id "${b.elementId}" or correct the binding.`);
        }
      }
    }

    if (el.type === "text" && el.containerId) {
      if (!elementMap.has(el.containerId)) {
        issues.error(el.id, "CONTAINER_REF_MISSING",
          `Text "${el.id}" containerId="${el.containerId}" does not exist.`,
          `Create element with id "${el.containerId}" or set containerId to null.`);
      }
    }

    if (Array.isArray(el.boundElements)) {
      for (const be of el.boundElements) {
        if (be.id && !elementMap.has(be.id)) {
          issues.error(el.id, "BOUND_ELEMENT_REF_MISSING",
            `Element "${el.id}" boundElements references "${be.id}" which does not exist.`,
            `Remove the stale entry from boundElements or add the missing element.`);
        }
      }
    }
  }
}

function checkBindingCrossReferences(elements, elementMap, issues) {
  // Arrow binding ↔ shape.boundElements
  for (const el of elements) {
    if (el.type !== "arrow") continue;
    for (const side of ["startBinding", "endBinding"]) {
      const b = el[side];
      if (!b) continue;
      const target = elementMap.get(b.elementId);
      if (!target || !Array.isArray(target.boundElements)) continue;
      const listed = target.boundElements.some((be) => be.id === el.id && be.type === "arrow");
      if (!listed) {
        issues.warning(el.id, "ARROW_NOT_IN_SHAPE_BOUND",
          `Arrow "${el.id}" has ${side} → "${b.elementId}", but "${b.elementId}".boundElements does not list this arrow.`,
          `Add {"type":"arrow","id":"${el.id}"} to element "${b.elementId}".boundElements.`);
      }
    }
  }

  // Text containerId ↔ container.boundElements
  for (const el of elements) {
    if (el.type !== "text" || !el.containerId) continue;
    const container = elementMap.get(el.containerId);
    if (!container || !Array.isArray(container.boundElements)) continue;
    const listed = container.boundElements.some((be) => be.id === el.id && be.type === "text");
    if (!listed) {
      issues.warning(el.id, "TEXT_NOT_IN_CONTAINER_BOUND",
        `Text "${el.id}" has containerId="${el.containerId}", but "${el.containerId}".boundElements does not list this text.`,
        `Add {"type":"text","id":"${el.id}"} to element "${el.containerId}".boundElements.`);
    }
  }
}

function checkTextPosition(el, elementMap, issues) {
  if (el.type !== "text" || !el.containerId) return;
  const container = elementMap.get(el.containerId);
  if (!container) return;

  const cx = el.x + el.width  / 2;
  const cy = el.y + el.height / 2;
  if (!insideBbox({ x: cx, y: cy }, container, EDGE_TOL)) {
    issues.warning(el.id, "TEXT_OUTSIDE_CONTAINER",
      `Text "${el.id}" center (${fmt(cx)},${fmt(cy)}) is outside container "${el.containerId}" ` +
      `(x=${container.x},y=${container.y},w=${container.width},h=${container.height}).`,
      `Typical text position: x=${container.x}, y=${container.y} (Excalidraw auto-centers it, but explicit coords should be inside the container).`);
  }
}

/** Shape types that occupy screen area (excludes arrows, text, frames) */
const SHAPE_TYPES = new Set(["rectangle", "diamond", "ellipse"]);

function checkOverlaps(elements, issues) {
  const shapes = elements.filter((e) => SHAPE_TYPES.has(e.type) && !e.isDeleted);

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      const acx = a.x + a.width  / 2, acy = a.y + a.height / 2;
      const bcx = b.x + b.width  / 2, bcy = b.y + b.height / 2;

      const overlapX = Math.abs(acx - bcx) < (a.width  + b.width)  / 2;
      const overlapY = Math.abs(acy - bcy) < (a.height + b.height) / 2;

      if (overlapX && overlapY) {
        // Skip if one shape is a background container:
        //   (a) one fully contains the other, OR
        //   (b) either has opacity < 100 (decorative overlay / background frame)
        const aContainsB = b.x >= a.x && b.y >= a.y &&
          b.x + b.width  <= a.x + a.width &&
          b.y + b.height <= a.y + a.height;
        const bContainsA = a.x >= b.x && a.y >= b.y &&
          a.x + a.width  <= b.x + b.width &&
          a.y + a.height <= b.y + b.height;
        const isBackground = (a.opacity ?? 100) < 100 || (b.opacity ?? 100) < 100;
        if (aContainsB || bContainsA || isBackground) continue;

        const ox = ((a.width + b.width)   / 2 - Math.abs(acx - bcx)).toFixed(0);
        const oy = ((a.height + b.height) / 2 - Math.abs(acy - bcy)).toFixed(0);
        issues.warning(a.id, "SHAPE_OVERLAP",
          `"${a.id}" (x=${a.x},y=${a.y},w=${a.width},h=${a.height}) overlaps ` +
          `"${b.id}" (x=${b.x},y=${b.y},w=${b.width},h=${b.height}) by ${ox}×${oy}px.`,
          `Increase spacing — minimum clearance is 80px horizontal, 60px vertical.`);
      }
    }
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const filePath  = args.find((a) => !a.startsWith("--"));
const jsonOutput = args.includes("--json");
const strict     = args.includes("--strict");

if (!filePath) {
  process.stderr.write("Usage: node validate.js <file.excalidraw> [--json] [--strict]\n");
  process.exit(2);
}

let raw;
try {
  raw = readFileSync(filePath, "utf8");
} catch (e) {
  process.stderr.write(`Error reading file: ${e.message}\n`);
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(raw);
} catch (e) {
  process.stderr.write(`JSON parse error: ${e.message}\n`);
  process.exit(2);
}

if (doc.type !== "excalidraw") {
  process.stderr.write(`Not a valid .excalidraw file (type="${doc.type}").\n`);
  process.exit(2);
}

const elements   = doc.elements ?? [];
const elementMap = new Map(elements.map((e) => [e.id, e]));
const issues     = new IssueList();

checkUniqueIds(elements, issues);
checkBindingReferences(elements, elementMap, issues);
checkBindingCrossReferences(elements, elementMap, issues);
checkOverlaps(elements, issues);

for (const el of elements) {
  if (el.type === "arrow") {
    checkArrowPointsConsistency(el, issues);
    checkArrowEndpoints(el, elementMap, issues);
  }
  if (el.type === "text") {
    checkTextPosition(el, elementMap, issues);
  }
}

// ─── output ───────────────────────────────────────────────────────────────────

const totalErrors   = issues.errors.length;
const totalWarnings = issues.warnings.length;
const hasProblems   = totalErrors > 0 || (strict && totalWarnings > 0);

if (jsonOutput) {
  process.stdout.write(
    JSON.stringify({
      file: filePath,
      summary: { errors: totalErrors, warnings: totalWarnings },
      issues: issues.items,
    }, null, 2) + "\n"
  );
} else {
  if (issues.items.length === 0) {
    process.stdout.write(`✓ ${filePath}: no issues (${elements.length} elements)\n`);
  } else {
    const LINE = "─".repeat(64);
    process.stdout.write(`\nValidation: ${filePath}\n${LINE}\n`);
    process.stdout.write(`Elements: ${elements.length}  |  Errors: ${totalErrors}  Warnings: ${totalWarnings}\n\n`);

    const ICONS = { error: "✗", warning: "⚠" };
    for (const issue of issues.items) {
      process.stdout.write(`[${issue.level.toUpperCase()}] ${ICONS[issue.level]} ${issue.code}\n`);
      process.stdout.write(`  Element : ${issue.elementId}\n`);
      process.stdout.write(`  Problem : ${issue.message}\n`);
      if (issue.hint) {
        process.stdout.write(`  Fix     : ${issue.hint}\n`);
      }
      process.stdout.write("\n");
    }

    process.stdout.write(`${LINE}\n`);
    process.stdout.write(`Result: ${totalErrors} error(s), ${totalWarnings} warning(s)\n`);
  }
}

process.exit(hasProblems ? 1 : 0);
