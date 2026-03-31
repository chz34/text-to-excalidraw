---
name: text-to-excalidraw
description: Convert a natural language description into an Excalidraw diagram (.excalidraw file). Triggered by /text-to-excalidraw command or when user asks to draw/diagram something. Generates Excalidraw JSON elements and saves to a .excalidraw file.
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

Generate a JSON array of elements. Use the schema reference below. Rules:
- Every element must have a unique `id` (use short alphanumeric strings like "r1", "t1", "a1")
- Place elements at reasonable coordinates: start at x=100, y=100, space nodes 200px apart
- For flowcharts: top-to-bottom layout, 180px vertical gap between nodes
- For sequence diagrams: actors at y=80, spaced 250px horizontally; messages as horizontal arrows
- For class diagrams: classes as rectangles with text, relationships as arrows
- Arrows should start/end near the center edge of their source/target elements
- Text labels inside shapes use `containerId` pointing to the shape's `id`
- Standalone text uses `type: "text"` with no `containerId`

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

```json
{
  "type": "arrow",
  "id": "a1",
  "x": 260, "y": 130,
  "width": 80, "height": 0,
  "points": [[0, 0], [80, 0]],
  "startArrowhead": null,
  "endArrowhead": "arrow",
  "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
  "fillStyle": "solid", "strokeWidth": 2, "roughness": 1,
  "angle": 0, "opacity": 100,
  "version": 1, "versionNonce": 1, "isDeleted": false,
  "groupIds": [], "boundElements": [],
  "updated": 1, "link": null, "locked": false
}
```

For vertical arrows (top to bottom): `"points": [[0,0],[0,80]]`, set `height: 80, width: 0`.

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

### Flowchart (top-down)
- Start node: x=300, y=100, width=160, height=60
- Each subsequent node: y += 160
- Decision (diamond): same size as rectangles
- Arrows: from bottom center of source to top center of target
  - Arrow x = source.x + source.width/2, y = source.y + source.height
  - Points: `[[0,0],[0,80]]` for 80px vertical gap

### Sequence diagram
- Actor boxes: y=60, width=120, height=50, spaced at x=100, 350, 600, ...
- Actor labels: text bound inside actor box
- Messages: horizontal arrows at y=160, 220, 280, ...
  - Arrow starts at right edge of sender actor column, ends at left edge of receiver
- Activation bars: thin rectangles (width=10) at actor x+55 for the active period

### System architecture
- Group related services in frames
- Place load balancers/gateways at top center
- Databases at bottom
- Space services 220px apart horizontally
- Use dashed arrows for async connections, solid for sync
