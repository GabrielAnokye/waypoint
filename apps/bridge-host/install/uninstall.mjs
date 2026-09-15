import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';

const paths = {
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

const manifestPath = paths[process.platform];
if (!manifestPath) {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

if (existsSync(manifestPath)) {
  unlinkSync(manifestPath);
  console.log(`Removed: ${manifestPath}`);
} else {
  console.log(`Not found (already uninstalled): ${manifestPath}`);
}
