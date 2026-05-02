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
 * Get the Anthropic API key. Returns null when neither the local env var
 * nor Secret Manager produces a value — caller should activate mock mode.
 *
 * Re-fetches at most once per process: cache hit returns the prior value
 * (including null) without re-attempting Secret Manager.
 */
export async function getAnthropicApiKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;

  const fromEnv = env('ANTHROPIC_API_KEY');
  if (fromEnv) {
    cachedKey = fromEnv;
    return cachedKey;
  }

  cachedKey = await fetchFromSecretManager();
  return cachedKey;
}

/** Test-only: reset the in-memory cache so a test can change env between cases. */
export function _resetSecretsCacheForTesting(): void {
  cachedKey = undefined;
}
