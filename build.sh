#!/bin/bash
# build.sh
PROJECT_NAME="10w_mag"

mkdir -p bin

echo "--- 1. Building Frontend ---"
cd frontend
npm install
npm run build
cd ..

echo "--- 2. Building Backend (Linux) ---"
cd backend
GOOS=linux GOARCH=amd64 go build -o "../bin/$PROJECT_NAME-linux64" main.go

echo "--- 3. Building Backend (Windows) ---"
GOOS=windows GOARCH=amd64 go build -o "../bin/$PROJECT_NAME-win64.exe" main.go
cd ..

echo "--- Done! Check the 'bin' directory. ---"
