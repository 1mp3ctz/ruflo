/**
 * secrets.ts — credential resolver for the local-functions backend.
 *
 * Resolution order (first match wins, all cached after first hit):
 *   1. `ANTHROPIC_API_KEY` env var          — fastest local-dev path
 *   2. Google Cloud Secret Manager          — prod / shared-dev path
 *      Project ID:    `GCLOUD_PROJECT_ID` env var, or auto-detected from
 *                     `GOOGLE_CLOUD_PROJECT` (set by GCF), or
 *                     `gcloud config get-value project` via metadata.
 *      Secret name:   `RUFLO_ANTHROPIC_SECRET_NAME` env var
 *                     (default: `ruflo-anthropic-api-key`).
 *      Version:       `latest`.
 *   3. Fall through → caller treats as "no key" → mock mode.
 *
 * The Secret Manager client is loaded lazily so local dev with the env
 * var set never imports the gRPC dependency.
 */

let cachedKey: string | null | undefined;

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() !== '' ? v : undefined;
};

async function fetchFromSecretManager(): Promise<string | null> {
  const projectId =
    env('GCLOUD_PROJECT_ID') ||
    env('GOOGLE_CLOUD_PROJECT') ||
    env('GCP_PROJECT');
  if (!projectId) return null;

  const secretName = env('RUFLO_ANTHROPIC_SECRET_NAME') || 'ruflo-anthropic-api-key';

  try {
    const mod = await import('@google-cloud/secret-manager');
    const client = new mod.SecretManagerServiceClient();
    const [resp] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
    });
    const payload = resp.payload?.data;
    if (!payload) return null;
    const value = typeof payload === 'string' ? payload : Buffer.from(payload as Uint8Array).toString('utf8');
    return value.trim() || null;
  } catch (err) {
    // Don't crash the process — log and fall through to mock mode.
    console.warn('[secrets] Secret Manager fetch failed:', (err as Error).message);
    return null;
  }
}

/**
 * Sentinel value the operator can store in Secret Manager (or in the
 * `ANTHROPIC_API_KEY` env var) to FORCE mock mode without leaving the
 * secret unset. Useful for first-deploy smoke tests where you want
 * the functions deployed + reachable but don't want to either (a)
 * spend tokens or (b) fail Cloud Functions startup on a missing
 * secret. When `getAnthropicApiKey()` sees this exact string, it
 * treats it as "no key resolved" and returns null.
 */
export const MOCK_MODE_SENTINEL = '__MOCK_MODE__';

/**
 * Get the Anthropic API key. Returns null when neither the local env var
 * nor Secret Manager produces a value — caller should activate mock mode.
 *
 * Also returns null when the resolved value equals `MOCK_MODE_SENTINEL`,
 * so operators can ship a placeholder Secret Manager value and have
 * handlers cleanly fall back to mock responses.
 *
 * Re-fetches at most once per process: cache hit returns the prior value
 * (including null) without re-attempting Secret Manager.
 */
export async function getAnthropicApiKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;

  const fromEnv = env('ANTHROPIC_API_KEY');
  if (fromEnv && fromEnv !== MOCK_MODE_SENTINEL) {
    cachedKey = fromEnv;
    return cachedKey;
  }
  if (fromEnv === MOCK_MODE_SENTINEL) {
    cachedKey = null;
    return cachedKey;
  }

  const fromSecret = await fetchFromSecretManager();
  if (fromSecret === MOCK_MODE_SENTINEL) {
    cachedKey = null;
    return cachedKey;
  }
  cachedKey = fromSecret;
  return cachedKey;
}

/** Test-only: reset the in-memory cache so a test can change env between cases. */
export function _resetSecretsCacheForTesting(): void {
  cachedKey = undefined;
}
