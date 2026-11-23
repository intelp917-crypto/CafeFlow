#!/bin/sh
# Container entrypoint.
#
# `db setup` applies pending migrations and seeds only an empty database, so a
# fresh volume (or a PaaS that has no way to run a one-off command) boots into a
# usable app. It is idempotent: on later starts it reports that the database was
# already prepared and changes nothing.
#
# Set CAFEFLOW_AUTO_SETUP=0 when another process owns the schema, for example
# several replicas sharing one PostgreSQL database.
set -eu

if [ "${CAFEFLOW_AUTO_SETUP:-1}" = "1" ] && [ "${1:-serve}" = "serve" ]; then
  cafeflow db setup
fi

exec cafeflow "$@"
