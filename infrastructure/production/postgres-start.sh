#!/usr/bin/env bash
set -euo pipefail
umask 077
# Compose secret bind mounts are root-owned. Copy only the server identity into
# the container's private writable layer with the permissions PostgreSQL requires.
mkdir -p /var/lib/postgresql/tls
cp /run/secrets/postgres_cert /var/lib/postgresql/tls/server.crt
cp /run/secrets/postgres_key /var/lib/postgresql/tls/server.key
cp /run/secrets/postgres_app_password /var/lib/postgresql/tls/app-password
chown -R postgres:postgres /var/lib/postgresql/tls
chmod 600 /var/lib/postgresql/tls/server.key
chmod 600 /var/lib/postgresql/tls/app-password
export PREFLIGHT_POSTGRES_APP_PASSWORD_FILE=/var/lib/postgresql/tls/app-password
exec /usr/local/bin/docker-entrypoint.sh postgres \
  -c ssl=on \
  -c ssl_min_protocol_version=TLSv1.2 \
  -c ssl_cert_file=/var/lib/postgresql/tls/server.crt \
  -c ssl_key_file=/var/lib/postgresql/tls/server.key \
  -c hba_file=/etc/preflight/pg_hba.conf \
  -c password_encryption=scram-sha-256 \
  -c log_statement=none
