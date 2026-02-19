import type { ModelContextTool } from "../types";
import type { PaintEngine } from "./paintEngine";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
}

function parseFlatPoints(value: unknown): Array<{ x: number; y: number; pressure?: number }> {
  const numbers = asNumberArray(value);
  if (numbers.length < 2) {
    return [];
  }

  const points: Array<{ x: number; y: number; pressure?: number }> = [];
  const stride = numbers.length % 3 === 0 ? 3 : 2;

  for (let index = 0; index < numbers.length - 1; index += stride) {
    const x = numbers[index];
    const y = numbers[index + 1];
    const pressure = stride === 3 ? clamp(numbers[index + 2], 0.1, 1) : 1;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      points.push({ x, y, pressure });
    }
  }

  return points;
}

function defaultLayer(value: unknown): string {
  const text = String(value || "paint").trim();
  return text.length ? text : "paint";
}

export function createPaintTools(engine: PaintEngine): ModelContextTool[] {
  return [
    {
      name: "set_brush_preset",
      description: "Switch brush profile. presets: marker, ink, pencil, airbrush.",
      inputSchema: {
        type: "object",
        properties: {
          preset: {
            type: "string",
            enum: ["marker", "ink", "pencil", "airbrush"],
            description: "Brush preset"
          }
        },
        required: ["preset"]
      },
      execute: async ({ preset }) => {
        const active = engine.setBrushPreset(String(preset || "marker"));
        return { activePreset: active };
      }
    },
    {
      name: "set_blend_mode",
      description: "Set blend mode for future paint operations.",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: [
              "source-over",
              "lighter",
              "multiply",
              "screen",
              "overlay",
              "soft-light",
              "destination-out"
            ],
            description: "Canvas blend mode"
          }
        },
        required: ["mode"]
      },
      execute: async ({ mode }) => {
        const active = engine.setBlendMode(String(mode || "source-over"));
        return { blendMode: active };
      }
    },
    {
      name: "paint_stroke",
      description:
        "Paint smooth freeform stroke. points are flattened [x1,y1,p1,x2,y2,p2,...] or [x1,y1,x2,y2,...].",
      inputSchema: {
        type: "object",
        properties: {
          layer: { type: "string", description: "Layer name" },
          points: {
            type: "array",
            description: "Flattened numeric points list",
            items: { type: "number" }
          },
          preset: { type: "string", enum: ["marker", "ink", "pencil", "airbrush"] },
          color: { type: "string", description: "Hex color" },
          size: { type: "number", description: "Brush size in px" },
          opacity: { type: "number", description: "0..1" },
          smoothing: { type: "number", description: "0..0.95" },
          taper: { type: "number", description: "0..0.98" }
        },
        required: ["points"]
      },
      execute: async ({ layer, points, preset, color, size, opacity, smoothing, taper }) => {
        const parsedPoints = parseFlatPoints(points);
        if (parsedPoints.length < 1) {
          throw new Error("paint_stroke requires at least one point");
        }

        engine.paintStroke({
          layer: defaultLayer(layer),
          points: parsedPoints,
          preset: String(preset || ""),
          color: String(color || ""),
          size: Number(size),
          opacity: Number(opacity),
          smoothing: Number(smoothing),
          taper: Number(taper)
        });

        return {
          ok: true,
          points: parsedPoints.length,
          layer: defaultLayer(layer)
        };
      }
    },
    {
      name: "erase_stroke",
      description:
        "Erase with smooth stroke. points are flattened [x1,y1,p1,x2,y2,p2,...] or [x1,y1,x2,y2,...].",
      inputSchema: {
        type: "object",
        properties: {
          layer: { type: "string", description: "Layer name" },
          points: {
            type: "array",
            description: "Flattened numeric points list",
            items: { type: "number" }
          },
          size: { type: "number", description: "Eraser size" },
          opacity: { type: "number", description: "0..1" },
          smoothing: { type: "number", description: "0..0.95" },
          taper: { type: "number", description: "0..0.98" }
        },
        required: ["points"]
      },
      execute: async ({ layer, points, size, opacity, smoothing, taper }) => {
        const parsedPoints = parseFlatPoints(points);
        if (parsedPoints.length < 1) {
          throw new Error("erase_stroke requires at least one point");
        }

        engine.eraseStroke({
          layer: defaultLayer(layer),
          points: parsedPoints,
          size: Number(size),
          opacity: Number(opacity),
          smoothing: Number(smoothing),
          taper: Number(taper)
        });

        return {
          ok: true,
          points: parsedPoints.length,
          layer: defaultLayer(layer)
        };
      }
    },
    {
      name: "paint_path",
      description: "Paint smooth path using waypoints. points are flattened [x1,y1,x2,y2,...].",
      inputSchema: {
        type: "object",
        properties: {
          layer: { type: "string", description: "Layer name" },
          points: {
            type: "array",
            description: "Flattened numeric points list",
            items: { type: "number" }
          },
          closed: { type: "boolean", description: "Close final segment" },
          preset: { type: "string", enum: ["marker", "ink", "pencil", "airbrush"] },
          color: { type: "string", description: "Hex color" },
          size: { type: "number", description: "Stroke width" },
          opacity: { type: "number", description: "0..1" }
        },
        required: ["points"]
      },
      execute: async ({ layer, points, closed, preset, color, size, opacity }) => {
        const parsedPoints = parseFlatPoints(points);
        if (parsedPoints.length < 2) {
          throw new Error("paint_path requires at least two points");
        }

        engine.paintPath({
          layer: defaultLayer(layer),
          points: parsedPoints,
          closed: Boolean(closed),
          preset: String(preset || ""),
          color: String(color || ""),
          size: Number(size),
          opacity: Number(opacity)
        });

        return {
          ok: true,
          points: parsedPoints.length,
          layer: defaultLayer(layer)
        };
      }
    },
    {
      name: "fill_region",
      description: "Fill contiguous region from x,y with color and optional tolerance.",
      inputSchema: {
        type: "object",
        properties: {
          layer: { type: "string", description: "Layer name" },
          x: { type: "number", description: "X coordinate" },
          y: { type: "number", description: "Y coordinate" },
          color: { type: "string", description: "Hex color" },
          tolerance: { type: "number", description: "0..100" }
        },
        required: ["x", "y", "color"]
      },
      execute: async ({ layer, x, y, color, tolerance }) => {
        engine.fillRegion({
          layer: defaultLayer(layer),
          x: Number(x),
          y: Number(y),
          color: String(color || "#ffffff"),
          tolerance: Number(tolerance)
        });

        return { ok: true };
      }
    },
    {
      name: "clear_layer",
      description: "Clear one layer while preserving others.",
      inputSchema: {
        type: "object",
        properties: {
          layer: { type: "string", description: "Layer name" }
        },
        required: ["layer"]
      },
      execute: async ({ layer }) => {
        const target = defaultLayer(layer);
        engine.clearLayer(target);
        return { ok: true, layer: target };
      }
    },
    {
      name: "set_layer_visibility",
      description: "Show or hide a layer.",
      inputSchema: {
        type: "object",
        properties: {
          layer: { type: "string", description: "Layer name" },
          visible: { type: "boolean", description: "Visibility state" }
        },
        required: ["layer", "visible"]
      },
      execute: async ({ layer, visible }) => {
        const target = defaultLayer(layer);
        engine.setLayerVisibility(target, Boolean(visible));
        return { ok: true, layer: target, visible: Boolean(visible) };
      }
    },
    {
      name: "sample_color",
      description: "Read RGBA hex color from canvas at x,y.",
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "number", description: "X coordinate" },
          y: { type: "number", description: "Y coordinate" }
        },
        required: ["x", "y"]
      },
      annotations: {
        readOnlyHint: true
      },
      execute: async ({ x, y }) => {
        return {
          color: engine.sampleColor(Number(x), Number(y))
        };
      }
    },
    {
      name: "get_bounding_boxes",
      description: "Get painted bounding boxes per layer for planning.",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      },
      annotations: {
        readOnlyHint: true
      },
      execute: async () => {
        return {
          boxes: engine.getBoundingBoxes()
        };
      }
    },
    {
      name: "get_canvas_state",
      description: "Get dimensions, draw counts, layer states, active brush and blend mode.",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      },
      annotations: {
        readOnlyHint: true
      },
      execute: async () => {
        return engine.getSnapshot();
      }
    }
  ];
}
