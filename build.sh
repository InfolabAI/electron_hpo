echo "Cleaning up"
rimraf dist

# For windows
echo "Building for windows"
npx electron-builder --win

# For linux
#echo "Building for linux"
#npm run build

path=/data3/share/2503_HPOptimizer
scp ./dist/HPOptimizer\ Setup\ 1.0.0.exe robert.lim@156.147.154.18:$path
scp ./python_scripts/test_client.py robert.lim@156.147.154.18:$path
scp ../HPOptimizer\ 메뉴얼.pdf robert.lim@156.147.154.18:$path