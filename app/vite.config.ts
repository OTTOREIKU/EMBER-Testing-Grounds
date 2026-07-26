import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Stamped into the bundle and written to version.json. The running page polls that file and offers
// a reload when the two stop matching, which is how a visitor finds out a new deploy exists.
const BUILD_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

// Every image under ../assets, as paths relative to the assets root. The preloader fetches this
// so "warm everything" cannot silently miss a folder someone adds later.
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

// Serve ../data and ../assets (which live outside the app root) at /data and /assets.
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
        for (const [prefix, dir] of Object.entries(map)) {
          if (url.startsWith(prefix)) {
            const file = path.join(dir, url.slice(prefix.length));
            // stay inside the mapped directory
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

// The dev middleware above only exists while `vite` is running, so a production build has to
// copy ../data and ../assets into dist itself or the published site loads with no cards.
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
      // GitHub Pages runs Jekyll unless told not to, which skips files starting with _
      fs.writeFileSync(path.resolve(here, outDir, '.nojekyll'), '');
    },
  };
}

export default defineConfig({
  // relative base so the build works from a user site, a project subpath or a local file
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
    // Vite's own chunks go here, NOT the default "assets", which would collide with the
    // game's assets/ directory copied in above and get wiped by it.
    assetsDir: 'build',
    // two entry points: the tabletop and the phone-friendly reference page
    rollupOptions: {
      input: {
        main: path.resolve(here, 'index.html'),
        reference: path.resolve(here, 'reference.html'),
      },
    },
  },
});
