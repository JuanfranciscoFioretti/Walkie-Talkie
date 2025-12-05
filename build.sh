#!/bin/bash
cd client
echo "Installing client dependencies..."
npm install
echo "Building client for production..."
npm run build
echo "Build completed successfully"