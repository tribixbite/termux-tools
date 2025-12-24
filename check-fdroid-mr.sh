#!/bin/bash
# Check F-Droid MR !30449 status and notify on change

MR_ID="30449"
STATE_FILE="$HOME/.fdroid_mr_${MR_ID}_state"

# Get current MR state
CURRENT_STATE=$(curl -s "https://gitlab.com/api/v4/projects/fdroid%2Ffdroiddata/merge_requests/${MR_ID}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('state','unknown'))" 2>/dev/null)

# Read previous state
PREV_STATE=""
[ -f "$STATE_FILE" ] && PREV_STATE=$(cat "$STATE_FILE")

# If no previous state, initialize it
if [ -z "$PREV_STATE" ]; then
    echo "$CURRENT_STATE" > "$STATE_FILE"
    exit 0
fi

# Check if state changed from "opened"
if [ "$PREV_STATE" = "opened" ] && [ "$CURRENT_STATE" != "opened" ] && [ -n "$CURRENT_STATE" ]; then
    termux-notification \
        -t "🎉 F-Droid MR !${MR_ID} ${CURRENT_STATE}!" \
        -c "CleverKeys MR status changed from open to ${CURRENT_STATE}" \
        --id "fdroid-mr-${MR_ID}" \
        --priority high \
        --vibrate 500,200,500
fi

# Save current state
[ -n "$CURRENT_STATE" ] && echo "$CURRENT_STATE" > "$STATE_FILE"
