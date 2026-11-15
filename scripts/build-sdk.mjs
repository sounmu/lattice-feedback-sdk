// Builds what customer pages load: public/sdk.js, the file of the one script tag, and the capture runtime
// that sdk.js imports from public/sdk/ once the reporter needs it. Run it with `npm run build:sdk`.
import { readFile, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { build } from 'esbuild';

const RUNTIME_DIRECTORY = 'public/sdk';
// sdk.js is loaded by every page view of every customer. It holds the launcher, the bridge to the widget
// and the loader, about 22 KB. Much more means a capture module is imported from it by mistake.
const MAX_ENTRY_BYTES = 32 * 1024;
// These keep state that the entry and the runtime must share, so they may exist in the runtime only.
const RUNTIME_ONLY_MODULES = ['src/sdk/static-text-index.ts', 'src/sdk/capture-controller.ts'];
const RRWEB_SNAPSHOT_FILE = /rrweb-snapshot[\\/]dist[\\/]rrweb-snapshot\.js$/;

// rrweb-snapshot ships as one file that also holds its replay half, which needs postcss. Saving a screen
// never calls that half, but the file reads postcss at its top level, so a bundler has to keep all of
// postcss and the page has to run it on load. These edits wrap the two reads in calls marked as free of
// side effects, and the bare property reads after them are removed. Nothing the SDK uses refers to
// postcss then, so it is left out with the rest of the unused replay code.
const LAZY_POSTCSS_EDITS = [
  ['var import_postcss = /* @__PURE__ */ __toESM((', 'var import_postcss = /* @__PURE__ */ (() => __toESM(('],
  [
    '})))(), 1);\nvar postcss_default = import_postcss.default;',
    '})))(), 1))();\nvar postcss_default = /* @__PURE__ */ (() => import_postcss.default)();',
  ],
];
const POSTCSS_PROPERTY_READ = /^import_postcss\.default\.\w+;\n/gm;

const dropUnusedPostcss = {
  name: 'drop-unused-postcss',
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: RRWEB_SNAPSHOT_FILE }, async ({ path }) => {
      let source = await readFile(path, 'utf8');
      for (const [original, lazy] of LAZY_POSTCSS_EDITS) {
        if (!source.includes(original)) {
          throw new Error(
            `rrweb-snapshot no longer contains "${original}". Update or remove dropUnusedPostcss in scripts/build-sdk.mjs.`,
          );
        }
        source = source.replace(original, lazy);
      }
      return { contents: source.replace(POSTCSS_PROPERTY_READ, ''), loader: 'js' };
    });
  },
};

const sharedOptions = { bundle: true, minify: true, target: 'es2019', logLevel: 'info', metafile: true };

// A runtime left from an earlier build would be deployed next to the one sdk.js asks for.
await rm(RUNTIME_DIRECTORY, { recursive: true, force: true });
// The runtime is a module, because a script can import one from another origin without adding an element
// to the customer's page. The hash in its name comes from its content, so it can be cached for good.
const runtime = await build({
  ...sharedOptions,
  entryPoints: { 'capture-runtime': 'src/sdk/capture-runtime.ts' },
  outdir: RUNTIME_DIRECTORY,
  entryNames: '[name]-[hash]',
  format: 'esm',
  plugins: [dropUnusedPostcss],
});
const [runtimeFile] = Object.keys(runtime.metafile.outputs);

// The next deploy replaces the runtime file, so a page that loaded sdk.js before it asks the app for a file
// it no longer has. On Vercel, sdk.js therefore names the deployment that built it and asks that one for
// the runtime (src/sdk/runtime-loader.ts). Vercel follows this only while Skew Protection is on for the
// project, the deployment is within its maximum age, and the customer's domain is one of the project's
// Allowed Domains for Cross-Site Fetch. Built anywhere else, sdk.js asks without it.
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || null;

const entry = await build({
  ...sharedOptions,
  entryPoints: ['src/sdk/index.ts'],
  outfile: 'public/sdk.js',
  format: 'iife',
  define: {
    __LATTICE_CAPTURE_RUNTIME_PATH__: JSON.stringify(`/sdk/${basename(runtimeFile)}`),
    __LATTICE_DEPLOYMENT_ID__: JSON.stringify(deploymentId),
  },
});

const misplacedModules = RUNTIME_ONLY_MODULES.filter((file) => file in entry.metafile.inputs);
if (misplacedModules.length > 0) {
  throw new Error(`public/sdk.js bundles ${misplacedModules.join(', ')}. Reach them through src/sdk/capture-runtime.ts.`);
}
const entryBytes = entry.metafile.outputs['public/sdk.js'].bytes;
if (entryBytes > MAX_ENTRY_BYTES) {
  throw new Error(`public/sdk.js is ${entryBytes} bytes, over the ${MAX_ENTRY_BYTES} it may be. Load capture code through the runtime.`);
}
