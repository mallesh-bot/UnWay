#!/usr/bin/env bash
# Runs the database test-suite against a local Postgres (default port 5433).
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="psql -h ${PGHOST:-localhost} -p ${PGPORT:-5433} -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$PSQL -c "drop database if exists unway_test" -c "create database unway_test" >/dev/null
$PSQL -d unway_test -f tests/00_local_supabase_stub.sql >/dev/null
for f in migrations/*.sql; do $PSQL -d unway_test -f "$f" 2>&1 | grep -v NOTICE || true; done
$PSQL -d unway_test -f tests/10_end_to_end.sql
$PSQL -d unway_test -f tests/20_demo_data.sql
$PSQL -d unway_test -f tests/30_platform_parent.sql
$PSQL -d unway_test -f tests/40_school_automation.sql
