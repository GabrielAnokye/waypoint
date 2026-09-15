import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const extIdIndex = args.indexOf('--extension-id');
if (extIdIndex === -1 || !args[extIdIndex + 1]) {
  console.error('Usage: node install.mjs --extension-id <chrome-extension-id>');
  process.exit(1);
}
const extensionId = args[extIdIndex + 1];

const template = readFileSync(
  resolve(__dirname, 'com.waypoint.bridge.template.json'),
  'utf-8'
);

const launcherExt = process.platform === 'win32' ? 'launcher.cmd' : 'launcher.sh';
const launcherPath = resolve(__dirname, launcherExt);

const manifest = template
  .replace('<ABSOLUTE_PATH_TO_HOST_LAUNCHER>', launcherPath.replace(/\\/g, '\\\\'))
  .replace('<EXTENSION_ID>', extensionId);

const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';

const installPaths = {
  darwin: resolve(
    homeDir,
    'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.waypoint.bridge.json'
  ),
  linux: resolve(
    homeDir,
    '.config/google-chrome/NativeMessagingHosts/com.waypoint.bridge.json'
  ),
  win32: resolve(
    process.env.LOCALAPPDATA ?? '',
    'Waypoint/com.waypoint.bridge.json'
  )
};

const installPath = installPaths[process.platform];
if (!installPath) {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

mkdirSync(dirname(installPath), { recursive: true });
writeFileSync(installPath, manifest);
console.log(`Manifest written to: ${installPath}`);

if (process.platform !== 'win32') {
  chmodSync(launcherPath, 0o755);
  console.log(`Launcher marked executable: ${launcherPath}`);
}

// Verify manifest is readable.
if (existsSync(installPath)) {
  console.log('Installation verified.');
} else {
  console.error('Installation failed — manifest file not found after write.');
  process.exit(1);
}
