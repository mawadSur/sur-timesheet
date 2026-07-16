import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Mirror tsconfig's "@/*" -> "./*" path alias so `@/lib/...` imports resolve
  // deterministically (no vite-tsconfig-paths plugin, no reliance on a warm cache).
  resolve: {
    alias: [{ find: /^@\//, replacement: `${root}/` }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Fixed 32-byte key (64 hex chars) so crypto tests are deterministic.
    env: {
      CREDS_ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  },
});
