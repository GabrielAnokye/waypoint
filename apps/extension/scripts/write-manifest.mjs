import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const extensionRoot = process.cwd();
const packageJsonPath = resolve(extensionRoot, 'package.json');
const outputDir = resolve(extensionRoot, 'dist');
const manifestPath = resolve(outputDir, 'manifest.json');

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

const manifest = {
  manifest_version: 3,
  name: 'Waypoint',
  version: packageJson.version,
  description: 'Local-first browser automation scaffold.',
  permissions: ['activeTab', 'alarms', 'nativeMessaging', 'scripting', 'sidePanel', 'storage', 'tabs'],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'scripts/service-worker.js'
  },
  action: {
    default_title: 'Waypoint'
  },
  side_panel: {
    default_path: 'sidepanel.html'
  }
};

await mkdir(outputDir, { recursive: true });
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
