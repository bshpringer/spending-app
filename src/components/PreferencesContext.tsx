"use client";

import { createContext, useContext } from "react";

/**
 * Client-side mirror of the app preferences that UI defaults care about. Read
 * server-side in the root layout (from prefsRepo) and provided here so any
 * client component can read a default without prop-threading through every
 * page. Today it only carries the hide-excluded default; add fields as needed.
 */
export interface ClientPreferences {
  hideExcludedByDefault: boolean;
}

const DEFAULTS: ClientPreferences = { hideExcludedByDefault: false };

const PreferencesContext = createContext<ClientPreferences>(DEFAULTS);

export function PreferencesProvider({
  value,
  children,
}: {
  value: ClientPreferences;
  children: React.ReactNode;
}) {
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): ClientPreferences {
  return useContext(PreferencesContext);
}
