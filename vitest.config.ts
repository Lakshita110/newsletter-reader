import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the "@/*" tsconfig path alias natively (no plugin needed).
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
});
