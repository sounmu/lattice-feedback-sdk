// Builds the SDK file that customer pages load with one script tag. Run it with `npm run build:sdk`.
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

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

await build({
  entryPoints: ['src/sdk/index.ts'],
  outfile: 'public/sdk.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  logLevel: 'info',
  plugins: [dropUnusedPostcss],
});
