아래 코드에 기능을 넣기 위해 수정이 필요한 부분만 답변해줘.
- 일렉트론 앱을 실행할 때, optuna-dashboard 를 실행해야 함.
- "optuna-dashboard sqlite:///../db.sqlite3" 를 python -m 으로 실행해야 됨. 배포판에서는 embedded python 으로 실행해야 하기 때문.
- 일렉트론 앱을 종료할 때, optuna-dashboard 를 종료해야 함. 종료하지 않으면 다음 실행 시에 포트가 사용중이라고 에러가 발생함.

## index.html
```
<!DOCTYPE html>
<html lang="ko">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hyperparameter Optimizer</title>

    <!-- head 내부 -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">

    <style>
        body {
            margin: 0;
            font-family: sans-serif;
        }

        .tab-content {
            display: none;
            /* 기본적으로 감춰놓고, 선택된 탭만 표시 */
        }

        .tab-content.active {
            display: block;
            /* 선택된 탭은 보이게 */
        }
    </style>
</head>

<body>
    <!-- 
    1) "container-fluid": 
    - Bootstrap에서 지원하는 레이아웃 컨테이너 중 하나로, 
        가로 폭을 브라우저(또는 부모 요소) 전체 폭에 맞게 100%로 사용함.
    - "container"와 달리 반응형 최대 폭 제한이 없고, 
        항상 수평으로 화면 전체를 차지할 수 있음.
    
    2) "h-100":
    - Bootstrap 유틸리티 클래스 중 하나로, 
        height: 100% (세로 높이 100%)를 의미.
    - 부모 요소(여기서는 <body> 또는 <html> 등) 높이가 정해져 있어야 
        100%가 유효하게 동작함.
    - 제거하면 해당 컨테이너는 자동으로 내용물에 따라 높이가 달라짐.
    -->

    <div class="container-fluid h-100">
        <!-- Bootstrap의 row로 수평 배치, 높이 100% -->
        <!-- 
        1) "row": 
        - Bootstrap의 grid system에서, 
            "열(col)"들을 수평 방향으로 배치하는 '행' 컨테이너.
        - 내부에 "col", "col-auto" 등의 컬럼들이 들어갈 때 사용할 수 있음.

        2) "h-100":
        - 이 row도 높이를 100%로 맞춤.
        - 상위 요소가 이미 h-100이므로, 
            row도 같이 세로 100%가 유지되어 
            양쪽(col-auto, col)도 세로로 가득 차게 배치 가능.

        3) "g-0":
        - "g-0"은 "gutter: 0"을 뜻함.
        - 기본적으로 col 사이에는 일정 간격(gutter)이 생기는데, 
            이 클래스를 주면 그 간격을 0으로 만들어 
            컬럼 사이 공백이 없게 함.
        - 만약 g-0을 제거하면, col 사이에 기본적인 
            수평 공간(보통 1.5rem) 정도가 생김.
        -->

        <div class="row h-100 g-0">


            <!-- 왼쪽 사이드바: 고정 폭(col-auto) + 배경색 -->
            <!-- 
            1) col-auto: 내용물 크기에 맞춰 자동으로 폭이 결정된다.
                => 이 내부의 버튼이 작아지면(텍스트에 맞는 너비),
                    col-auto 자체도 그만큼 폭이 작아진다.

            2) d-block: 버튼을 display: block 으로 처리.
                => 기본적으로 inline-block 성격이 사라져, 
                    width, margin 등의 적용 방식이 달라짐.

            3) mx-auto: 좌우 마진을 auto로 설정.
                => display: block인 요소가 부모 안에서 
                    수평 가운데 정렬된다.
                => 단, 별도로 width(예: w-50 등)를 지정하지 않으면, 
                    내용(텍스트) 길이에 따라 최소 폭이 결정됨 
                    (결과적으로 버튼 폭이 텍스트 크기에 맞춰짐).

            즉, "d-block mx-auto"만 쓰면 
            -> 버튼 폭이 내부 텍스트에 맞춰 작아지고, 
            -> 사이드바(col-auto)도 그 폭에 맞게 줄어든다.

            만약 버튼을 고정 폭이나 비율로 유지하고 싶다면
            "w-50 d-block mx-auto" 같은 식으로 함께 써서
            너비 50% + 중앙 정렬을 적용할 수 있다.
            -->

            <div class="col-auto bg-secondary text-white p-3">
                <!--
                Bootstrap button:
                    - btn          : 기본 버튼 스타일
                    - btn-primary  : 파란색 계열 (Primary) 버튼
                    - w-100        : 버튼 너비를 100%로 지정 (부모의 100%)
                    - mb-2         : 아래쪽 여백(margin-bottom) 0.5rem
                id="btnMain": 자바스크립트에서 document.getElementById('btnMain') 등을 통해
                                클릭 이벤트 등을 연결하기 위해 쓰임
                -->
                <button class="btn btn-primary w-100 d-block mx-auto mb-2" id="btnMain">Main</button>
                <button class="btn btn-warning w-100 d-block mx-auto mb-2" id="btnSettings">Settings</button>
                <button class="btn btn-success w-100 d-block mx-auto mb-2" id="btnResults">Results</button>
                <!-- 기존 버튼들 아래에 Dashboard 버튼 하나 추가 -->
                <button class="btn btn-info w-100 d-block mx-auto mt-2" id="btnDashboard">Dashboard</button>

            </div>

            <!-- 오른쪽 컨텐츠: 남은 공간(col) -->
            <!-- 
            1) "col":
            - Bootstrap Grid System에서
                '남은 공간을 유연하게 차지하는 컬럼' 역할.
            - "col-auto"나 숫자 지정(col-4, col-6 등)과 달리, 
                row 내에서 자동으로 남아있는 부분을 고루 분할해 가짐.

            2) "p-4":
            - padding: (약) 1.5rem 정도로 설정.
            - 내부 컨텐츠에 넉넉한 여백을 주어, 
                요소들이 가장자리와 떨어져 보이게 됨.
            -->

            <div class="col p-4">


                <!-- 메인 탭 -->
                <!-- 
                id="mainTab": 
                    - JavaScript에서 document.getElementById('mainTab')로 
                    접근하기 위한 식별자.
                    - 탭 전환 로직에서 '메인 탭'을 가리킬 때 사용.

                class="tab-content active":
                    - "tab-content": 탭 전환에 사용되는 공통 클래스. 
                    보통 CSS에서 display: none 처리해둔 상태.
                    - "active": 이 탭이 현재 화면에 표시되는 상태를 의미. 
                    (CSS에서 .tab-content.active { display: block; } 등으로 제어)
                -->
                <div id="mainTab" class="tab-content active">

                    <!-- <h1>Locate optimizer path</h1> -->

                    <!--
                    <div class="input-group mb-3">
                    - Bootstrap의 input-group: 
                        텍스트 입력과 버튼 등 여러 요소를 
                        하나의 그룹으로 보기 좋게 묶어주는 구성.
                    - mb-3: "margin-bottom: 1rem" 정도로, 
                        아래쪽에 간격을 줌.
                    -->
                    <div class="input-group mb-3">
                        <!-- 
                        <input type="text" class="form-control" id="command" placeholder="Python path..." />
                            - 입력 필드:
                            - class="form-control": 부트스트랩 양식(입력창) 스타일 적용.
                            - id="command": JS에서 값을 읽거나 변경할 때 사용.
                            - placeholder="Python path...": 
                                사용자가 입력하기 전에 표시할 안내 텍스트.
                        <input type="text" class="form-control" id="command" placeholder="Python path..." />
                        -->

                        <!--
                        <button class="btn btn-outline-secondary" onclick="selectFile('command')">Browse</button>
                            - class="btn btn-outline-secondary": 
                            부트스트랩 버튼 스타일(회색 테두리, 흰 배경).
                            - onclick="selectFile('command')": 
                            버튼을 클릭하면 JavaScript의 selectFile() 함수를 호출, 
                            'command'라는 인자를 넘겨 해당 input에 파일 경로를 세팅하도록 구현.
                        <button class="btn btn-outline-secondary" onclick="selectFile('command')">Browse</button>
                        -->
                        <div class="input-group mb-3">
                            <span class="input-group-text">Number of Trials</span>
                            <input type="text" class="form-control" id="n_trials" placeholder="The number of trials..."
                                value="30" />
                        </div>
                    </div>

                    <div class="input-group mb-3">
                        <!--
                        두 번째 input-group (args 입력)
                        - 구조와 역할은 위와 동일, id 및 placeholder만 다름.
                        <input type="text" class="form-control" id="args" placeholder="Optuna path..." />
                        <button class="btn btn-outline-secondary" onclick="selectFile('args')">Browse</button>
                        -->
                    </div>

                    <!--
                    <button class="btn btn-primary" id="runBtn">Run</button>
                    - 부트스트랩 파란색(Primary) 버튼.
                    - id="runBtn": 클릭 이벤트를 JS에서 걸어 
                        실제 'run' 동작을 수행하게 함.
                    -->
                    <button class="btn btn-primary" id="runBtn">Run</button>

                    <!--
                    <pre id="output" class="mt-3 p-3 bg-light" style="border: 1px solid #ccc;"></pre>
                    - <pre>: 공백과 줄바꿈을 그대로 보존하는 블록.
                    - id="output": 실시간 로그나 결과 텍스트를 표시하는 용도.
                    - class="mt-3": 상단 마진(3단계, 약 1rem).
                    - class="p-3 bg-light": 안쪽 여백 + 연한 배경색.
                    - style="border: 1px solid #ccc;": 테두리 지정 (회색 라인).
                    -->
                    <pre id="output" class="mt-3 p-3 bg-light" style="border: 1px solid #ccc;"></pre>

                </div>


                <!-- 설정 탭 -->
                <!-- 
                id="settingsTab":
                    - JS에서 document.getElementById('settingsTab')로 접근 가능.
                    - 탭 전환 시, "설정" 탭으로 표시될 영역.

                class="tab-content":
                    - 탭 공통 클래스. 
                    - 일반적으로 CSS에서 .tab-content { display: none; } 처리,
                    active 상태에서만 display: block; 되어 보이도록 제어.
                    - 이 탭은 현재 "active" 클래스가 없으므로 초기에는 숨겨짐.
                -->
                <div id="settingsTab" class="tab-content">

                    <!-- 
                    <h1>설정</h1>
                        - 큰 제목: "설정" 섹션이라는 것을 알려줌.
                    -->
                    <h1>Settings</h1>

                    <!-- 
                    <button class="btn btn-info mb-3" id="addRowBtn">+ 행 추가</button>
                        - btn: 부트스트랩 버튼 기본 스타일
                        - btn-info: 밝은 하늘색/청록색 계열 버튼
                        - mb-3: 하단 여백(margin-bottom) 1rem (약 16px) 정도
                        - id="addRowBtn": JS에서 클릭 이벤트를 연결해 "행 추가" 기능 구현
                    -->
                    <button class="btn btn-info mb-3" id="addRowBtn">+ Add Row</button>

                    <!-- 
                    <table id="settingsTable" class="table table-bordered">
                        - table: 부트스트랩 표 기본 스타일 (적절한 간격과 텍스트 정렬)
                        - table-bordered: 각 셀에 테두리가 있는 표
                        - id="settingsTable": JS에서 이 테이블을 찾아 행 추가/삭제를 동적으로 구현
                        - text-center: 가운데 정렬
                    -->
                    <table id="settingsTable" class="table table-bordered text-center">
                        <thead class="table-secondary">
                            <tr>
                                <!-- 
                                <th>-</th>: 첫 열은 행 삭제 버튼 표시에 사용
                                <th>Type</th>, <th>Name</th>, <th colspan="4">Config</th>
                                    - 이후 "Type" 선택에 따라 int/float/category의 세부 설정을 
                                    동적으로 보여줄 수 있음.
                                -->
                                <th>-</th>
                                <th>Type</th>
                                <th>Name</th>
                                <th colspan="4">Config</th>
                            </tr>
                        </thead>
                        <tbody>
                            <!-- 동적 행 추가 영역 -->
                            <!-- 
                            JS로 행(tr)을 생성해 추가할 때,
                            <td>에 select, input 등을 넣어서 
                            사용자 설정 정보를 수집하는 구조.
                            -->
                        </tbody>
                    </table>

                    <!-- 
                    하단의 저장/초기화 버튼:
                        - "btn btn-success": 녹색 계열(성공 메세지 느낌)
                        - "btn btn-warning": 노란 계열(주의 표시 느낌)
                    id="saveBtn" / id="resetBtn":
                        - JS 이벤트 바인딩을 위해 사용.
                        - "저장": 설정 내용 JSON으로 export, 파일 저장 등
                        - "초기화": 테이블 행 및 값들을 클리어
                    -->
                    <button class="btn btn-success" id="saveBtn">Save</button>
                    <button class="btn btn-warning" id="resetBtn">Reset</button>

                </div>


                <!-- 결과 탭 -->
                <div id="resultsTab" class="tab-content">
                    <h1>Results</h1>
                    <pre id="output_ret" class="p-3 bg-light" style="border: 1px solid #ccc;"></pre>
                </div>

                <!-- Dashboard Tab. preload 할 js 실행 문제로 버튼 클릭시 webview 로드하도록 개발함 -->
                <div id="dashboardTab" class="tab-content">
                </div>

            </div> <!-- col 끝 -->
        </div> <!-- row 끝 -->
    </div> <!-- container-fluid 끝 -->

    <script>
        // 탭 전환 로직
        const btnMain = document.getElementById("btnMain");
        const btnSettings = document.getElementById("btnSettings");
        const btnResults = document.getElementById("btnResults");
        const btnDashboard = document.getElementById("btnDashboard");
        const mainTab = document.getElementById("mainTab");
        const settingsTab = document.getElementById("settingsTab");
        const resultsTab = document.getElementById("resultsTab");
        const dashboardTab = document.getElementById("dashboardTab");


        btnMain.addEventListener("click", () => {
            mainTab.classList.add("active");
            settingsTab.classList.remove("active");
            resultsTab.classList.remove("active");
            dashboardTab.classList.remove("active");
        });
        btnSettings.addEventListener("click", async () => {
            mainTab.classList.remove("active");
            settingsTab.classList.add("active");
            resultsTab.classList.remove("active");
            dashboardTab.classList.remove("active");
            // 설정 탭 들어갈 때마다 config.json 불러오기
            await loadConfig();
        });
        btnResults.addEventListener("click", async () => {
            mainTab.classList.remove("active");
            settingsTab.classList.remove("active");
            resultsTab.classList.add("active");
            dashboardTab.classList.remove("active");
            // 결과 탭 들어갈 때마다 결과 불러오기
            await loadResults();
        });
        // 버튼 클릭 시 다른 탭들의 active 제거 후 dashboardTab에 active 부여
        // 버튼을 클릭했을 때, webview 를 동적으로 만들어야 preloadAbsolutePath(즉, dashboardPreload.js)를 webview 가 정상적으로 열 수 있음
        btnDashboard.addEventListener("click", async () => {
            mainTab.classList.remove("active");
            settingsTab.classList.remove("active");
            resultsTab.classList.remove("active");
            dashboardTab.classList.add("active");
            // 1) dashboardTab 내부의 기존 webview가 있으면 제거 (이미 만들어진 적이 있으면)
            const existingWebview = document.querySelector('#dashboardTab webview');
            if (existingWebview) {
                existingWebview.remove();
            }

            // 2) Webview를 동적으로 생성
            const webview = document.createElement('webview');

            // 3) 동적 경로(예: preloadAbsolutePath) 가져오기
            const preloadAbsolutePath = await window.electronAPI.getDashboardPreloadPath();
            // 반드시 file:// 붙이거나 pathToFileURL(preloadAbsolutePath).href 등으로 처리
            //const finalPreloadURL = 'file://' + preloadAbsolutePath;

            // 4) Webview 속성 설정
            webview.setAttribute('preload', preloadAbsolutePath);
            webview.setAttribute('src', 'http://localhost:8080');
            webview.style.width = '100%';
            webview.style.height = '800px';
            webview.style.border = 'none';

            // 5) dashboardTab div에 삽입
            dashboardTab.appendChild(webview);

        });

        // ---------------------
        // 메인 탭 (기존 기능)
        // ---------------------
        const runBtn = document.getElementById('runBtn');
        // const cmdInput = document.getElementById('command');
        // const argsInput = document.getElementById('args');
        const nTrialsInput = document.getElementById('n_trials');
        const outputArea = document.getElementById('output');
        const outputRetArea = document.getElementById('output_ret');

        // =============== 실시간 로그를 뿌릴 이벤트 연결 ===============
        // main -> renderer 통신
        window.electronAPI.onCommandStdout((data) => {
            outputArea.textContent += data; // 그냥 이어붙이면 됨
        });

        window.electronAPI.onCommandStderr((data) => {
            outputArea.textContent += '[ERR] ' + data; // 현재는 에러는 표시 안함
        });

        window.electronAPI.onCommandClose((code) => {
            outputArea.textContent += `\n--- Process exited with code: ${code} ---\n`;
        });

        window.electronAPI.onCommandError((errMsg) => {
            outputArea.textContent += `[ERROR] ${errMsg}\n`;
        });
        // ============================================================

        runBtn.addEventListener('click', async () => {
            // 공백으로 구분된 인자를 배열로
            //const cmd = cmdInput.value.trim();
            const cmd = '';
            //const args = argsInput.value.trim().split(' ');
            const n_trials = nTrialsInput.value.trim();
            const args = '';

            outputArea.textContent = 'Running command...\n';

            try {
                // 프로세스 시작
                const result = await window.electronAPI.runCommand(cmd, args, n_trials);
                // 여기 도달 시점: 프로세스가 종료된 뒤
                outputArea.textContent += `\nProcess ended. code=${result.code}\n`;
            } catch (err) {
                outputArea.textContent += `\n[ERROR] ${err.message}\n`;
            }
        });


        function selectFile(inputId) {
            const inputElement = document.getElementById(inputId);
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.style.display = "none";

            fileInput.onchange = function (event) {
                if (event.target.files.length > 0) {
                    inputElement.value = event.target.files[0].path;
                }
            };

            document.body.appendChild(fileInput);
            fileInput.click();
            document.body.removeChild(fileInput);
        }

        // ---------------------
        // 설정 탭
        // ---------------------
        const addRowBtn = document.getElementById("addRowBtn");
        const saveBtn = document.getElementById("saveBtn");
        const resetBtn = document.getElementById("resetBtn");
        const settingsTableBody = document.querySelector("#settingsTable tbody");

        // 행 추가 버튼 클릭 시
        addRowBtn.addEventListener("click", () => {
            addRow();
        });

        // 초기화 버튼 클릭 시
        resetBtn.addEventListener("click", () => {
            settingsTableBody.innerHTML = ""; // 테이블 초기화
        });

        // 저장 버튼 클릭 시
        saveBtn.addEventListener("click", async () => {
            // 테이블 내용을 JSON 형태로 추출
            const data = tableToJson();
            // IPC로 main process에 저장 요청
            await window.electronAPI.saveConfig(data);
            alert("Saved!");
        });

        // 설정 탭 들어갈 때 불러오기
        async function loadConfig() {
            try {
                const configData = await window.electronAPI.loadConfig();
                // configData가 배열 형태라고 가정 ([{type:'int', ...}, ...])
                settingsTableBody.innerHTML = ""; // 초기화
                configData.forEach(rowData => {
                    addRow(rowData);
                });
            } catch (e) {
                console.error(e);
            }
        }

        // 결과 불러오기
        async function loadResults() {
            try {
                outputRetArea.textContent = '';
                const retData = await window.electronAPI.loadResults();
                console.log("retData", retData)
                // configData가 배열 형태라고 가정 ([{type:'int', ...}, ...])
                retData.forEach(rowData => {
                    // output_ret 에 추가
                    outputRetArea.textContent += rowData + '\n';
                });
            } catch (e) {
                console.error(e);
            }
        }

        // 테이블에 행 추가하는 함수
        function addRow(rowData = null) {
            const tr = document.createElement("tr");

            // [수정] 1) - 버튼을 가운데 정렬, Bootstrap 버튼 스타일 적용
            const tdRemove = document.createElement("td");
            tdRemove.classList.add("text-center"); // 가운데 정렬
            const removeBtn = document.createElement("button");
            removeBtn.className = "remove-row-btn btn btn-sm btn-outline-danger";
            removeBtn.textContent = "-";
            removeBtn.addEventListener("click", () => {
                tr.remove();
            });
            tdRemove.appendChild(removeBtn);
            tr.appendChild(tdRemove);

            // [수정] 2) 'Type' 셀의 select에 Bootstrap 폼 스타일 추가
            const tdType = document.createElement("td");
            const selectType = document.createElement("select");
            selectType.classList.add("form-select"); // (Bootstrap select 스타일)
            selectType.add(new Option("int", "int"));
            selectType.add(new Option("float", "float"));
            selectType.add(new Option("category", "category"));

            // 기본값 설정
            if (rowData && rowData.type) {
                selectType.value = rowData.type;
            }

            // 타입 변화에 따라 동적 칸 재구성
            selectType.addEventListener("change", () => {
                renderDynamicCells(tr, selectType.value, rowData);
            });

            tdType.appendChild(selectType);
            tr.appendChild(tdType);

            // tr을 tbody에 붙인 뒤, 타입에 맞는 칸을 구성
            settingsTableBody.appendChild(tr);
            renderDynamicCells(tr, selectType.value, rowData);
        }


        function renderDynamicCells(tr, typeValue, rowData) {
            // 타입 셀 뒤의 다른 셀들 제거 후 다시 생성
            while (tr.cells.length > 2) {
                tr.removeChild(tr.lastChild);
            }
            rowData = rowData || {};

            if (typeValue === "int" || typeValue === "float") {
                // (1) Name
                const tdName = document.createElement("td");
                const inputName = document.createElement("input");
                inputName.classList.add("form-control"); // [수정] Bootstrap input 스타일
                // 기존의 유효성 검사 관련 코드는 동일
                registerBlurValidator(inputName, hasSpecialChar, '숫자, 알파벳 및 언더바(_) 만 허용됩니다.');
                inputName.type = "text";
                inputName.placeholder = "argument name";
                if (rowData.name !== undefined) inputName.value = rowData.name;
                tdName.appendChild(inputName);
                tr.appendChild(tdName);

                // (2) Min
                const tdMin = document.createElement("td");
                const inputMin = document.createElement("input");
                inputMin.classList.add("form-control"); // [수정]
                if (typeValue === "float") registerBlurValidator(inputMin, isNotFloat, 'float 형태여야 합니다!');
                if (typeValue === "int") registerBlurValidator(inputMin, isNotInt, 'int 형태여야 합니다!');
                inputMin.type = "text";
                inputMin.placeholder = "min";
                if (rowData.min !== undefined) inputMin.value = rowData.min;
                tdMin.appendChild(inputMin);
                tr.appendChild(tdMin);

                // (3) Max
                const tdMax = document.createElement("td");
                const inputMax = document.createElement("input");
                inputMax.classList.add("form-control"); // [수정]
                if (typeValue === "float") registerBlurValidator(inputMax, isNotFloat, 'float 형태여야 합니다!');
                if (typeValue === "int") registerBlurValidator(inputMax, isNotInt, 'int 형태여야 합니다!');
                inputMax.type = "text";
                inputMax.placeholder = "max";
                if (rowData.max !== undefined) inputMax.value = rowData.max;
                tdMax.appendChild(inputMax);
                tr.appendChild(tdMax);

                // (4) Step
                const tdStep = document.createElement("td");
                const inputStep = document.createElement("input");
                inputStep.classList.add("form-control"); // [수정]
                if (typeValue === "float") registerBlurValidator(inputStep, isNotFloat, 'float 형태여야 합니다!');
                if (typeValue === "int") registerBlurValidator(inputStep, isNotInt, 'int 형태여야 합니다!');
                inputStep.type = "text";
                inputStep.placeholder = "step";
                if (rowData.step !== undefined) inputStep.value = rowData.step;
                tdStep.appendChild(inputStep);
                tr.appendChild(tdStep);

                // (5) Log Scale 여부
                const tdLog = document.createElement("td");
                const selectLog = document.createElement("select");
                selectLog.classList.add("form-select"); // [수정]
                selectLog.add(new Option("log scale", "log scale"));
                selectLog.add(new Option("linear", "linear"));
                selectLog.value = rowData.log || "linear";
                tdLog.appendChild(selectLog);
                tr.appendChild(tdLog);

            } else if (typeValue === "category") {
                // (1) Name
                const tdName = document.createElement("td");
                const inputName = document.createElement("input");
                inputName.classList.add("form-control"); // [수정]
                registerBlurValidator(inputName, hasSpecialChar, '숫자, 알파벳 및 언더바(_) 만 허용됩니다.');
                inputName.type = "text";
                inputName.placeholder = "argument name";
                if (rowData.name !== undefined) inputName.value = rowData.name;
                tdName.appendChild(inputName);
                tr.appendChild(tdName);

                // (2) Categories
                const tdCat = document.createElement("td");
                tdCat.colSpan = 4; // [기존] 4칸 합침
                const inputCat = document.createElement("input");
                inputCat.classList.add("form-control"); // [수정]
                registerBlurValidator(inputCat, hasSpecialCharExComma, '숫자, 알파벳, 언더바(_), 콤마(,)만 허용됩니다.');
                inputCat.type = "text";
                inputCat.placeholder = "cat1,cat2,cat3";
                if (rowData.categories !== undefined) inputCat.value = rowData.categories;
                tdCat.appendChild(inputCat);
                tr.appendChild(tdCat);
            }
        }


        // 테이블 내용을 JSON 형태로 추출
        function tableToJson() {
            const rows = settingsTableBody.querySelectorAll("tr");
            const result = [];

            rows.forEach(tr => {
                const cells = tr.querySelectorAll("td");
                // 첫 번째 셀은 '-'버튼, 두 번째 셀은 'type' select
                const typeSelect = cells[1].querySelector("select");
                const typeValue = typeSelect.value;

                let rowData = { type: typeValue };

                if (typeValue === "int" || typeValue === "float") {
                    // 4칸: min, max, step, log
                    const inputName = cells[2].querySelector("input");
                    const inputMin = cells[3].querySelector("input");
                    const inputMax = cells[4].querySelector("input");
                    const inputStep = cells[5].querySelector("input");
                    const selectLog = cells[6].querySelector("select");

                    rowData.name = inputName.value;
                    rowData.min = inputMin.value;
                    rowData.max = inputMax.value;
                    rowData.step = inputStep.value;
                    rowData.log = selectLog.value;
                } else if (typeValue === "category") {
                    // 1칸: categories
                    // category 칸을 colspan=4 했다고 가정
                    const inputName = cells[2].querySelector("input");
                    const inputCat = cells[3].querySelector("input");
                    rowData.name = inputName.value;
                    rowData.categories = inputCat.value;
                }

                result.push(rowData);
            });
            return result;
        }


        /**
        * 일정 시간(duration ms) 동안 화면에 메시지를 띄우고,
        * 시간이 지나면 자동으로 제거하는 함수
        */
        function showTemporaryMessage(message, duration = 3000) {
            const div = document.createElement('div');
            div.textContent = message;
            Object.assign(div.style, {
                position: 'fixed',
                top: '10px',
                right: '10px',
                backgroundColor: 'rgba(255, 0, 0, 0.7)',
                color: '#fff',
                padding: '10px',
                borderRadius: '4px',
                zIndex: 9999
            });
            document.body.appendChild(div);

            setTimeout(() => {
                div.remove();
            }, duration);
        }

        /**
        * 특정 input 요소(el)에 대해 blur 시 validatorFn을 검사.
        * - 조건 실패 시, 3초 짜리 안내 메시지를 띄우고 focus를 다시 el로 이동
        * - message: 조건이 안 맞을 때 띄울 안내문
        */
        function registerBlurValidator(el, validatorFn, message) {
            el.addEventListener('blur', () => {
                if (validatorFn(el.value) && el.value !== '') {
                    // Blur 이벤트 직후에 곧바로 메시지를 띄우면 환경에 따라 포커스 문제가 생길 수 있으므로
                    // setTimeout(…, 0)을 이용해 이벤트 루프가 한 번 돌고 난 뒤에 메시지를 띄움
                    setTimeout(() => {
                        showTemporaryMessage(message, 3000);
                        el.value = ''; // 잘못된 값 제거
                        el.focus();
                    }, 0);
                }
            });
        }

        /**
        * 1) 값이 float 이 아니면 true
        * - JavaScript에서는 정수/실수 구분 없이 모두 Number지만,
        * "유효한 실수 형태인가?"를 간단히 parseFloat 검사로 봅니다.
        */
        function isNotFloat(value) {
            // case1) 이미 number 타입일 경우 → NaN이 아니면 float 가능
            if (typeof value === 'number') {
                return isNaN(value); // NaN이면 true, 아니면 false
            }
            // case2) 문자열인 경우
            if (typeof value === 'string') {
                // parseFloat 결과가 NaN이면 float 불가능
                const parsed = parseFloat(value);
                return isNaN(parsed);
            }
            // 그 외 타입은 float로 볼 수 없으니 true
            return true;
        }

        /**
        * 2) 값이 int 가 아니면 true
        * - "정수 형태인가?"를 Number.isInteger로 검사
        */
        function isNotInt(value) {
            // (1) 소수점 기호 '.' 이 문자열에 포함되어 있으면 "정수 아님"
            if (typeof value === 'number') {
                return !Number.isInteger(value); // 정수면 false, 아니면 true
            }
            if (typeof value === 'string') {
                if (value.includes('.')) {
                    return true;
                }
                const parsed = Number(value);
                // parse가 NaN이 아니고 정수인지 확인
                return isNaN(parsed) || !Number.isInteger(parsed);
            }
            // 그 외 타입은 int로 볼 수 없으니 true
            return true;
        }

        /**
        * 3) 값이 string 이 아니면 true
        */
        function isNotString(value) {
            return typeof value !== 'string';
        }

        /**
        * hasSpecialCharExceptUnderscore:
        * '_'(언더스코어)를 제외한 특수문자가 하나라도 있으면 true
        * - [0-9], [A-Za-z], '_' 이외의 어떤 문자라도 존재하면 true
        */
        function hasSpecialChar(value) {
            const str = String(value);
            // [^0-9A-Za-z_] : 허용되지 않은 문자들을 찾는 정규식
            return /[^0-9A-Za-z_]/.test(str);
        }

        /**
        * hasSpecialCharExceptUnderscore:
        * '_'(언더스코어)를 제외한 특수문자가 하나라도 있으면 true
        * - [0-9], [A-Za-z], '_', ',' 이외의 어떤 문자라도 존재하면 true
        */
        function hasSpecialCharExComma(value) {
            const str = String(value);
            // [^0-9A-Za-z_,] : 허용되지 않은 문자들을 찾는 정규식
            return /[^0-9A-Za-z_,]/.test(str);
        }

    </script>
</body>

</html>```

