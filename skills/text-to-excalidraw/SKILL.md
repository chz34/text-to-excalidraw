---
name: text-to-excalidraw
description: Convert a natural language description into an Excalidraw diagram (.excalidraw file), with optional export to SVG or PNG. Triggered by /text-to-excalidraw command or when user asks to draw/diagram something. Generates Excalidraw JSON elements, saves to a .excalidraw file, and can render to SVG/PNG on request.
---

# Text-to-Excalidraw

Convert a natural language description into a `.excalidraw` diagram file.

## When This Skill Is Used

- Slash command: `/text-to-excalidraw <description>` (description optional)
- Conversational triggers: "画个图", "帮我画", "draw a diagram", "create a flowchart", "make an architecture diagram", "generate a sequence diagram", etc.

## Execution Flow

### Step 1 — Collect inputs

If the description is missing or too vague, ask ONE clarifying question. If an output path is not specified, use `./output.excalidraw` as default.

Ask: "Save to `./output.excalidraw`? Or specify a different path."

### Step 2 — Determine generation strategy

**Use Mermaid-style reasoning** (think in Mermaid, output JSON) for:
- Flowchart / decision tree → mental model: `flowchart TD`
- Sequence diagram / interaction flow → `sequenceDiagram`
- Class diagram / UML → `classDiagram`
- State machine → `stateDiagram-v2`
- ER diagram / database schema → `erDiagram`
- Mind map → `mindmap`

**Use coordinate-based reasoning** for:
- Free-layout architecture diagrams ("service A connects to B and C")
- Network topology
- User explicitly requests specific positions
- Any diagram that doesn't fit Mermaid structure

### Step 3 — Generate Excalidraw elements JSON

Rules:
- Every element needs a unique short `id` (e.g. "r1", "t1", "a1")
- Text labels inside shapes: use `containerId` pointing to the shape's `id`
- Standalone text: `containerId: null`, `textAlign: "left"`, `verticalAlign: "top"`

**Layout planning (do this before generating coordinates):**

Standard node sizes: rectangle 160×60, diamond 160×80, ellipse 140×60.

Assign a row/col index to every node first, then compute coordinates:
- Top-down: `x = col × (node_w + 120)`, `y = row × (node_h + 100)` — start at x=300, y=100
- Left-right: `x = col × (node_w + 120)`, `y = row × (node_h + 80)` — start at x=100, y=200
- Minimum clearance between any two shapes: **80px horizontal, 60px vertical**

Before writing elements, verify no two nodes overlap:
> overlap exists if `|cx1−cx2| < (w1+w2)/2` AND `|cy1−cy2| < (h1+h2)/2` — increase spacing if true

**Arrow connection rules (critical):**

Every arrow must have `startBinding`/`endBinding` (`{elementId, focus:0, gap:1}`). Without bindings arrows are free-floating and visually disconnect. Every connected shape must list arrows in its `boundElements` alongside the text label.

Compute arrow coordinates precisely from the exact edge of each node:
- **Vertical** (↓): `x=src.x+src.w/2`, `y=src.y+src.h`, `height=tgt.y−y`, `width=0`, `points:[[0,0],[0,height]]`
- **Horizontal** (→): `x=src.x+src.w`, `y=src.y+src.h/2`, `width=tgt.x−x`, `height=0`, `points:[[0,0],[width,0]]`
- **Diagonal**: start = exact source edge-midpoint closest to target; end vector `dx=tgt_edge.x−start.x`, `dy=tgt_edge.y−start.y`; verify by substituting values before writing

Verify arrow math before finalizing:
- Vertical: `arrow.y + height == tgt.y` ✓
- Horizontal: `arrow.x + width == tgt.x` ✓
- Diagonal: `arrow.x + dx == tgt_edge.x` AND `arrow.y + dy == tgt_edge.y` ✓

**Diamond vertices** (midpoints of edges, not corners):
top=(x+w/2, y) · bottom=(x+w/2, y+h) · left=(x, y+h/2) · right=(x+w, y+h/2)

### Step 4 — Install CLI tool if needed

Before writing the file, check if the scripts are installed. The skill's base directory is shown at the top of this prompt (the `Base directory for this skill:` line). Scripts live at `<BASE_DIR>/scripts/`. If that line is absent, use the default: `~/.claude/skills/text-to-excalidraw` for Claude Code / OpenCode, or `~/.openclaw/skills/text-to-excalidraw` for OpenClaw.

