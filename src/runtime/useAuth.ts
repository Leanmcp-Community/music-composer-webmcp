import { useCallback, useEffect, useRef, useState } from "react";

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  idToken: string;
  refreshToken: string;
  tokenExpiry: number;
}

const AUTH_STORAGE_KEY = "webmcp_auth";
const AUTH_ORIGIN = "https://auth.leanmcp.com";

function saveAuth(user: AuthUser) {
  try {
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

function loadAuth(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as AuthUser;
    if (Date.now() >= user.tokenExpiry) return null;
    return user;
  } catch {
    return null;
  }
}

function clearAuth() {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => loadAuth());
  const popupRef = useRef<Window | null>(null);
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  const removeListener = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener("message", listenerRef.current);
      listenerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      removeListener();
    };
  }, [removeListener]);

  const login = useCallback(() => {
    removeListener();

    const redirectUrl = `${window.location.origin}${window.location.pathname}`;
    const authUrl = `${AUTH_ORIGIN}?redirect=${encodeURIComponent(redirectUrl)}`;

    const width = 480;
    const height = 600;
    const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - height) / 2);

    const popup = window.open(
      authUrl,
      "leanmcp_auth",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    popupRef.current = popup;

    const handler = (event: MessageEvent) => {
      if (event.origin !== AUTH_ORIGIN) return;
      if (!event.data || event.data.type !== "AUTH_SUCCESS") return;

      const { idToken, refreshToken, expiry, userInfo } = event.data as {
        idToken: string;
        refreshToken: string;
        expiry: number;
        userInfo: { uid: string; email: string | null; displayName: string | null; photoURL: string | null };
      };

      const authed: AuthUser = {
        uid: userInfo.uid,
        email: userInfo.email,
        displayName: userInfo.displayName,
        photoURL: userInfo.photoURL,
        idToken,
        refreshToken,
        tokenExpiry: expiry,
      };

      saveAuth(authed);
      setUser(authed);
      removeListener();
      popupRef.current?.close();
      popupRef.current = null;
    };

    listenerRef.current = handler;
    window.addEventListener("message", handler);
  }, [removeListener]);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);

    const logoutUrl = `${AUTH_ORIGIN}?logout=true`;
    window.open(logoutUrl, "_blank", "width=400,height=300");
  }, []);

  const getToken = useCallback((): string | null => {
    if (!user) return null;
    if (Date.now() >= user.tokenExpiry) {
      clearAuth();
      setUser(null);
      return null;
    }
    return user.idToken;
  }, [user]);

  return { user, login, logout, getToken };
}
