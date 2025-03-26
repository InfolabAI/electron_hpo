// dashboardPreload.js

window.addEventListener('DOMContentLoaded', () => {
    console.log('dashboardPreload.js done.');
    try {
        // 1) Dark Mode 스위치가 체크되어 있다면 클릭해서 라이트 모드로 전환
        // 문제: 시점 문제. 즉, Material-UI(React) 앱이 로드되는 과정에서, DOMContentLoaded가 이미 뜬 뒤에야 해당 스위치가 “마운트”되거나, 체크 상태가 바뀔 수 있음.
        // 해결: 그래서, MutationObserver 로 “body 내부에 자식이 추가/변경”되는 순간을 계속 감시하다가 darkSwitch가 나타나고 checked=true인 상태가 되면 클릭해서 라이트 모드로 전환합니다.
        const observer = new MutationObserver((mutations, obs) => {
            let doneDarkMode = false;
            let doneStackText = false;
            let doneToolbarText = false;

            // (1) 다크 모드 스위치 끄기
            const darkSwitch = document.querySelector('input[aria-labelledby="switch-list-label-dark-mode"]');
            if (darkSwitch && darkSwitch.checked) {
                darkSwitch.click();
                console.log('Switched to Light Mode');
            }
            // 스위치가 없거나 이미 꺼져 있어도, 일단 “처리 끝”으로 설정 (무한 반복 방지)
            doneDarkMode = true;

            // (2) h5Element "Heechul Lim"으로 변경
            const stackDiv = document.querySelector('.MuiStack-root.css-j7qwjs');
            if (stackDiv) {
                const h5Element = stackDiv.querySelector('h5');
                if (h5Element) {
                    h5Element.textContent = 'From LHC';
                }
                // 존재하든 말든, 해당 로직은 시도 끝났으므로 true
                doneStackText = true;
            } else {
                // stackDiv가 아직 안 생겼으면 추후 생길 수도 있으니 지금은 false
                // 필요에 따라 doneStackText = true 로 해두어도 됩니다.
                doneStackText = false;
            }

            // (3) Toolbar "LG HPOptimizer Dashboard" 추가
            const toolbar = document.querySelector('.MuiToolbar-root.MuiToolbar-gutters.MuiToolbar-regular.css-ei1h7q');
            if (toolbar) {
                // 이미 추가된 경우 중복 생성 방지
                if (!toolbar.querySelector('.my-toolbar-label')) {
                    const label = document.createElement('span');
                    label.classList.add('my-toolbar-label');
                    label.textContent = 'HPOptimizer Dashboard';
                    // 원하면 스타일 지정
                    label.style.marginLeft = '30px';
                    label.style.fontWeight = 'bold';   // 굵게
                    label.style.fontSize = '30px';     // 글자 크기
                    label.style.color = '#FFCFCF';         // 글자 색상
                    toolbar.appendChild(label);
                }
                doneToolbarText = true;
            } else {
                doneToolbarText = false;
            }

            // (4) 모든 작업이 끝났다면 옵저버 중단
            // => 세 조건이 모두 true가 되어야 멈춤
            //if (doneDarkMode && doneStackText && doneToolbarText) {
            //    obs.disconnect();
            //}
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
            /* 첫 번째 헤더 h5는 그대로 두고, p와 span만 숨깁니다. */
            .MuiStack-root.css-j7qwjs p,
            .MuiStack-root.css-j7qwjs span {
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
//});