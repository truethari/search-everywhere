// esbuild bundler for the OmniSearch extension.
// Bundles src/extension.ts -> dist/extension.js as a CommonJS Node module,
// keeping the `vscode` module external (provided by the host at runtime).
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    sourcemap: !production,
    minify: production,
    logLevel: 'info'
  });

  if (watch) {
    await ctx.watch();
    console.log('[esbuild] watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
