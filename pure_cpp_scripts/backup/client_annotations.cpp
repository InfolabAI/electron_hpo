#include <iostream>          // iostream: C++ 입출력 스트림(표준 입출력) 기능 제공 (std::cout, std::cin 등)
#include <string>            // string: C++에서 문자열을 다루는 std::string 클래스
#include <thread>            // thread: C++11 스레드 라이브러리 기능
#include <chrono>            // chrono: 시간 관련 기능(초, 밀리초 등)을 다루는 라이브러리
#include <curl/curl.h>       // libcurl의 C용 헤더, HTTP 요청에 사용
#include <nlohmann/json.hpp> // JSON 라이브러리(nlohmann.json)의 헤더
#include "client.h"          // #include: 전처리 지시자로, "client.h"라는 헤더 파일을 소스에 포함

// =============================================
// libcurl로 데이터를 받기 위해 필요한 콜백 함수
// =============================================
size_t WriteCallback(void *contents, size_t size, size_t nmemb, void *userp)
{
    // void* contents: C 스타일 포인터, 수신한 데이터의 시작 주소
    // size_t size: 수신한 '덩어리'의 크기 (바이트 단위)
    // size_t nmemb: '덩어리'가 몇 개인지
    // void* userp: 사용자가 임의로 넘긴 포인터(여기서는 std::string*를 넣어둠)

    std::string *str = static_cast<std::string *>(userp);
    // static_cast<타입>(값): C++에서 타입을 안전하게 변환하는 캐스팅 연산자
    // 여기서는 void* → std::string*로 변환

    size_t totalSize = size * nmemb;
    // size와 nmemb를 곱해 전체 바이트 수 계산

    str->append(static_cast<char *>(contents), totalSize);
    // '->'는 포인터가 가리키는 객체의 멤버에 접근할 때 사용 (str 포인터가 가리키는 std::string 객체의 append 함수 호출)
    // static_cast<char *>(contents): void*를 char*로 변환
    // str->append(..., totalSize): 받은 데이터를 std::string 끝에 이어 붙임

    return totalSize;
    // 콜백 함수는 처리한(또는 소비한) 바이트 수를 반환해야 함
}

// =============================================
// trial_params를 받아서 auroc를 계산하는 예시 함수
// =============================================
double computeAuroc(const nlohmann::json &trial_params)
{
    // const nlohmann::json&: nlohmann::json 타입을 '상수 참조'로 받는다는 의미
    // JSON 객체를 복사 없이 참조하고, 수정은 불가능(const)

    double lr = 0.1;
    // 실수형 변수 lr을 0.1로 초기화

    std::string arc = "mm";
    // 문자열 변수 arc를 "mm"로 초기화

    if (trial_params.contains("lr") && trial_params["lr"].is_number())
    {
        // trial_params 내 "lr" 키가 존재하며 값이 숫자인지 확인
        lr = trial_params["lr"].get<double>();
        // get<double>() : JSON 값을 double 타입으로 추출
    }

    if (trial_params.contains("arc") && trial_params["arc"].is_string())
    {
        // trial_params 내 "arc" 키가 존재하며 값이 문자열인지 확인
        arc = trial_params["arc"].get<std::string>();
        // get<std::string>() : JSON 값을 std::string으로 추출
    }

    double base_score = 0.8;
    double lr_influence = (lr - 0.1) * 0.1;
    // 학습률(lr) 값이 바뀔 때마다 오차(?)를 가중치로 계산하는 예시

    double arc_influence = (arc == "nn") ? 0.12 : 0.0;
    // (조건) ? (참일 때) : (거짓일 때)
    // 삼항 연산자(ternary operator): Python의 x if cond else y와 유사
    // arc가 "nn"이면 0.12, 아니면 0.0

    double auroc = base_score + lr_influence + arc_influence;
    // 최종 auroc 값을 간단히 합산해서 구하는 예시

    return auroc;
    // 함수의 반환값(auroc)을 double 타입으로 반환
}

