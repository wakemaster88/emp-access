import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Die React-Compiler-Regeln aus eslint-config-next 16 melden im Bestand
    // etliche Stellen (setState im Effect, Date.now() im Render, Ref-Zugriff
    // beim Rendern). Das sind Refactorings, keine Bugs – als Warnung sichtbar,
    // aber CI bricht nicht. `rules-of-hooks` bleibt bewusst ein Fehler:
    // bedingt aufgerufene Hooks lassen React zur Laufzeit abstuerzen.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Lokale Teile: eigener Build, eigene Regeln (`webcams/eslint.config.mjs`),
    // im Vercel-Build ohnehin ausgeschlossen (siehe tsconfig `exclude`).
    "hub/**",
    "webcams/**",
  ]),
]);

export default eslintConfig;
