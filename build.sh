#!/bin/bash
cd client
echo "Installing client dependencies..."
npm ci --only=production
echo "Building client for production..."
npm run build
echo "Build completed successfully"