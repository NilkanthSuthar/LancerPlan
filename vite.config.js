import { defineConfig } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(import.meta.dirname, 'data');
const dataFiles = () => readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));

// Serve data/*.json at <base>data/ in dev and copy it into the build.
// (data/raw/ holds the source PDFs and is deliberately not published.)
function timetableData() {
  return {
    name: 'timetable-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url.match(/\/data\/([\w.-]+\.json)(\?.*)?$/);
        if (!m || !dataFiles().includes(m[1])) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(join(DATA_DIR, m[1])));
      });
    },
    generateBundle() {
      for (const f of dataFiles()) {
        this.emitFile({ type: 'asset', fileName: `data/${f}`, source: readFileSync(join(DATA_DIR, f)) });
      }
    },
  };
}

export default defineConfig({
  base: '/LancerPlan/',
  plugins: [timetableData()],
  test: { include: ['src/**/*.test.js'] },
});
