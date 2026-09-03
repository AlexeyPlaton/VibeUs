#!/bin/bash
set -e

echo "Building Vibus for release..."

# 1. Build frontend
echo "Building frontend..."
cd openspec-web
npm install
npm run build:all
cd ..

# 2. Build Docker images
echo "Building Docker images..."
docker-compose -f docker-compose.prod.yml build

echo "Release build complete! You can now start the application with:"
echo "docker-compose -f docker-compose.prod.yml up -d"