// =============================================
// 서버에서 Trial 정보를 GET으로 가져옴
// =============================================
nlohmann::json getTrialParams(const std::string &server_url)
{
    // 인자로 받은 server_url을 통해 HTTP GET 요청 후 JSON 데이터를 가져온다
    // 반환 타입은 nlohmann::json

    nlohmann::json trial_params;
    // trial_params라는 JSON 객체를 초기화

    CURL *curl = curl_easy_init();
    // curl_easy_init(): libcurl 사용을 위한 CURL 핸들 생성
    if (!curl)
    {
        std::cerr << "[Client] curl init failed." << std::endl;
        // std::cerr: 표준 에러 출력 스트림
        // << 연산자: C++의 '스트림 삽입 연산자'로 문자열 등을 출력 스트림에 전달
        return trial_params;
        // curl 생성 실패 시, 빈 trial_params 반환
    }

    std::string url = server_url + "/trial";
    // url 문자열을 합쳐 "/trial" 엔드포인트로

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    // curl_easy_setopt: CURL 핸들에 설정값을 적용
    // CURLOPT_URL: 요청할 URL 설정
    // url.c_str(): std::string을 C 스타일 문자열(char*)로 변환

    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
    // 요청 타임아웃을 10초로 설정

    std::string readBuffer;
    // 수신한 데이터를 저장할 버퍼(문자열)

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    // 서버로부터 데이터를 받을 때 호출될 콜백 함수를 설정

    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);
    // 콜백 함수 WriteCallback의 userp 인자로 &readBuffer(문자열 포인터)를 넘김

    CURLcode res = curl_easy_perform(curl);
    // 실질적으로 HTTP GET 요청을 수행
    // res는 요청 결과 상태를 나타내는 enum 값

    if (res != CURLE_OK)
    {
        // CURLE_OK가 아니면 요청이 실패했음을 의미
        std::cerr << "[Client] curl GET error: " << curl_easy_strerror(res) << std::endl;
        // curl_easy_strerror(res): libcurl에서 에러 메시지를 문자열로 변환
        curl_easy_cleanup(curl);
        // curl 핸들 정리
        return trial_params;
    }

    long response_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
    // response_code에 HTTP 응답 코드를 가져옴 (200, 404 등)

    if (response_code == 200)
    {
        // 정상 응답(200)인 경우
        try
        {
            trial_params = nlohmann::json::parse(readBuffer);
            // readBuffer 문자열을 JSON으로 파싱
            std::cout << "[Client] Received trial params: "
                      << trial_params.dump() << std::endl;
            // std::cout: 표준 출력 스트림
            // trial_params.dump(): JSON 객체를 문자열로 변환
        }
        catch (const std::exception &e)
        {
            // JSON 파싱 실패나 기타 예외 처리
            std::cerr << "[Client] JSON parse error: " << e.what() << std::endl;
        }
    }
    else
    {
        // 200이 아닌 경우 (400, 404 등)
        std::cerr << "[Client] No more trial or error: " << readBuffer << std::endl;
    }

    curl_easy_cleanup(curl);
    // 사용한 curl 핸들을 정리(메모리 해제)
    return trial_params;
    // 가져온 trial_params(JSON) 반환
}

// =============================================
// auroc를 서버에 POST로 전송
// =============================================
bool postMetric(double auroc, const std::string &server_url)
{
    // auroc: 계산된 auroc 점수
    // server_url: 서버 주소
    // 반환값 bool: true이면 실패, false이면 성공(뒤에서 result로 관리)

    nlohmann::json score_data;
    score_data["auroc"] = auroc;
    // JSON 객체에 "auroc" 키로 점수를 저장

    std::string jsonStr = score_data.dump();
    // JSON 객체를 직렬화하여 문자열로 만듦

    CURL *curl = curl_easy_init();
    if (!curl)
    {
        std::cerr << "[Client] curl init failed." << std::endl;
        return true; // 실패 시 true
    }

    std::string url = server_url + "/score";
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    // POST를 보낼 URL 설정

    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    // 타임아웃 5초

    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    // CURLOPT_POST: HTTP 메서드를 POST로 설정

    struct curl_slist *headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    // HTTP 헤더에 "Content-Type: application/json"을 추가
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    // POST 요청에 위에서 만든 헤더 리스트를 사용

    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonStr.c_str());
    // POST 본문(body)에 JSON 문자열을 추가

    std::string readBuffer;
    // 서버 응답을 담을 버퍼

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    // 수신 콜백 함수 설정

    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);
    // userp로 readBuffer를 넘김

    CURLcode res = curl_easy_perform(curl);
    // POST 요청 실행

    bool result = false; // 실패 여부를 나타낼 플래그 (false: 성공, true: 실패)

    if (res != CURLE_OK)
    {
        // 요청 자체가 실패
        std::cerr << "[Client] Failed to POST score: "
                  << curl_easy_strerror(res) << std::endl;
        result = true; // 실패
    }
    else
    {
        long response_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
        // HTTP 응답 코드 확인
        if (response_code == 200)
        {
            // 정상
            std::cout << "[Client] Computed auroc: " << auroc << std::endl;
            std::cout << "[Client] Score posted successfully." << std::endl;
        }
        else
        {
            // 오류 상황
            std::cerr << "[Client] Failed to post score: " << readBuffer << std::endl;
            result = true;
        }
    }

    // 잠시 대기 후 다음 루프
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    // this_thread::sleep_for: C++11에서 스레드를 일시 중단
    // chrono::milliseconds(100): 100ms 만큼 중단

    curl_slist_free_all(headers);
    // 추가한 헤더 리스트 해제

    curl_easy_cleanup(curl);
    // curl 핸들 해제

    return result; // true면 실패, false면 성공
}

