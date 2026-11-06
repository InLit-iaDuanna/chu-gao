#!/usr/bin/env bash
set -euo pipefail

if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "Docker Compose is not installed."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop, then rerun: bash start.sh"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not installed. Install dependencies first, then rerun this script."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
  echo "Edit IMAGE2_BASE_URL and IMAGE2_API_KEY in .env before testing real image generation."
fi

echo "Starting local Postgres and Redis..."
"${DOCKER_COMPOSE[@]}" up -d postgres redis

echo "Applying Prisma migrations..."
pnpm db:migrate

echo "Seeding default data..."
pnpm db:seed

echo "Running local readiness checks..."
pnpm dev:doctor || true

echo
echo "Local dependencies are ready."
echo "Starting Next.js and the generation worker..."
echo "User app:  http://127.0.0.1:3000/app"
echo "Admin app: http://127.0.0.1:3000/admin"
echo
exec pnpm dev:all
