import { existsSync, mkdirSync } from 'fs';

export function isRailwayHost() {
  return !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}

/** Chemin fichier : env explicite > /data sur Railway > chemin local dev. */
export function resolvePersistPath(filename, envVarName, localAbsolutePath) {
  const fromEnv = process.env[envVarName];
  if (fromEnv?.trim()) return fromEnv.trim();
  if (isRailwayHost()) return `/data/${filename}`;
  return localAbsolutePath;
}

export function ensureRailwayDataDir() {
  if (!isRailwayHost()) return;
  const dir = '/data';
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    console.log('📁 Données persistantes → /data (volume Railway obligatoire)');
  } catch (e) {
    console.warn('⚠ Impossible de créer /data — ajoute un volume Railway', e.message);
  }
}
