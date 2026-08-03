import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const BUILD_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function assetManifest(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else if (/\.(webp|png|jpe?g|svg|avif)$/i.test(e.name)) out.push(rel);
    }
  };
  walk(dir, '');
  return out.sort();
}

function dataManifest(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== 'manifest.json')
    .map((e) => e.name)
    .sort();
}

function staticDirs(map: Record<string, string>): Plugin {
  const mime: Record<string, string> = {
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  return {
    name: 'ember-static-dirs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (url === '/assets/manifest.json' && map['/assets/']) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ images: assetManifest(map['/assets/']) }));
          return;
        }
        if (url === '/data/manifest.json' && map['/data/']) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ files: dataManifest(map['/data/']) }));
          return;
        }
        for (const [prefix, dir] of Object.entries(map)) {
          if (url.startsWith(prefix)) {
            const file = path.join(dir, url.slice(prefix.length));
            if (!file.startsWith(path.resolve(dir))) break;
            if (fs.existsSync(file) && fs.statSync(file).isFile()) {
              res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
              fs.createReadStream(file).pipe(res);
              return;
            }
          }
        }
        next();
      });
    },
  };
}

function copyDataAndAssets(map: Record<string, string>): Plugin {
  let outDir = 'dist';
  return {
    name: 'ember-copy-static',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    closeBundle() {
      for (const [name, dir] of Object.entries(map)) {
        const dest = path.resolve(here, outDir, name);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(dir, dest, { recursive: true });
      }
      fs.writeFileSync(
            path.resolve(here, outDir, 'version.json'),
            JSON.stringify({ build: BUILD_ID }),
          );
      const assetsOut = path.resolve(here, outDir, 'assets');
      if (fs.existsSync(assetsOut)) {
        fs.writeFileSync(
          path.resolve(assetsOut, 'manifest.json'),
          JSON.stringify({ images: assetManifest(assetsOut) }),
        );
      }
      const dataOut = path.resolve(here, outDir, 'data');
      if (fs.existsSync(dataOut)) {
        fs.writeFileSync(
          path.resolve(dataOut, 'manifest.json'),
          JSON.stringify({ files: dataManifest(dataOut) }),
        );
      }
      fs.writeFileSync(path.resolve(here, outDir, '.nojekyll'), '');
    },
  };
}

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    staticDirs({
      '/data/': path.resolve(here, '../data'),
      '/assets/': path.resolve(here, '../assets'),
    }),
    copyDataAndAssets({
      data: path.resolve(here, '../data'),
      assets: path.resolve(here, '../assets'),
    }),
  ],
  build: {
    assetsDir: 'build',
    rollupOptions: {
      input: {
        main: path.resolve(here, 'index.html'),
        reference: path.resolve(here, 'reference.html'),
        match: path.resolve(here, 'match.html'),
      },
    },
  },
});
