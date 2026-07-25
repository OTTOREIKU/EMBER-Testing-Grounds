import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

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
      // GitHub Pages runs Jekyll unless told not to, which skips files starting with _
      fs.writeFileSync(path.resolve(here, outDir, '.nojekyll'), '');
    },
  };
}

export default defineConfig({
  // relative base so the build works from a user site, a project subpath or a local file
  base: './',
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
