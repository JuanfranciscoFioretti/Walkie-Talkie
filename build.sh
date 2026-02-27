#!/bin/bash
set -e

echo "=== Building Walkie-Talkie for Vercel ==="

# Install API dependencies
echo "Installing API dependencies..."
cd api
npm install
cd ..

# Install and build client
echo "Installing client dependencies..."
cd client
npm install

echo "Building client for production..."
npm run build

# Verify build
if [ ! -d "dist" ]; then
  echo "ERROR: Build failed - dist directory not found!"
  exit 1
fi

if [ ! -f "dist/index.html" ]; then
  echo "ERROR: Build failed - index.html not found!"
  exit 1
fi

echo "✓ Client build successful"
ls -la dist/
cd ..

echo "=== Build completed successfully ==="