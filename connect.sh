#!/usr/bin/env bash
# Usage: /path/to/global/skills/zapier-sdk/connect.sh <app-name>
# Example: ~/.codex/skills/zapier-sdk/connect.sh notion
#          ~/.claude/skills/zapier-sdk/connect.sh "google calendar"

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <app-name>" >&2
  exit 1
fi

APP_NAME="$1"

# Get account ID from profile
ACCOUNT_ID=$(npx zapier-sdk get-profile --json 2>/dev/null \
  | python3 -c "import sys,json; p=json.load(sys.stdin)['data']; print(p.get('account_id',''))" 2>/dev/null)

# Fall back to extracting from existing connections
if [ -z "$ACCOUNT_ID" ]; then
  ACCOUNT_ID=$(npx zapier-sdk list-connections --owner me --json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['account_id'] if d else '')")
fi

if [ -z "$ACCOUNT_ID" ]; then
  echo "Error: Could not determine account_id. Are you logged in?" >&2
  exit 1
fi

# Look up implementation_id
IMPL_ID=$(npx zapier-sdk list-apps --search "$APP_NAME" --json 2>/dev/null \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
if not data:
    sys.exit(1)
# Prefer exact slug match, otherwise take first result
name = '$APP_NAME'.lower().replace(' ', '-')
match = next((a for a in data if a['slug'] == name), data[0])
print(match['implementation_id'])
")

if [ -z "$IMPL_ID" ]; then
  echo "Error: App '$APP_NAME' not found." >&2
  exit 1
fi

URL="https://zapier.com/engine/auth/start/${IMPL_ID}/?_zapier_account_id=${ACCOUNT_ID}"

echo "Opening auth for: $IMPL_ID"
echo "$URL"

# Open in browser (macOS: open, Linux: xdg-open)
if command -v open &>/dev/null; then
  open "$URL"
elif command -v xdg-open &>/dev/null; then
  xdg-open "$URL"
else
  echo "Open this URL in your browser: $URL"
fi
