#!/usr/bin/env bash
set -euo pipefail
# The application account is not the initialization superuser. Its password is
# supplied through stdin via psql's environment binding, never a command argument.
PREFLIGHT_APP_PASSWORD="$(cat "${PREFLIGHT_POSTGRES_APP_PASSWORD_FILE:?Application password file is required}")"
if [ -z "$PREFLIGHT_APP_PASSWORD" ]; then
  printf '%s\n' 'Application password secret is empty.' >&2
  exit 1
fi
export PREFLIGHT_APP_PASSWORD
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password PREFLIGHT_APP_PASSWORD
CREATE ROLE preflight_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE preflight TO preflight_app;
GRANT USAGE, CREATE ON SCHEMA public TO preflight_app;
SQL
unset PREFLIGHT_APP_PASSWORD
