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

  interface Window {
    lmcp?: {
      track: (toolName: string) => void;
      hasCredits: () => boolean;
      balance: () => number | null;
      showCreditsModal: () => void;
      refresh: () => void;
    };
    firebase?: {
      auth: () => {
        onAuthStateChanged: (cb: (user: FirebaseBridgeUser | null) => void) => () => void;
        currentUser: FirebaseBridgeUser | null;
      };
    };
  }

  interface FirebaseBridgeUser {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    getIdToken: (forceRefresh?: boolean) => Promise<string>;
  }
}

export {};
