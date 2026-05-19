import { existsSync, mkdirSync } from 'fs';

export function isRailwayHost() {
  return !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}

export function hasRailwayVolume() {
  return !!process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
}

/** Dossier persistant : volume Railway, sinon /tmp (éphémère → utiliser cloud-persist). */
export function railwayDataDir() {
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (mount) return mount.replace(/\/$/, '');
  if (isRailwayHost()) return '/tmp/bundle-tracker';
  return null;
}

function envPathIgnoredOnRailway(fromEnv) {
  if (!fromEnv || !isRailwayHost() || hasRailwayVolume()) return false;
  const p = fromEnv.replace(/\\/g, '/');
  if (!p.includes('/data')) return false;
  const hasRedis =
    !!(process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || '').trim() ||
    !!(process.env.CLOUD_SYNC_SECRET || '').trim();
  return hasRedis;
}

/** Chemin fichier : env > volume Railway > /tmp Railway > local dev. */
export function resolvePersistPath(filename, envVarName, localAbsolutePath) {
  let fromEnv = process.env[envVarName]?.trim();
  if (fromEnv && envPathIgnoredOnRailway(fromEnv)) {
    console.warn(
      `⚠ ${envVarName}=${fromEnv} ignoré (pas de volume) — wallets via Redis REDIS_URL`,
    );
    fromEnv = '';
  }
  if (fromEnv) return fromEnv;
  const dir = railwayDataDir();
  if (dir) return `${dir}/${filename}`;
  return localAbsolutePath;
}

export function ensureRailwayDataDir() {
  const dir = railwayDataDir();
  if (!dir) return;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const vol = process.env.RAILWAY_VOLUME_NAME?.trim();
    console.log(
      `📁 Données → ${dir}` +
        (vol
          ? ` (volume « ${vol} »)`
          : ' (temporaire — wallets gardés dans Redis si REDIS_URL + CLOUD_SYNC_SECRET)'),
    );
  } catch (e) {
    console.warn(`⚠ Impossible de créer ${dir} — attache un volume Railway`, e.message);
  }
}
