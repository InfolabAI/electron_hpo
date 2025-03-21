path="/data3/share/2503_HPOptimizer"
file1="./dist/HPOptimizer Setup 1.0.0.exe"
file2="./python_scripts/test_client.py"
file3="./pure_cpp_scripts"
file4="../HPOptimizer 메뉴얼.pdf"
file5="../cpp_codes/Undistortion"

scp -r "$file1" "$file2" "$file3" "$file4" "$file5" "robert.lim@156.147.154.18:$path"
