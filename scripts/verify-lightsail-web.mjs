import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = () => { throw new Error('AWS_WEB_BOUNDARY_INVALID'); };
const requireSafe = (condition) => { if (!condition) fail(); };

export function validateAwsWebCompose(config) {
  requireSafe(config?.name === 'masscom');
  const services = config.services ?? {};
  requireSafe(['api', 'postgres', 'caddy', 'production-web'].every((name) => Boolean(services[name])));
  for (const name of ['api', 'postgres', 'production-web']) {
    requireSafe((services[name].ports ?? []).length === 0);
    requireSafe(services[name].security_opt?.includes('no-new-privileges:true'));
  }
  const web = services['production-web'];
  requireSafe(web.read_only === true);
  requireSafe((web.expose ?? []).map(String).includes('4173'));
  requireSafe(/^masscom-production-web:(local|[0-9a-f]{7,40})$/.test(web.image ?? ''));
  requireSafe(Object.keys(web.environment ?? {}).sort().join(',') ===
    ['MASSCOM_WEB_BIND_HOST', 'NODE_ENV', 'PORT'].sort().join(','));
  requireSafe(web.environment.NODE_ENV === 'production' && web.environment.PORT === '4173');
  requireSafe(web.environment.MASSCOM_WEB_BIND_HOST === '0.0.0.0');
  const caddy = services.caddy;
  requireSafe(caddy.security_opt?.includes('no-new-privileges:true'));
  const ports = (caddy.ports ?? []).map((port) => Number(port.published));
  requireSafe(ports.includes(80) && ports.includes(443));
  const mounts = caddy.volumes ?? [];
  const siteMount = mounts.find((volume) => volume.target === '/srv/masscom');
  requireSafe(siteMount?.type === 'bind' && siteMount.read_only === true &&
    siteMount.source?.endsWith('/site/public'));
  const configMount = mounts.find((volume) => volume.target === '/etc/caddy/Caddyfile');
  requireSafe(configMount?.type === 'bind' && configMount.read_only === true);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const rendered = execFileSync('docker', [
      'compose', '-f', resolve(repoRoot, 'infra/lightsail/compose.yml'), 'config', '--format', 'json',
    ], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        POSTGRES_PASSWORD: 'test-only-postgres-password',
        GOOGLE_OAUTH_CLIENT_IDS: '123-demo.apps.googleusercontent.com',
        ACCOUNT_DELETION_HMAC_SECRET: 'test-only-deletion-secret-at-least-32-bytes',
        MERCHANT_REFERENCE_HMAC_SECRET: 'test-only-reference-secret-at-least-32-bytes',
      },
    });
    validateAwsWebCompose(JSON.parse(rendered));
    console.log('AWS web Compose boundary verified (not deployed)');
  } catch {
    console.error('AWS_WEB_BOUNDARY_INVALID');
    process.exitCode = 1;
  }
}