## main.js
```
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const exec = require('util').promisify(require('child_process').exec);


// statusWindow 모듈 가져오기
const { openStatusWindow, updateStatusWindow, closeStatusWindow } = require('./statusWindow.js');

const isDev = !app.isPackaged;
let childProcess = null;

async function ensurePythonEnv() {
    // 개발 모드면 압축 해제/빌드 로직 스킵
    if (isDev) {
        console.log('[DEBUG] No decompression in development mode');
        return;
    }

    // 기본 경로들
    const mainPath = process.resourcesPath;
    const zipFilePath = path.join(mainPath, 'hpo_env_win.zip');
    const targetDir = path.join(mainPath, 'py_env');
    const pyScriptPath = path.join(mainPath, 'python_scripts');
    const testLocalServerPath = path.join(pyScriptPath, 'test_local_server.py');
    const localServerExePath = path.join(pyScriptPath, 'test_local_server.exe');
    const pythonPath = path.join(targetDir, 'python.exe');

    // 이미 준비돼 있다면 종료
    if (
        fs.existsSync(targetDir) &&
        fs.existsSync(localServerExePath) &&
        !fs.existsSync(testLocalServerPath)
    ) {
        console.log('[INFO] Python env and local server already exist. No action needed.');
        return;
    }

    // 상태 창 열기
    openStatusWindow('<h3>Initializing Environment</h3>');

    // 로그를 남기고 상태창에 표시하는 헬퍼 함수
    const log = (message) => {
        console.log(message);
        updateStatusWindow(message + '<br>');
    };

    // 1) Python 환경 압축 해제
    log('[INFO] Starting to set up the Python environment...');
    try {
        await fs.createReadStream(zipFilePath)
            .pipe(unzipper.Extract({ path: targetDir }))
            .promise();
        log('[INFO] The Python environment has been successfully set up');
    } catch (err) {
        log('[ERROR] Failed to set up the Python environment');
        console.error(err);
    }

    // 2) PyInstaller 빌드
    try {
        log('[INFO] Building...');
        await exec(
            `"${pythonPath}" -m PyInstaller --onefile --console --distpath "${pyScriptPath}" "${testLocalServerPath}"`
        );
        log('[INFO] Successfully built');

        // 빌드 후 사용했던 파이썬 스크립트 제거
        fs.unlinkSync(testLocalServerPath);
        log('[INFO] File cleanup completed');
    } catch (err) {
        log('[ERROR] Failed to build');
        console.error('[ERROR] Failed to build with PyInstaller or delete files', err);
    }

    // 3) 최종 확인 후 성공 or 실패 로그 + 종료 처리
    if (
        fs.existsSync(targetDir) &&
        fs.existsSync(localServerExePath) &&
        !fs.existsSync(testLocalServerPath)
    ) {
        log('[INFO] (Closing the window in 10 seconds)');
        setTimeout(() => closeStatusWindow(), 10000);
    } else {
        log('[ERROR] Required conditions not met. Exiting the Electron app in 10 seconds.');
        setTimeout(() => {
            closeStatusWindow();
            app.quit();
        }, 10000);
    }
}


// 앱 창 생성 함수
function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegrationInSubFrames: true, // <webview> 내부 스크립트 허용
            webviewTag: true  // ← 이걸 반드시 추가해줘야 <webview> 태그가 동작함!
        },
    });

    win.loadFile('index.html');
}



// 앱 실행 시 Python 환경 체크 후 창 띄우기
app.whenReady().then(async () => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    await ensurePythonEnv(); // 압축 해제 (배포 환경에서만)

    const template = [
        {
            label: 'File',
            submenu: [
                { role: 'quit' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About This App',
                    click: () => {
                        // 여기서 정보 표시 / 새 창 띄우기 등
                        console.log('Show about info with my name here');

                        // 1) 상태 창 열고 초기 메시지
                        //openStatusWindow('검사AI개발Task 임희철');
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Toggle DevTools',
                    accelerator: 'Ctrl+Shift+P', // 원하는 키로 변경 가능
                    click: (item, focusedWindow) => {
                        if (focusedWindow) {
                            focusedWindow.webContents.toggleDevTools();
                        }
                    },
                },
                // 다른 메뉴 항목들
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
});

// 창이 모두 닫히면 앱 종료
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// app이 종료되기 직전(모든 윈도우가 닫히거나 quit가 호출되기 직전)
app.on('before-quit', (event) => {
    if (childProcess) {
        // 자식 프로세스 종료
        childProcess.kill();
        childProcess = null;
        console.log("Child process terminated");
    }
});

// ----------------------------------------------------------------------------------------
// 1) Renderer가 "run-command"를 invoke하면, 자식 프로세스를 spawn하고
//    stdout/stderr 발생 시마다 메인 → 렌더러로 이벤트("command-stdout", "command-stderr")를 보냄
//    프로세스 종료 시 "command-close" 이벤트 전송
// ----------------------------------------------------------------------------------------
ipcMain.handle('run-command', async (event, command, args, n_trials) => {
    console.log("cmd:", command, "args:", args);

    if (childProcess) {
        // 자식 프로세스 종료
        childProcess.kill();
        childProcess = null;
        console.log("Child process terminated");
    }

    if (isDev) {
        command = path.resolve(__dirname, '..', 'hpo_env_linux', 'bin', 'python');
        args = [
            path.resolve(__dirname, 'python_scripts', 'test_local_server.py'),
            '--root',
            __dirname
        ];
    }
    else {

        // 기존에 실행된 서버 모두 종료
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);
        const processName = 'test_local_server.exe';

        try {
            // 특정 이름을 가진 모든 프로세스 종료 (콜백 없이 사용)
            const { stdout, stderr } = await execPromise(`taskkill /F /IM ${processName}`);
            console.log(`[INFO] Killed all processes named "${processName}"`);
            if (stdout) console.log('stdout:', stdout);
            if (stderr) console.log('stderr:', stderr);
        } catch (error) {
            // 프로세스가 없으면 'ERROR: The process "xxx" not found.' 같은 메시지가 올 수도 있음
            console.error('[ERROR] Failed to kill process:', error.message);
        }

        //command = path.resolve(process.resourcesPath, 'py_env', 'Scripts', 'python.exe');
        command = path.resolve(process.resourcesPath, 'python_scripts', 'test_local_server.exe')
        args = [
            '--root',
            process.resourcesPath,
        ];
    }

    args = args.concat(['--n_trials', n_trials]);

    console.log("command", command);
    console.log("args", args);
    // if (isDev) {
    // }
    // else {
    //     args.push('--path', 'resources');
    //     console.log("배포 모드에서는 args에 --path resources 추가");
    // }
    return new Promise((resolve, reject) => {
        try {
            // Python 실행
            const child = spawn(command, args);
            childProcess = child;

            // stdout 실시간 전송
            child.stdout.on('data', (data) => {
                event.sender.send('command-stdout', data.toString());
            });

            // stderr 실시간 전송
            child.stderr.on('data', (data) => {
                event.sender.send('command-stderr', data.toString());
            });

            child.on('close', (code) => {
                event.sender.send('command-close', code);
                resolve({ code });
            });

            child.on('error', (err) => {
                event.sender.send('command-error', err.message);
                reject(err);
            });
        } catch (err) {
            reject(err);
        }
    });
});

// 공통 리소스 경로 반환 함수
function getPythonScriptsPath() {
    // 개발 모드 vs. 프로덕션 모드 구분
    if (isDev) {
        // 1) 개발 시(__dirname -> 프로젝트 폴더) 
        //    => "python_scripts" 폴더가 프로젝트 루트/main.js 와 같은 위치에 있는 경우
        return path.join(__dirname, 'python_scripts');
    } else {
        // 2) 프로덕션 빌드 시
        //    => "python_scripts" 폴더가 extraResources 설정에 의해 
        //       asar 바깥 (process.resourcesPath/python_scripts)에 배치됨
        return path.join(process.resourcesPath, 'python_scripts');
    }
}


// 공통 리소스 경로 반환 함수
function getJSONPath() {
    // 개발 모드 vs. 프로덕션 모드 구분
    if (isDev) {
        // 1) 개발 시(__dirname -> 프로젝트 폴더) 
        //    => "python_scripts" 폴더가 프로젝트 루트/main.js 와 같은 위치에 있는 경우
        return path.join(__dirname, 'json_files');
    } else {
        // 2) 프로덕션 빌드 시
        //    => "python_scripts" 폴더가 extraResources 설정에 의해 
        //       asar 바깥 (process.resourcesPath/python_scripts)에 배치됨
        return path.join(process.resourcesPath, 'json_files');
    }
}

// config.json 경로
const configPath = path.join(getJSONPath(), 'config.json');
console.log("configPath:", configPath);

// results.json 경로
const resultsMetricPath = path.join(getJSONPath(), 'best_metric.json');
const resultsParamsPath = path.join(getJSONPath(), 'best_params.json');

// config.json 읽기
ipcMain.handle('load-config', async () => {
    if (!fs.existsSync(configPath)) {
        return [];
    }
    const data = fs.readFileSync(configPath, 'utf-8');
    try {
        return JSON.parse(data);
    } catch (err) {
        console.log("Error parsing json", err);
        return [];
    }
});

// config.json 저장
ipcMain.handle('save-config', async (event, configData) => {
    try {
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error("Error saving config.json", err);
        throw err;
    }
});

// results.json 읽기
ipcMain.handle('load-results', async () => {
    console.error("Executing load-results");
    if (!fs.existsSync(resultsMetricPath) || !fs.existsSync(resultsParamsPath)) {
        return [];
    }
    const dataMetric = JSON.parse(fs.readFileSync(resultsMetricPath, 'utf-8'));
    const dataParams = JSON.parse(fs.readFileSync(resultsParamsPath, 'utf-8'));

    try {
        return [
            "Best metric:\n" + JSON.stringify(dataMetric, null, 4),
            "\n",
            "Best params:\n" + JSON.stringify(dataParams, null, 4)
        ];
    } catch (err) {
        console.log("Error parsing json", err);
        return [];
    }
});


// IPC로 렌더러에 경로를 알려주는 예시
ipcMain.handle('get-dashboard-preload-path', async () => {
    let PATH = '';
    // isDev는 이미 어디선가 선언되어 있다고 가정
    if (isDev) {
        //path.join(__dirname, 'dashboardPreload.js');
        PATH = path.join(__dirname, 'dashboardPreload.js');
    } else {
        //path.join(process.resourcesPath, 'dashboardPreload.js');
        PATH = path.join(process.resourcesPath, 'dashboardPreload.js');
    }
    PATH = pathToFileURL(PATH).href; // Windows 경로 또는 스페이스 바 있어도 문제없도록 하는 코드. 자동으로 file:// 붙여줌
    console.log("dashboard-preload-path", PATH);
    return PATH;
});
```

