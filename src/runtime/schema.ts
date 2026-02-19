import type { ModelContextTool, SchemaProperty, ToolInputSchema } from "../types";

export interface NormalizedTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: {
    readOnlyHint?: boolean;
  };
  execute: ModelContextTool["execute"];
}

function normalizeProperty(input: SchemaProperty | undefined): SchemaProperty {
  if (!input || typeof input !== "object") {
    return { type: "string" };
  }

  const type = input.type;
  if (!type || !["string", "number", "integer", "boolean", "array", "object"].includes(type)) {
    return { type: "string", description: input.description };
  }

  const normalized: SchemaProperty = {
    type,
    description: input.description
  };

  if (Array.isArray(input.enum) && input.enum.length > 0) {
    normalized.enum = input.enum.filter(
      (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    );
  }

  if (type === "array") {
    normalized.items = normalizeProperty(input.items);
  }

  return normalized;
}

export function normalizeInputSchema(schema: Partial<ToolInputSchema> | undefined): ToolInputSchema {
  const rawProperties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
  const propertyEntries = Object.entries(rawProperties)
    .map(([key, value]) => [key, normalizeProperty(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  const properties = Object.fromEntries(propertyEntries);

  const required = Array.isArray(schema?.required)
    ? schema.required.filter((key): key is string => typeof key === "string" && key in properties)
    : [];

  return {
    type: "object",
    properties,
    required: [...required].sort((a, b) => a.localeCompare(b))
  };
}

export function normalizeTool(tool: ModelContextTool): NormalizedTool {
  return {
    name: String(tool.name || "").trim(),
    description: String(tool.description || ""),
    inputSchema: normalizeInputSchema(tool.inputSchema),
    annotations: tool.annotations,
    execute: tool.execute
  };
}

export function normalizeTools(tools: ModelContextTool[]): NormalizedTool[] {
  return tools
    .map(normalizeTool)
    .filter((tool) => tool.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function coercePrimitive(type: SchemaProperty["type"], value: unknown): unknown {
  if (type === "string") {
    return value == null ? "" : String(value);
  }

  if (type === "number" || type === "integer") {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) {
      return 0;
    }
    return type === "integer" ? Math.round(num) : num;
  }

  if (type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value.toLowerCase() === "true";
    }
    return Boolean(value);
  }

  return value;
}

export function coerceArgsToSchema(
  args: Record<string, unknown>,
  schema: ToolInputSchema
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const source = args && typeof args === "object" ? args : {};

  for (const [name, prop] of Object.entries(schema.properties)) {
    const raw = source[name];

    if (raw === undefined) {
      continue;
    }

    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      output[name] = prop.enum.includes(raw as never) ? raw : prop.enum[0];
      continue;
    }

    if (prop.type === "array") {
      if (Array.isArray(raw)) {
        const itemType = prop.items?.type;
        output[name] = itemType
          ? raw.map((item) => coercePrimitive(itemType, item))
          : raw;
      } else {
        output[name] = [];
      }
      continue;
    }

    if (prop.type === "object") {
      output[name] = typeof raw === "object" && raw !== null ? raw : {};
      continue;
    }

    output[name] = coercePrimitive(prop.type, raw);
  }

  for (const requiredField of schema.required) {
    if (output[requiredField] !== undefined) {
      continue;
    }

    const requiredProp = schema.properties[requiredField];
    if (!requiredProp) {
      continue;
    }

    if (Array.isArray(requiredProp.enum) && requiredProp.enum.length > 0) {
      output[requiredField] = requiredProp.enum[0];
    } else {
      output[requiredField] = coercePrimitive(requiredProp.type, undefined);
    }
  }

  return output;
}
