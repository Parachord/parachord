#!/bin/bash
# Wrapper around macOS codesign that retries on timestamp service failures.
# Apple's timestamp server can be transiently unavailable, causing CI builds
# to fail. This wrapper detects that specific error and retries with backoff.

REAL_CODESIGN=/usr/bin/codesign
MAX_RETRIES=5
INITIAL_DELAY=3

delay=$INITIAL_DELAY

for attempt in $(seq 1 $MAX_RETRIES); do
  output=$("$REAL_CODESIGN" "$@" 2>&1)
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    [ -n "$output" ] && echo "$output"
    exit 0
  fi

  if echo "$output" | grep -qi "timestamp service is not available\|timestamp server is not available\|unable to communicate with the timestamp server"; then
    echo "codesign-retry: timestamp service unavailable (attempt $attempt/$MAX_RETRIES), retrying in ${delay}s..." >&2
    sleep $delay
    delay=$((delay * 2))
  else
    # Not a timestamp error — fail immediately
    echo "$output" >&2
    exit $exit_code
  fi
done

# Final attempt
exec "$REAL_CODESIGN" "$@"