// ---
//
// ## 주요 C++ 문법 설명 요약
//
// 1. **전처리 지시자(`#include`)**
//    - 컴파일 전에 지정된 헤더 파일을 미리 가져오도록 지시합니다.
//    - Python에서 `import`와 유사한 개념이지만, C++에서는 *소스 코드 자체*에 파일 내용을 복사해오는 방식입니다.
//
// 2. **네임스페이스(std::)**
//    - C++ 표준 라이브러리가 제공하는 함수·클래스는 모두 `std` 네임스페이스 아래에 존재합니다.
//    - 예: `std::string`, `std::cout`, `std::vector` 등.
//
// 3. **포인터(`*`, `&`, `->`)**
//    - `*`는 포인터 선언 또는 역참조를 나타내고, `&`는 참조(Reference) 혹은 주소 연산자를 의미합니다.
//    - `->`는 포인터를 통해 가리키는 객체의 멤버에 접근할 때 사용합니다. (Python에는 이런 개념이 없고, 객체 참조는 자동)
//
// 4. **참조(Reference) (`&`)**
//    - 함수 인자를 `const Type&`처럼 쓰면, **복사 없이** 원본 객체에 대한 참조를 읽기 전용으로 사용합니다.
//
// 5. **형 변환(`static_cast`)**
//    - `static_cast<T>(value)`는 C++에서 타입 간 변환을 명시하는 안전한 연산자입니다.
//    - C 스타일의 `(T)value` 변환보다 안전하고 명시적입니다.
//
// 6. **스트림 연산자(`<<`, `>>`)**
//    - `<<`: 출력 스트림 삽입 연산자. 예) `std::cout << "Hello"`
//    - `>>`: 입력 스트림 추출 연산자. 예) `std::cin >> variable`
//    - Python의 `print()`와 달리, C++에서는 `std::cout << 값` 형태로 출력합니다.
//
// 7. **삼항 연산자(`? :`)**
//    - `조건 ? 참일 때 : 거짓일 때`
//    - Python의 `(참일 때) if (조건) else (거짓일 때)`와 유사합니다.
//
// 8. **함수 반환 타입**
//    - `double functionName(...) { ... }` 처럼, 함수가 어떤 자료형을 반환하는지 명시적으로 표기해야 합니다.
//    - Python은 동적 타이핑으로 반환 타입을 명시하지 않지만, C++은 정적 타이핑이라 컴파일 시점에 타입이 정해져야 합니다.
//
// 9. **스레드와 시간**
//    - `#include <thread>`와 `#include <chrono>`: C++11부터 표준 스레드, 시간 관련 라이브러리를 지원합니다.
//    - `std::this_thread::sleep_for(std::chrono::milliseconds(100))`: 현재 스레드를 100ms 동안 정지.
//
// 10. **예외 처리(`try`, `catch`)**
//     - C++에서 예외 발생 시 `throw`로 던지고, `try`-`catch`로 처리합니다.
//     - Python의 `try-except`와 유사하지만, 문법과 예외 클래스 구조가 다릅니다.
//
// ---
//
// 이렇게 C++ 코드의 각 줄에 대한 상세 설명을 붙이면, Python과 달리 C++에서 **포인터**, **레퍼런스**, **스트림 연산자**, **삼항 연산자** 등이 어떻게 작동하는지 이해할 수 있습니다.
// 또한 libcurl을 통해 HTTP 요청을 하는 부분, JSON 라이브러리를 통해 데이터를 파싱/직렬화(`parse`, `dump`)하는 부분도 확인하시면 됩니다.