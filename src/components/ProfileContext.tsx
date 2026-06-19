"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "budgeting.activeProfile";

interface ProfileContextValue {
  /** The currently active profile id, or "all" for no filter. */
  activeProfile: string;
  /** Set the active profile — persists to sessionStorage. */
  setActiveProfile: (id: string) => void;
}

const ProfileContext = createContext<ProfileContextValue>({
  activeProfile: "all",
  setActiveProfile: () => {},
});

function readFromStorage(): string {
  if (typeof window === "undefined") return "all";
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "all";
  } catch {
    return "all";
  }
}

export function ProfileProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeProfile, setActiveProfileRaw] = useState("all");

  // On mount, pull from sessionStorage. This ensures per-tab isolation.
  useEffect(() => {
    const stored = readFromStorage();
    if (stored !== activeProfile) {
      setActiveProfileRaw(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setActiveProfile = useCallback((id: string) => {
    setActiveProfileRaw(id);
    try {
      sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage full or unavailable
    }
  }, []);

  return (
    <ProfileContext.Provider value={{ activeProfile, setActiveProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

/**
 * Read the active profile from context. Works in any client component.
 *
 * Returns `{ activeProfile, setActiveProfile }`.
 * `activeProfile` is "all" when no specific profile is selected.
 */
export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext);
}
