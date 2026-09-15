import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RuntimePaths {
  baseDir: string;
  databaseFile: string;
  artifactsDir: string;
  recordingsDir: string;
  screenshotsDir: string;
  tracesDir: string;
  logsDir: string;
  profilesDir: string;
}

/**
 * Resolves the local runtime paths that must live outside the repository.
 */
export function createRuntimePaths(
  appName = 'waypoint',
  homeDirectory = homedir()
): RuntimePaths {
  const baseDir = join(homeDirectory, `.${appName}`);
  const artifactsDir = join(baseDir, 'artifacts');

  return {
    baseDir,
    databaseFile: join(baseDir, 'app.db'),
    artifactsDir,
    recordingsDir: join(artifactsDir, 'recordings'),
    screenshotsDir: join(artifactsDir, 'screenshots'),
    tracesDir: join(artifactsDir, 'traces'),
    logsDir: join(artifactsDir, 'logs'),
    profilesDir: join(baseDir, 'profiles')
  };
}

/**
 * Ensures the runtime directory structure exists before opening the database.
 */
export function ensureRuntimeDirectories(paths: RuntimePaths): RuntimePaths {
  [
    paths.baseDir,
    paths.artifactsDir,
    paths.recordingsDir,
    paths.screenshotsDir,
    paths.tracesDir,
    paths.logsDir,
    paths.profilesDir
  ].forEach((directoryPath) => {
    mkdirSync(directoryPath, { recursive: true });
  });

  return paths;
}
