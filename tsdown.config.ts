import { defineConfig } from 'tsdown'

/**
 * Build the single plugin entry into `lib/` as ESM with declarations and
 * sourcemaps. The artifact is committed (Z3: git installs never run builds,
 * so the pinned tree must already contain `lib/`).
 *
 * Host packages (`@deepseek-ai/*`) are never bundled: the host supplies the
 * real implementations at runtime; the in-repo tests exercise the fail-soft
 * paths instead.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  outDir: 'lib',
  dts: true,
  sourcemap: true,
  clean: true,
  // tsdown defaults to `fixedExtension` on the node platform, which emits
  // `.mjs`; this package declares `type: module`, so emit plain `.js`/`.d.ts`
  // to match the frozen `main`/`types` contract (lib/index.js(.d.ts)).
  fixedExtension: false,
  neverBundle: [/^@deepseek-ai\//],
})
