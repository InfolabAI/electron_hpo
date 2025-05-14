echo "Cleaning up"
rimraf dist

# For windows
echo "Building for windows"
NODE_OPTIONS=--max_old_space_size=16384 npm run build

# project/dist/HPOptimizer-win32-x64 를 zip -0 한 내용을  project/dist/HPOptimizer.zip 에 생성
zip -0 -r dist/HPOptimizer.zip dist/HPOptimizer-win32-x64

# For linux
#echo "Building for linux"
#npm run build
