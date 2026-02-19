export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface BrushPreset {
  color: string;
  size: number;
  opacity: number;
  smoothing: number;
  taper: number;
}

interface LayerRecord {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible: boolean;
}

const DEFAULT_BRUSH_PRESETS: Record<string, BrushPreset> = {
  marker: { color: "#42d7ff", size: 8, opacity: 0.9, smoothing: 0.68, taper: 0.2 },
  ink: { color: "#f5f7ff", size: 5, opacity: 1, smoothing: 0.72, taper: 0.35 },
  pencil: { color: "#dbe2ff", size: 3, opacity: 0.78, smoothing: 0.58, taper: 0.5 },
  airbrush: { color: "#89c9ff", size: 16, opacity: 0.22, smoothing: 0.44, taper: 0.08 }
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toRgba(color: string): [number, number, number, number] | null {
  const normalized = color.trim();
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (![3, 4, 6, 8].includes(hex.length)) {
    return null;
  }

  const expand = (value: string) =>
    value.length === 1 ? `${value}${value}` : value;

  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(expand(hex[0]), 16);
    const g = parseInt(expand(hex[1]), 16);
    const b = parseInt(expand(hex[2]), 16);
    const a = hex.length === 4 ? parseInt(expand(hex[3]), 16) : 255;
    return [r, g, b, a];
  }

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

export class PaintEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private width = 960;
  private height = 640;
  private layers = new Map<string, LayerRecord>();
  private drawCount = 0;
  private currentBlendMode: GlobalCompositeOperation = "source-over";
  private currentBrushPreset = "marker";

  constructor() {
    this.ensureLayer("paint", true);
    this.ensureLayer("fx", true);
  }

  attachCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context is unavailable");
    }
    this.ctx = ctx;
    this.resize();
    this.render();
  }

  resize() {
    if (!this.canvas || !this.ctx) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(320, Math.round(rect.width || this.width));
    this.height = Math.max(320, Math.round(rect.height || this.height));
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;

    for (const [name, layer] of this.layers) {
      const nextCanvas = document.createElement("canvas");
      nextCanvas.width = Math.round(this.width * this.dpr);
      nextCanvas.height = Math.round(this.height * this.dpr);
      const nextCtx = nextCanvas.getContext("2d");
      if (!nextCtx) {
        continue;
      }
      nextCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      nextCtx.imageSmoothingEnabled = true;
      nextCtx.drawImage(layer.canvas, 0, 0, this.width, this.height);
      this.layers.set(name, {
        canvas: nextCanvas,
        ctx: nextCtx,
        visible: layer.visible
      });
    }

    this.render();
  }

  getSnapshot() {
    return {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      drawCount: this.drawCount,
      currentBlendMode: this.currentBlendMode,
      currentBrushPreset: this.currentBrushPreset,
      layers: [...this.layers.entries()].map(([name, value]) => ({ name, visible: value.visible }))
    };
  }

  setBrushPreset(name: string) {
    if (DEFAULT_BRUSH_PRESETS[name]) {
      this.currentBrushPreset = name;
    }
    return this.currentBrushPreset;
  }

  getBrushPreset(name?: string): BrushPreset {
    const key = name && DEFAULT_BRUSH_PRESETS[name] ? name : this.currentBrushPreset;
    return DEFAULT_BRUSH_PRESETS[key] ?? DEFAULT_BRUSH_PRESETS.marker;
  }

  setBlendMode(mode: string) {
    const normalized = (mode || "source-over") as GlobalCompositeOperation;
    this.currentBlendMode = normalized;
    return this.currentBlendMode;
  }

  setLayerVisibility(layer: string, visible: boolean) {
    const target = this.ensureLayer(layer, true);
    target.visible = Boolean(visible);
    this.render();
  }

  clearLayer(layer: string) {
    const target = this.ensureLayer(layer, true);
    target.ctx.save();
    target.ctx.setTransform(1, 0, 0, 1, 0, 0);
    target.ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
    target.ctx.restore();
    this.drawCount += 1;
    this.render();
  }

  paintStroke(options: {
    layer?: string;
    points: StrokePoint[];
    preset?: string;
    color?: string;
    size?: number;
    opacity?: number;
    smoothing?: number;
    taper?: number;
    blendMode?: string;
  }) {
    const layer = this.ensureLayer(options.layer || "paint", true);
    const points = this.normalizePoints(options.points);
    if (points.length === 0) {
      return;
    }

    const preset = this.getBrushPreset(options.preset);
    const color = options.color || preset.color;
    const size = clamp(options.size ?? preset.size, 1, 120);
    const opacity = clamp(options.opacity ?? preset.opacity, 0.02, 1);
    const smoothing = clamp(options.smoothing ?? preset.smoothing, 0, 0.95);
    const taper = clamp(options.taper ?? preset.taper, 0, 0.98);
    const blend = (options.blendMode || this.currentBlendMode) as GlobalCompositeOperation;

    this.drawSmoothedStroke(layer.ctx, points, {
      size,
      opacity,
      color,
      smoothing,
      taper,
      blendMode: blend
    });

    this.drawCount += 1;
    this.render();
  }

  eraseStroke(options: {
    layer?: string;
    points: StrokePoint[];
    size?: number;
    opacity?: number;
    smoothing?: number;
    taper?: number;
  }) {
    this.paintStroke({
      layer: options.layer || "paint",
      points: options.points,
      color: "#000000",
      size: options.size ?? 14,
      opacity: options.opacity ?? 1,
      smoothing: options.smoothing ?? 0.65,
      taper: options.taper ?? 0.2,
      blendMode: "destination-out"
    });
  }

  paintPath(options: {
    layer?: string;
    points: StrokePoint[];
    closed?: boolean;
    preset?: string;
    color?: string;
    size?: number;
    opacity?: number;
    blendMode?: string;
  }) {
    const layer = this.ensureLayer(options.layer || "paint", true);
    const points = this.normalizePoints(options.points);
    if (points.length < 2) {
      return;
    }

    const preset = this.getBrushPreset(options.preset);
    const size = clamp(options.size ?? preset.size, 1, 120);

    layer.ctx.save();
    layer.ctx.globalAlpha = clamp(options.opacity ?? preset.opacity, 0.02, 1);
    layer.ctx.lineWidth = size;
    layer.ctx.strokeStyle = options.color || preset.color;
    layer.ctx.lineCap = "round";
    layer.ctx.lineJoin = "round";
    layer.ctx.globalCompositeOperation = (options.blendMode || this.currentBlendMode) as GlobalCompositeOperation;

    layer.ctx.beginPath();
    layer.ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      const prev = points[index - 1];
      const current = points[index];
      const cx = (prev.x + current.x) * 0.5;
      const cy = (prev.y + current.y) * 0.5;
      layer.ctx.quadraticCurveTo(prev.x, prev.y, cx, cy);
    }

    if (options.closed) {
      layer.ctx.closePath();
    }

    layer.ctx.stroke();
    layer.ctx.restore();

    this.drawCount += 1;
    this.render();
  }

  fillRegion(options: {
    layer?: string;
    x: number;
    y: number;
    color: string;
    tolerance?: number;
  }) {
    const layer = this.ensureLayer(options.layer || "paint", true);
    const targetColor = toRgba(options.color);
    if (!targetColor) {
      throw new Error("fill_region requires hex color like #RRGGBB or #RRGGBBAA");
    }

    const px = clamp(Math.round(options.x * this.dpr), 0, layer.canvas.width - 1);
    const py = clamp(Math.round(options.y * this.dpr), 0, layer.canvas.height - 1);
    const tolerance = clamp(Math.round((options.tolerance ?? 20) * 2.55), 0, 255);

    const image = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    const data = image.data;
    const startIndex = (py * layer.canvas.width + px) * 4;
    const start = [data[startIndex], data[startIndex + 1], data[startIndex + 2], data[startIndex + 3]];

    const isSimilar = (index: number) =>
      Math.abs(data[index] - start[0]) <= tolerance &&
      Math.abs(data[index + 1] - start[1]) <= tolerance &&
      Math.abs(data[index + 2] - start[2]) <= tolerance &&
      Math.abs(data[index + 3] - start[3]) <= tolerance;

    if (
      Math.abs(start[0] - targetColor[0]) <= tolerance &&
      Math.abs(start[1] - targetColor[1]) <= tolerance &&
      Math.abs(start[2] - targetColor[2]) <= tolerance &&
      Math.abs(start[3] - targetColor[3]) <= tolerance
    ) {
      return;
    }

    const queue: Array<[number, number]> = [[px, py]];
    const visited = new Uint8Array(layer.canvas.width * layer.canvas.height);

    while (queue.length > 0) {
      const [x, y] = queue.pop() as [number, number];
      const pointIndex = y * layer.canvas.width + x;
      if (visited[pointIndex]) {
        continue;
      }
      visited[pointIndex] = 1;

      const dataIndex = pointIndex * 4;
      if (!isSimilar(dataIndex)) {
        continue;
      }

      data[dataIndex] = targetColor[0];
      data[dataIndex + 1] = targetColor[1];
      data[dataIndex + 2] = targetColor[2];
      data[dataIndex + 3] = targetColor[3];

      if (x > 0) {
        queue.push([x - 1, y]);
      }
      if (x < layer.canvas.width - 1) {
        queue.push([x + 1, y]);
      }
      if (y > 0) {
        queue.push([x, y - 1]);
      }
      if (y < layer.canvas.height - 1) {
        queue.push([x, y + 1]);
      }
    }

    layer.ctx.putImageData(image, 0, 0);
    this.drawCount += 1;
    this.render();
  }

  sampleColor(x: number, y: number): string {
    if (!this.ctx) {
      return "#00000000";
    }

    const px = clamp(Math.round(x * this.dpr), 0, Math.max(0, this.canvas?.width ?? 1) - 1);
    const py = clamp(Math.round(y * this.dpr), 0, Math.max(0, this.canvas?.height ?? 1) - 1);
    const image = this.ctx.getImageData(px, py, 1, 1).data;
    const hex = [image[0], image[1], image[2], image[3]]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }

  getBoundingBoxes() {
    const boxes: Array<{ layer: string; x: number; y: number; width: number; height: number }> = [];

    for (const [name, layer] of this.layers) {
      const image = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height).data;
      let minX = layer.canvas.width;
      let minY = layer.canvas.height;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < layer.canvas.height; y += 1) {
        for (let x = 0; x < layer.canvas.width; x += 1) {
          const idx = (y * layer.canvas.width + x) * 4;
          if (image[idx + 3] > 0) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX >= minX && maxY >= minY) {
        boxes.push({
          layer: name,
          x: Math.round(minX / this.dpr),
          y: Math.round(minY / this.dpr),
          width: Math.round((maxX - minX + 1) / this.dpr),
          height: Math.round((maxY - minY + 1) / this.dpr)
        });
      }
    }

    return boxes;
  }

  private ensureLayer(name: string, visible: boolean): LayerRecord {
    const existing = this.layers.get(name);
    if (existing) {
      return existing;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(this.width * this.dpr);
    canvas.height = Math.round(this.height * this.dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create layer context");
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    const record = { canvas, ctx, visible };
    this.layers.set(name, record);
    return record;
  }

  private normalizePoints(input: StrokePoint[]): StrokePoint[] {
    if (!Array.isArray(input)) {
      return [];
    }

    return input
      .map((point) => ({
        x: clamp(Number(point?.x ?? 0), 0, this.width),
        y: clamp(Number(point?.y ?? 0), 0, this.height),
        pressure: clamp(Number(point?.pressure ?? 1), 0.1, 1)
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }

  private drawSmoothedStroke(
    ctx: CanvasRenderingContext2D,
    points: StrokePoint[],
    options: {
      size: number;
      opacity: number;
      color: string;
      smoothing: number;
      taper: number;
      blendMode: GlobalCompositeOperation;
    }
  ) {
    if (points.length === 1) {
      ctx.save();
      ctx.globalAlpha = options.opacity;
      ctx.fillStyle = options.color;
      ctx.globalCompositeOperation = options.blendMode;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, Math.max(0.5, options.size * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const smoothed = this.smoothPoints(points, options.smoothing);
    const segmentCount = Math.max(1, smoothed.length - 1);

    ctx.save();
    ctx.globalCompositeOperation = options.blendMode;
    ctx.strokeStyle = options.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = options.opacity;

    for (let index = 0; index < segmentCount; index += 1) {
      const from = smoothed[index];
      const to = smoothed[index + 1];
      const t = segmentCount <= 1 ? 0 : index / (segmentCount - 1);

      const fromPressure = from.pressure ?? 1;
      const toPressure = to.pressure ?? 1;
      const pressureFactor = clamp((fromPressure + toPressure) * 0.5, 0.1, 1);
      const taperFactor = 1 - options.taper * Math.abs(2 * t - 1);
      const width = Math.max(0.6, options.size * pressureFactor * taperFactor);

      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private smoothPoints(points: StrokePoint[], smoothing: number): StrokePoint[] {
    if (points.length < 3 || smoothing <= 0) {
      return points;
    }

    const result: StrokePoint[] = [points[0]];
    const weight = clamp(smoothing, 0, 0.95);

    for (let index = 1; index < points.length - 1; index += 1) {
      const prev = points[index - 1];
      const current = points[index];
      const next = points[index + 1];

      const x = current.x * (1 - weight) + ((prev.x + next.x) * 0.5) * weight;
      const y = current.y * (1 - weight) + ((prev.y + next.y) * 0.5) * weight;
      const pressure = clamp(
        (Number(prev.pressure ?? 1) + Number(current.pressure ?? 1) + Number(next.pressure ?? 1)) / 3,
        0.1,
        1
      );

      result.push({ x, y, pressure });
    }

    result.push(points[points.length - 1]);
    return result;
  }

  private render() {
    if (!this.ctx) {
      return;
    }

    this.ctx.save();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = "#081124";
    this.ctx.fillRect(0, 0, this.width, this.height);

    for (const layer of this.layers.values()) {
      if (!layer.visible) {
        continue;
      }
      this.ctx.drawImage(layer.canvas, 0, 0, this.width, this.height);
    }

    this.ctx.restore();
  }
}
