#!/bin/bash
# Install API dependencies
cd api
echo "Installing API dependencies..."
npm install
cd ..

# Install and build client
cd client
echo "Installing client dependencies..."
npm install
echo "Building client for production..."
npm run build
echo "Build completed successfully"
cd ..