import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import type { Frame, Locator } from 'playwright';
import type { ElementSnapshot } from '@waypoint/shared-types';

let bundle: string | undefined;
export function snapshotBundle(): string {
  bundle ??= buildSync({
    entryPoints: [
      createRequire(import.meta.url).resolve('@waypoint/shared-types/dom-snapshot'),
    ],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'WaypointDOM',
    platform: 'browser',
  }).outputFiles[0]!.text;
  return bundle;
}
export async function installFeatures(frame: Frame): Promise<void> {
  await frame.evaluate(snapshotBundle() + ';window.WaypointDOM=WaypointDOM;');
}
export async function snapshotElement(
  locator: Locator,
  capture = false
): Promise<ElementSnapshot> {
  return locator.evaluate((el, capture) => {
    const api = (
      window as unknown as {
        WaypointDOM: {
          captureSnapshot(el: Element): ElementSnapshot;
          captureFeatures(el: Element): ElementSnapshot;
        };
      }
    ).WaypointDOM;
    return capture ? api.captureSnapshot(el) : api.captureFeatures(el);
  }, capture);
}
