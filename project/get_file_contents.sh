#!/usr/bin/env bash

# --- 사용자 설정 섹션 ---
# 1) 합쳐진 결과가 저장될 경로
OUTPUT_PATH="./merged.md"

# 2) 합칠 파일들(절대경로 혹은 상대경로)
FILES=(
    "./index.html"
    "./main.js"
    "./preload.js"
    "./dashboardPreload.js"
)
# ------------------------

# 결과 파일이 이미 있으면 지운 뒤 새로 생성 (원하면 주석 처리)
rm -f "$OUTPUT_PATH"

# 파일을 순회하며, 원하는 형식대로 출력을 이어 붙입니다.
for file in "${FILES[@]}"; do
  # 파일 이름만 추출
  FILENAME="$(basename "$file")"

  # 1) "## 파일명"
  echo "## $FILENAME" >> "$OUTPUT_PATH"

  # 2) "```" 열기
  echo '```' >> "$OUTPUT_PATH"

  # 3) 원본 파일 내용을 그대로 붙여쓰기
  cat "$file" >> "$OUTPUT_PATH"

  # 4) "```" 닫기 + 빈 줄
  echo '```' >> "$OUTPUT_PATH"
  echo >> "$OUTPUT_PATH"
done

echo "[INFO] Created '$OUTPUT_PATH' successfully."
