#!/usr/bin/env bash
#
# Deploy goal_ui's functions backend to Google Cloud Run.
#
# WHY Cloud Run instead of 4 Cloud Functions Gen2:
#   - All 4 handlers share the existing Hono server in functions/server.ts
#   - One URL covers all routes (matches the SPA's path-based routing)
#   - TypeScript via `npm start` (`tsx functions/server.ts`); no per-fn
#     package.json + main fragmentation; no compile step
#   - Cloud Run buildpacks handle Node detection + scale-to-zero
#
# Run from v3/goal_ui/. Idempotent.
#
# Env vars (sane defaults; override as needed):
#   PROJECT_ID                  gcloud config default
#   REGION                      us-central1
#   RUFLO_FUNCTIONS_TOKEN       openssl rand -hex 32 (auto-generated if unset)
#   RUFLO_ALLOWED_ORIGINS       https://goal.ruv.io
#   RUFLO_RATE_LIMIT_PER_MIN    60
#   RUFLO_ANTHROPIC_SECRET_NAME ANTHROPIC_API_KEY
#   SERVICE_NAME                ruflo-research-fns

set -euo pipefail

cd "$(dirname "$0")/.." # → v3/goal_ui/

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo '')}"
REGION="${REGION:-us-central1}"
SECRET_NAME="${RUFLO_ANTHROPIC_SECRET_NAME:-ANTHROPIC_API_KEY}"
SERVICE_NAME="${SERVICE_NAME:-ruflo-research-fns}"
RUFLO_TOKEN="${RUFLO_FUNCTIONS_TOKEN:-}"
ALLOWED_ORIGINS="${RUFLO_ALLOWED_ORIGINS:-https://goal.ruv.io}"
RATE_LIMIT="${RUFLO_RATE_LIMIT_PER_MIN:-60}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID not set" >&2
  echo "Run: gcloud config set project <PROJECT_ID>" >&2
  exit 2
fi

if [[ -z "$RUFLO_TOKEN" ]]; then
  echo "WARNING: RUFLO_FUNCTIONS_TOKEN not set — generating a fresh one for this deploy:"
  RUFLO_TOKEN="$(openssl rand -hex 32)"
  echo "  $RUFLO_TOKEN"
  echo "  (paste this into the frontend's VITE_FUNCTIONS_PUBLIC_TOKEN)"
fi

if ! gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "ERROR: Secret Manager secret '$SECRET_NAME' not found" >&2
  echo "  Create + seed: docs/DEPLOYMENT-GCP.md §Anthropic API key" >&2
  exit 3
fi

# Env-vars file (gcloud --set-env-vars's CSV format breaks on URL lists).
ENV_FILE="$(mktemp -t ruflo-runrun-env.XXXXXX).yaml"
trap 'rm -f "$ENV_FILE"' EXIT
cat > "$ENV_FILE" <<EOF_ENV
RUFLO_FUNCTIONS_TOKEN: "${RUFLO_TOKEN}"
RUFLO_ALLOWED_ORIGINS: "${ALLOWED_ORIGINS}"
RUFLO_RATE_LIMIT_PER_MIN: "${RATE_LIMIT}"
GCLOUD_PROJECT_ID: "${PROJECT_ID}"
EOF_ENV

echo "Deploying $SERVICE_NAME to $PROJECT_ID/$REGION (secret: $SECRET_NAME)"
echo ""

gcloud run deploy "$SERVICE_NAME" \
  --source=. \
  --region="$REGION" \
  --allow-unauthenticated \
  --env-vars-file="$ENV_FILE" \
  --set-secrets="ANTHROPIC_API_KEY=${SECRET_NAME}:latest" \
  --memory=512Mi \
  --timeout=300 \
  --max-instances=10 \
  --min-instances=0 \
  --quiet

URL="$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)' 2>/dev/null || echo unknown)"
echo ""
echo "✓ Service live: $URL"
echo ""
echo "Health probe:"
echo "  curl -s '$URL/'"
echo ""
echo "Frontend env:"
echo "  VITE_FUNCTIONS_BASE_URL=$URL"
echo "  VITE_FUNCTIONS_PUBLIC_TOKEN=$RUFLO_TOKEN"
