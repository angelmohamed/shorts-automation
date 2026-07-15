#!/usr/bin/env bash
# Upload footage segments to the R2 bucket and regenerate manifest.json.
#
# Usage:
#   scripts/footage-upload.sh                 # upload everything in footage/segments/
#   scripts/footage-upload.sh --files-from L  # upload only files listed (one name per line) in L
#
# Needs .env.r2 in the repo root (gitignored) with:
#   R2_ACCOUNT_ID / R2_BUCKET / R2_ENDPOINT / R2_PUBLIC_URL
#   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEGMENTS_DIR="$REPO_ROOT/footage/segments"
set -a; source "$REPO_ROOT/.env.r2"; set +a   # -a exports everything for child processes (rclone, python)

# rclone remote defined entirely via env — no secrets in rclone.conf
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

# --files-from replaces all other filters in rclone, so only use --include without it
FILTER_ARGS=(--include "*.mp4")
if [[ "${1:-}" == "--files-from" ]]; then
  FILTER_ARGS=(--files-from "$2")
fi

echo "Uploading from $SEGMENTS_DIR to r2:$R2_BUCKET/segments/ ..."
rclone copy "$SEGMENTS_DIR" "r2:$R2_BUCKET/segments/" \
  "${FILTER_ARGS[@]}" \
  --transfers 4 --checkers 8 --stats 30s --stats-one-line -v

echo "Regenerating manifest.json from bucket contents ..."
rclone lsjson "r2:$R2_BUCKET/segments/" | python3 -c "
import json, os, sys, datetime
entries = json.load(sys.stdin)
public = os.environ['R2_PUBLIC_URL'].rstrip('/')
segments = []
for e in sorted(entries, key=lambda x: x['Name']):
    if not e['Name'].endswith('.mp4'):
        continue
    name = e['Name']
    group = name.split('.')[0]
    segments.append({
        'name': name,
        'group': group,
        'size': e['Size'],
        'url': f'{public}/segments/{name}',
    })
manifest = {
    'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'count': len(segments),
    'segments': segments,
}
with open('/tmp/footage-manifest.json', 'w') as f:
    json.dump(manifest, f, indent=2)
print(f'{len(segments)} segments in manifest')
"
rclone copyto /tmp/footage-manifest.json "r2:$R2_BUCKET/manifest.json"

echo "Done. Manifest: $R2_PUBLIC_URL/manifest.json"
