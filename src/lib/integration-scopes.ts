/**
 * Scopes der Integrations-Tokens (src/lib/integration-token.ts): welche
 * Methode auf welcher Route ein Scope erlaubt. Ohne Node-Abhaengigkeiten,
 * damit auch die Einstellungs-Karte im Browser die Liste nutzen kann.
 */

/** Routen, auf denen ein Integrations-Token gelten kann (Next-Pfadmuster). */
export type IntegrationRoute =
  | "/api/areas"
  | "/api/employees"
  | "/api/webhook/utilization"
  | "/api/lost-items"
  | "/api/lost-items/[id]"
  | "/api/lost-items/[id]/image";

type Grant = { method: string; route: IntegrationRoute };

/**
 * Feste Liste je Scope: Methode plus Route. Die Fundsachen-Rechte entsprechen
 * dem, was die Fundsachen-API mit Account-Token erlaubt.
 */
export const INTEGRATION_SCOPES = {
  "areas:read": [{ method: "GET", route: "/api/areas" }],
  "employees:read": [{ method: "GET", route: "/api/employees" }],
  "utilization:read": [{ method: "GET", route: "/api/webhook/utilization" }],
  "lost-items": [
    { method: "GET", route: "/api/lost-items" },
    { method: "POST", route: "/api/lost-items" },
    { method: "GET", route: "/api/lost-items/[id]" },
    { method: "PATCH", route: "/api/lost-items/[id]" },
    { method: "DELETE", route: "/api/lost-items/[id]" },
    { method: "GET", route: "/api/lost-items/[id]/image" },
  ],
} as const satisfies Record<string, readonly Grant[]>;

export type IntegrationScope = keyof typeof INTEGRATION_SCOPES;

export const INTEGRATION_SCOPE_IDS = Object.keys(INTEGRATION_SCOPES) as IntegrationScope[];

export const INTEGRATION_SCOPE_LABEL: Record<IntegrationScope, string> = {
  "areas:read": "Bereiche lesen",
  "employees:read": "Mitarbeiter lesen",
  "utilization:read": "Auslastung lesen",
  "lost-items": "Fundsachen",
};

export function isIntegrationScope(s: unknown): s is IntegrationScope {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(INTEGRATION_SCOPES, s);
}

/** HEAD behandelt Next wie GET. */
function normalizeMethod(method: string): string {
  const m = method.toUpperCase();
  return m === "HEAD" ? "GET" : m;
}

/**
 * Darf ein Token mit diesen Scopes `method` auf `route`? Unbekannte Scopes
 * zaehlen nicht; Scopes mit `:read` erlauben nie eine schreibende Methode.
 */
export function integrationScopeAllows(
  scopes: readonly string[],
  method: string,
  route: IntegrationRoute,
): boolean {
  const m = normalizeMethod(method);
  for (const scope of scopes) {
    if (!isIntegrationScope(scope)) continue;
    if (scope.endsWith(":read") && m !== "GET") continue;
    const grants: readonly Grant[] = INTEGRATION_SCOPES[scope];
    if (grants.some((g) => g.method === m && g.route === route)) return true;
  }
  return false;
}

/** Scopes aus einer Anfrage: nur bekannte, ohne Doppelte, in fester Reihenfolge. */
export function normalizeIntegrationScopes(input: readonly string[]): IntegrationScope[] {
  const set = new Set(input);
  return INTEGRATION_SCOPE_IDS.filter((s) => set.has(s));
}
