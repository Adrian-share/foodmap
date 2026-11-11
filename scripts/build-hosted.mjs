import {build} from 'esbuild';
import {mkdir, readFile, copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
execFileSync(process.execPath,['scripts/build-content.cjs'],{stdio:'inherit'});
const manifest = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
if (!manifest.project_id || manifest.static) throw Error('请先配置 Worker Site 的 project_id');
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {encoding: 'utf8'})
  .trim().split('\n').filter(path => /^(beijing-food-map\/|deployment\/|scripts\/|content\/|data\/|nearby\.cjs$|samples\.js$|package(-lock)?\.json$)/.test(path)&&!/^content\/(sources|reference-images|review-frames)\//.test(path));
const hash = createHash('sha256');
for (const path of tracked.sort()) hash.update(path).update(await readFile(path));
const release = hash.digest('hex').slice(0, 16);
await mkdir('dist/server', {recursive: true});
await mkdir('dist/.openai', {recursive: true});
await build({
  entryPoints: ['deployment/worker.mjs'], outfile: 'dist/server/index.js', bundle: true,
  platform: 'browser', format: 'esm', target: 'es2022',
  define: {FOODMAP_RELEASE: JSON.stringify(release)},
  loader: {'.html': 'text'},
  plugins: [{name: 'raw-assets', setup(builder) {
    builder.onResolve({filter: /\?raw$/}, args => ({path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw-assets'}));
    builder.onLoad({filter: /.*/, namespace: 'raw-assets'}, async args => ({contents: await readFile(args.path, 'utf8'), loader: 'text'}));
  }}]
});
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log(JSON.stringify({release, output: 'dist/server/index.js'}));