```bash
# Replace <BASE_DIR> with the base directory from the skill header
test -f <BASE_DIR>/scripts/wrap.js && \
  test -f <BASE_DIR>/scripts/convert.js && \
  echo "installed" || echo "missing"
```

If missing, tell the user to install from the repository:

```bash
git clone https://github.com/chz34/text-to-excalidraw.git
cd text-to-excalidraw
./install.sh          # Claude Code / OpenCode
# or: ./install.sh openclaw   # OpenClaw
```

The installer copies the skill (including `scripts/`) to the appropriate location and runs `npm install` automatically.

### Step 5 — Write the .excalidraw file

Generate the elements JSON array (Step 3 output), then pipe it to the converter using the Write tool to create a temp file, then run:

```bash
node <BASE_DIR>/scripts/wrap.js --out <output_path> < /tmp/elements.json
```

Or use the Write tool to directly write the wrapped file using the schema below.

**Direct write approach** (preferred when you have the elements ready):
Use the Write tool to write the complete `.excalidraw` JSON directly:

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [ ...your elements here... ],
  "appState": {
    "gridSize": null,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

### Step 6 — Export to SVG / PNG (optional)

If the user requested SVG or PNG output, offer to export:

> "要导出为 SVG 或 PNG 吗？(Need SVG or PNG export?)"

**Export to SVG:**

```bash
node <BASE_DIR>/scripts/convert.js <input.excalidraw> --format svg --out <output.svg>
```

**Export to PNG:**

```bash
node <BASE_DIR>/scripts/convert.js <input.excalidraw> --format png --out <output.png>
```

**Additional options:**

| Option | Default | Description |
|---|---|---|
| `--scale <n>` | `1` | PNG resolution multiplier, e.g. `--scale 2` for 2× |
| `--dark` | off | Export with dark mode |
| `--padding <n>` | `20` | Padding around content in pixels |
| `--background-color <hex>` | `#ffffff` | Background color |
| `--no-background` | off | Transparent background (PNG) |

If `--out` is omitted, the output file is placed next to the input with the appropriate extension.

### Step 7 — Confirm output

Tell the user:
- The file path(s) that were created (`.excalidraw` and any exported SVG/PNG)
- How to open the `.excalidraw` file: "Open at https://excalidraw.com — click the folder icon or drag the file into the browser"
- Offer to regenerate with a different style or layout if needed

---

## Excalidraw Element Schema Reference

All elements share these base properties:

```json
{
  "id": "string (unique, short)",
  "type": "rectangle|diamond|ellipse|text|arrow|line|freedraw|frame",
  "x": "number (pixels from left)",
  "y": "number (pixels from top)",
  "width": "number",
  "height": "number",
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid|hachure|cross-hatch|zigzag",
  "strokeWidth": 2,
  "strokeStyle": "solid|dashed|dotted",
  "roughness": 1,
  "opacity": 100,
  "version": 1,
  "versionNonce": 1,
  "isDeleted": false,
  "groupIds": [],
  "boundElements": [],
  "updated": 1,
  "link": null,
  "locked": false
}
```

### Shape elements (rectangle, diamond, ellipse)

```json
{
  "type": "rectangle",
  "id": "r1",
  "x": 100, "y": 100, "width": 160, "height": 60,
  "strokeColor": "#1e1e1e", "backgroundColor": "#e7f5ff",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 1,
  "angle": 0, "opacity": 100,
  "roundness": { "type": 3 },
  "version": 1, "versionNonce": 1, "isDeleted": false,
  "groupIds": [], "boundElements": [{"type": "text", "id": "t1"}],
  "updated": 1, "link": null, "locked": false
}
```

### Text element (label inside a shape)

When a text is bound to a shape, set `containerId` to the shape's id:

```json
{
  "type": "text",
  "id": "t1",
  "x": 108, "y": 118,
  "width": 144, "height": 24,
  "text": "Node Label",
  "fontSize": 16,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "r1",
  "originalText": "Node Label",
  "lineHeight": 1.25,
  "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 1,
  "angle": 0, "opacity": 100,
  "version": 1, "versionNonce": 1, "isDeleted": false,
  "groupIds": [], "boundElements": [],
  "updated": 1, "link": null, "locked": false
}
```

### Standalone text

For standalone labels (no container shape):

```json
{
  "type": "text",
  "id": "st1",
  "x": 100, "y": 50,
  "width": 200, "height": 24,
  "text": "Title",
  "fontSize": 20,
  "fontFamily": 1,
  "textAlign": "left",
  "verticalAlign": "top",
  "containerId": null,
  "originalText": "Title",
  "lineHeight": 1.25,
  "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 1,
  "angle": 0, "opacity": 100,
  "version": 1, "versionNonce": 1, "isDeleted": false,
  "groupIds": [], "boundElements": [],
  "updated": 1, "link": null, "locked": false
}
```

### Arrow element

Arrows must have `startBinding`/`endBinding`. For unbound ends use `null`.

```json
{
  "type": "arrow", "id": "a1",
  "x": 180, "y": 160, "width": 0, "height": 50,
  "points": [[0,0],[0,50]],
  "startArrowhead": null, "endArrowhead": "arrow",
  "startBinding": {"elementId":"r1", "focus":0, "gap":1},
  "endBinding":   {"elementId":"r2", "focus":0, "gap":1},
  "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 1,
  "angle": 0, "opacity": 100,
  "elbowed": false, "roundness": null,
  "version": 1, "versionNonce": 1, "isDeleted": false,
  "groupIds": [], "boundElements": [],
  "updated": 1, "link": null, "locked": false
}
```

`focus:0` = center of edge; `gap:1` = 1px visual gap.

**Routing styles:**

| Style | Fields | When to use |
|---|---|---|
| Sharp straight (default) | `"roundness":null, "elbowed":false` | Simple flowcharts, aligned nodes |
| Round arc | `"roundness":{"type":2}, "elbowed":false` | Sequence diagrams, self-loops |
| Elbow right-angle | `"elbowed":true, "roundness":null` | Architecture diagrams, auto-routing |

Elbow arrows require `fixedPoint` in each binding: `[0.5,0]`=top-center, `[0.5,1]`=bottom-center, `[0,0.5]`=left-center, `[1,0.5]`=right-center.

**Arrowhead values:** `null` · `"arrow"` · `"triangle"` · `"bar"` · `"dot"` · `"circle"` · `"diamond"` · `"crowfoot_one"` · `"crowfoot_many"` · `"crowfoot_one_or_many"`

### Frame element

```json
{
  "type": "frame",
  "id": "f1",
  "x": 80, "y": 80, "width": 400, "height": 300,
  "name": "Frame Title",
  "strokeColor": "#000000", "backgroundColor": "transparent",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 0,
  "angle": 0, "opacity": 100,
  "version": 1, "versionNonce": 1, "isDeleted": false,
  "groupIds": [], "boundElements": [],
  "updated": 1, "link": null, "locked": false
}
```

---

## Layout Guidelines

### Anti-overlap rules (apply to all diagram types)

Before generating, plan the grid. Safe spacing presets (node_w=160, node_h=60):
- **Vertical chain**: `y_step = node_h + 100` → y increments of 160
- **Horizontal chain**: `x_step = node_w + 120` → x increments of 280
- **Grid**: column pitch 280px, row pitch 160px

For branching (diamond with multiple exits):
- Place each branch in its own column, centered on the diamond's x ± branch_offset
- branch_offset = (num_branches − 1) × 140 / 2; branches at x = diamond.x + col × 280 − branch_offset

Overlap check before finalizing: for every pair (A, B):
```
no_overlap = |A.cx − B.cx| ≥ (A.w + B.w)/2  OR  |A.cy − B.cy| ≥ (A.h + B.h)/2
```
If overlap found, increase spacing and recompute.

### Flowchart (top-down)
- Nodes: x=300, y=100, width=160, height=60; y += 160 per step (= node_h + 100)
- Decision diamond: same x/width/height as rectangle; place on its own row
- Arrows: `x=src.x+src.w/2`, `y=src.y+src.h`, `height=tgt.y−y`, bind both ends
- Diamond branches: use exact diamond vertex → target top-center; verify dx/dy before writing

### Sequence diagram
- Actors: y=60, width=120, height=50, spaced x=100/350/600/…
- Messages: horizontal arrows at y=160/220/280/…; starts at sender right edge, ends at receiver left edge
- Activation bars: width=10 rectangles at actor x+55

### System architecture
- Frames group related services; gateway/LB at top-center; databases at bottom
- 220px horizontal spacing; dashed arrows = async, solid = sync
