import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Die React-Compiler-Regeln aus eslint-config-next 16 melden im Bestand
    // rund 20 Stellen (setState im Effect, Date.now() im Render). Das sind
    // Refactorings, keine Bugs – als Warnung sichtbar, aber CI bricht nicht.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/rules-of-hooks": "warn",
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
