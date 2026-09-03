import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `tsconfig.json` laisse `jsx: "preserve"` : c'est le compilateur de Next qui transforme.
  // En test c'est oxc (le transformeur de Vite 8) qui s'en charge, avec le runtime
  // automatique — sans toucher au tsconfig que Next exige.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // `server-only` refuse d'être importé hors d'un contexte serveur React.
      // En test on le neutralise : la garde est vérifiée par le build, pas ici.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: [
        "app/**/*.{ts,tsx}",
        "lib/**/*.ts",
        "components/**/*.tsx",
        "middleware.ts",
      ],
      reporter: ["text", "lcov"],
    },
  },
});
