#!/bin/sh
set -eu

# Railway injects PORT at runtime. The default keeps docker-compose and the
# existing local demo behaviour unchanged.
: "${PORT:=3000}"
: "${ORCA_API_BASE:=}"
: "${ORCA_WS_BASE:=}"
export PORT ORCA_API_BASE ORCA_WS_BASE

envsubst '${PORT}' \
  < /etc/nginx/conf.d/default.conf.template \
  > /etc/nginx/conf.d/default.conf

# The public frontend configuration intentionally contains only public URLs.
# API keys and telemetry tokens remain backend-only environment variables.
envsubst '${ORCA_API_BASE} ${ORCA_WS_BASE}' \
  < /etc/nginx/templates/config.js.template \
  > /usr/share/nginx/html/config.js

exec nginx -g 'daemon off;'
