echo "Cleaning up"
rimraf dist

# For windows
echo "Building for windows"
npx electron-builder --win

# For linux
#echo "Building for linux"
#npm run build
