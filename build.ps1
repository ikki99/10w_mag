# build.ps1
$projectName = "10w_mag"

echo "--- 1. Building Frontend ---"
cd frontend
npm install
npm run build
cd ..

if (!(Test-Path bin)) { mkdir bin }

echo "--- 2. Building Backend (Windows) ---"
cd backend
$env:GOOS="windows"
$env:GOARCH="amd64"
go build -o "../bin/$projectName-win64.exe" main.go

echo "--- 3. Building Backend (Linux) ---"
$env:GOOS="linux"
$env:GOARCH="amd64"
go build -o "../bin/$projectName-linux64" main.go
cd ..

echo "--- Done! Check the 'bin' directory. ---"