## preload.js
```
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    runCommand: (cmd, args, n_trials = []) => ipcRenderer.invoke('run-command', cmd, args, n_trials),
    loadConfig: () => ipcRenderer.invoke('load-config'),
    saveConfig: (data) => ipcRenderer.invoke('save-config', data),
    loadResults: () => ipcRenderer.invoke('load-results'), // 이거 자체가 함수 결과를 바로 리턴하는 것이므로, {} 로 감싸서 여러 줄을 작성하면 return 값이 index.html 로 전달이 안됨
    getDashboardPreloadPath: () => ipcRenderer.invoke('get-dashboard-preload-path'),

    // stdout/stderr/close/error 이벤트 실시간 수신
    onCommandStdout: (callback) => {
        ipcRenderer.on('command-stdout', (event, data) => {
            callback(data);
        });
    },
    onCommandStderr: (callback) => {
        ipcRenderer.on('command-stderr', (event, data) => {
            callback(data);
        });
    },
    onCommandClose: (callback) => {
        ipcRenderer.on('command-close', (event, code) => {
            callback(code);
        });
    },
    onCommandError: (callback) => {
        ipcRenderer.on('command-error', (event, errMsg) => {
            callback(errMsg);
        });
    },
});```

## dashboardPreload.js
```
// dashboardPreload.js

window.addEventListener('DOMContentLoaded', () => {
    console.log('dashboardPreload.js done.');
    try {
        // 1) Dark Mode 스위치가 체크되어 있다면 클릭해서 라이트 모드로 전환
        // 문제: 시점 문제. 즉, Material-UI(React) 앱이 로드되는 과정에서, DOMContentLoaded가 이미 뜬 뒤에야 해당 스위치가 “마운트”되거나, 체크 상태가 바뀔 수 있음.
        // 해결: 그래서, MutationObserver 로 “body 내부에 자식이 추가/변경”되는 순간을 계속 감시하다가 darkSwitch가 나타나고 checked=true인 상태가 되면 클릭해서 라이트 모드로 전환합니다.
        const observer = new MutationObserver((mutations, obs) => {
            const darkSwitch = document.querySelector('input[aria-labelledby="switch-list-label-dark-mode"]');
            if (darkSwitch && darkSwitch.checked) {
                darkSwitch.click();
                console.log('Switched to Light Mode');
                obs.disconnect(); // 관찰 중지
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // 2) li 요소 숨기기 (CSS 삽입) 
        // CSS 이용해서 optuna github 페이지로 연결되는 'Send Feedback' 메뉴, '다크모드 전환' 메뉴 제거
        const styleTag = document.createElement('style');
        styleTag.textContent = `
            li[title="Send Feedback"] {
                display: none !important;
            }
            li[title="Dark Mode"] {
                display: none !important;
            }
            `;
        document.head.appendChild(styleTag);
    } catch (error) {
        console.log('dashboardPreload.js error:', error);
    }
});


// btnDashboard.addEventListener("click", async () => { 코드 내부 마지막에 아래 코드를 넣으면, 위에 js 가 라이드모드, css 로 숨기는 부분과 동일한 효과가 생김.

//webview.addEventListener('dom-ready', () => {
//    console.log('[WEBVIEW] dom-ready');
//    // CSS 삽입
//    // 테마 강제 (localStorage) 로직
//    webview.executeJavaScript(`
//        const darkSwitch = document.querySelector('input[aria-labelledby="switch-list-label-dark-mode"]');
//        // 만약 checked=true 라면 => 클릭해서 라이트 모드로 전환
//        if (darkSwitch && darkSwitch.checked) {
//        darkSwitch.click();
//        }
//    `); // 라이트모드로 변환

//    webview.insertCSS(` li[title="Send Feedback"] { display: none !important; } `); // CSS 이용해서 optuna github 페이지의 'Send Feedback' 메뉴 숨김
//    webview.insertCSS(` li[title="Dark Mode"] { display: none !important; } `); // 다크모드 전환기능 제거

//    webview.openDevTools(); // webview 는 개발자 도구를 따로 사용하므로, 필요하다면 여기서 열어줘야 함.
//});```

