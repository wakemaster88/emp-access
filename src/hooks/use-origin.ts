import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Adresse der laufenden Cloud (z. B. https://tuttenbrocksee.emp-control.com); beim Server-Rendern leer. */
export function useOrigin(): string {
  return useSyncExternalStore(subscribe, () => window.location.origin, () => "");
}
