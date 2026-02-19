import type { ModelContextTool } from "./types";

declare global {
  interface Navigator {
    modelContext?: {
      _tools?: ModelContextTool[];
      provideContext?: (options: { tools: ModelContextTool[] }) => void;
      registerTool?: (tool: ModelContextTool) => void;
      unregisterTool?: (name: string) => void;
      clearContext?: () => void;
    };
  }
}

export {};
