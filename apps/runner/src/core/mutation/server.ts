import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMutations, type MutationType } from './mutators.js';

export interface MutationServerOptions {
  port?: number;
  host?: string;
  fixturesDir?: string;
  seed?: string;
}

export interface MutationServer {
  server: http.Server;
  port: number;
  host: string;
  url: string;
  fixturesDir: string;
  start(): Promise<string>;
  stop(): Promise<void>;
}

export function resolveFixturesDir(customDir?: string): string {
  if (customDir && fs.existsSync(customDir)) {
    return path.resolve(customDir);
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidate1 = path.resolve(__dirname, '../../../../../tests/fixtures/demo-pages');
  if (fs.existsSync(candidate1)) return candidate1;
  const candidate2 = path.resolve(process.cwd(), 'tests/fixtures/demo-pages');
  if (fs.existsSync(candidate2)) return candidate2;
  return candidate1;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

export function createMutationServer(options: MutationServerOptions = {}): MutationServer {
  const host = options.host ?? '127.0.0.1';
  let port = options.port ?? 0;
  const fixturesDir = resolveFixturesDir(options.fixturesDir);
  const defaultSeed = options.seed ?? 'waypoint';

  let currentUrl = `http://${host}:${port}`;

  const server = http.createServer((req, res) => {
    try {
      const urlObj = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
      const rawMutations: string[] = [];

      for (const [key, value] of urlObj.searchParams.entries()) {
        if (key === 'mutation' || key === 'mutations') {
          rawMutations.push(...value.split(','));
        }
      }

      const seed = urlObj.searchParams.get('seed') ?? defaultSeed;
      const validTypes = new Set<string>(['cosmetic', 'attribute', 'structural']);
      const mutations: MutationType[] = rawMutations
        .map((m) => m.trim().toLowerCase())
        .filter((m): m is MutationType => validTypes.has(m));

      const pathname = decodeURIComponent(urlObj.pathname);

      // Root index of available fixture demo pages
      if (pathname === '/' || pathname === '/index.html') {
        if (!fs.existsSync(fixturesDir)) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain');
          res.end(`Fixtures directory not found: ${fixturesDir}`);
          return;
        }

        const files = fs
          .readdirSync(fixturesDir)
          .filter((f) => f.endsWith('.html'))
          .sort();

        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Waypoint Mutation Fixture Server</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 16px; line-height: 1.6; }
    h1 { color: #1e293b; }
    ul { list-style: none; padding: 0; }
    li { margin: 12px 0; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
    .title { font-weight: 600; font-size: 1.1em; margin-bottom: 6px; }
    .links a { display: inline-block; margin-right: 8px; padding: 4px 10px; border-radius: 4px; font-size: 0.85em; text-decoration: none; font-weight: 500; }
    .raw { background: #e2e8f0; color: #1e293b; }
    .cosmetic { background: #dbeafe; color: #1d4ed8; }
    .attribute { background: #fef3c7; color: #b45309; }
    .structural { background: #fce7f3; color: #be185d; }
    .all { background: #dcfce7; color: #15803d; }
  </style>
</head>
<body>
  <h1>Waypoint Mutation Fixture Server</h1>
  <p>Serving HTML test fixtures with programmatic AST-driven mutations for resilience benchmarking.</p>
  <ul>
    ${files
      .map(
        (file) => `
    <li>
      <div class="title">${file}</div>
      <div class="links">
        <a class="raw" href="/${file}">Original</a>
        <a class="cosmetic" href="/${file}?mutation=cosmetic">Cosmetic</a>
        <a class="attribute" href="/${file}?mutation=attribute">Attribute</a>
        <a class="structural" href="/${file}?mutation=structural">Structural</a>
        <a class="all" href="/${file}?mutation=cosmetic,attribute,structural">All Combined</a>
      </div>
    </li>`
      )
      .join('')}
  </ul>
</body>
</html>`;

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }

      // Sanitize requested file path
      const sanitized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      let targetPath = path.join(fixturesDir, sanitized);

      // Support omitting .html extension
      if (!fs.existsSync(targetPath) && !path.extname(sanitized)) {
        targetPath = path.join(fixturesDir, `${sanitized}.html`);
      }

      // Security: ensure targetPath is within fixturesDir
      const relative = path.relative(fixturesDir, targetPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end(`Fixture not found: ${pathname}`);
        return;
      }

      const ext = path.extname(targetPath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

      if (ext === '.html' || ext === '.htm') {
        const originalHtml = fs.readFileSync(targetPath, 'utf-8');
        let processedHtml = originalHtml;

        if (mutations.length > 0) {
          processedHtml = applyMutations(originalHtml, mutations, { seed });
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.setHeader('x-mutations-applied', mutations.join(','));
        res.end(processedHtml);
      } else {
        const fileContent = fs.readFileSync(targetPath);
        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.end(fileContent);
      }
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end(`Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  const mutationServer: MutationServer = {
    server,
    get port() {
      return port;
    },
    host,
    get url() {
      return currentUrl;
    },
    fixturesDir,
    start(): Promise<string> {
      return new Promise((resolve, reject) => {
        server.listen(port, host, () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            port = addr.port;
            currentUrl = `http://${host}:${port}`;
          }
          resolve(currentUrl);
        });
        server.once('error', reject);
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };

  return mutationServer;
}

export async function startMutationServer(options?: MutationServerOptions): Promise<MutationServer> {
  const server = createMutationServer(options);
  await server.start();
  return server;
}

// Support CLI direct run: tsx apps/runner/src/core/mutation/server.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cliPort = Number(process.env.PORT) || 8080;
  startMutationServer({ port: cliPort }).then((srv) => {
    console.log(`Waypoint Mutation Fixture Server running at ${srv.url}`);
    console.log(`Serving fixtures from: ${srv.fixturesDir}`);
  });
}
