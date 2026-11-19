import { defineConfig } from 'tsdown'

/**
 * Build 1/2 (main): the plugin entry into `lib/` as ESM with declarations and
 * sourcemaps. The artifact is committed (Z3: git installs never run builds, so
 * the pinned tree must already contain `lib/`). Host packages are never
 * bundled (the host supplies real implementations at runtime).
 *
 * Build 2/2 (client): the browser fiber into `dist/client.cjs` as a classic
 * script consumed by the global module loader. The loader calls
 * `factory(require)` with ONE argument and takes the RETURN VALUE as exports;
 * the banner builds its own `module`/`exports` scaffold (Z1: the legacy
 * `factory(require, module, exports)` three-arg form crashes boot because the
 * loader never passes those params). The banner id MUST equal the package name
 * `dsh-zcontext` — the boot-graph row id (handshake, AutoPilot TC-B3-33E).
 */
const CLIENT_LOADER_ID = 'dsh-zcontext' // === package.json name (loader handshake)

export default defineConfig([
  {
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
    deps: {
      neverBundle: [/^@deepseek-ai\//],
    },
  },
  {
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    minify: false,
    sourcemap: false,
    dts: false,
    deps: {
      neverBundle: [/^@deepseek-ai\//, /^react($|\/)/, /^react-dom($|\/)/],
    },
    // Single-arg factory contract (Z1) + self-built module scaffold. The
    // package name id is a literal kept in lockstep with package.json (name)
    // and asserted by scripts/assert-client-banner-handshake.mjs.
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_LOADER_ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n`,
    // ZCTX-UI B6 P0: close THREE scopes — the arrow-function body `}`, the
    // load() argument object `}`, then `);` for the call. The previous footer
    // had only ONE `}` so the factory body stayed open → `node --check` failed
    // with "Unexpected token ')'" → the script never registered its factory →
    // loader reported "loaded without registering dsh-zcontext". AutoPilot's
    // working footer is `return module.exports; } });` (two braces); match it.
    footer: `return module.exports; } });`,
  },
])
