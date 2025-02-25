// 설치 필요 sudo apt-get install g++ libcurl4-openssl-dev nlohmann-json3-dev
#include <iostream>
#include <string>
#include <thread>
#include <chrono>
#include <curl/curl.h>
#include <nlohmann/json.hpp>

// =============================================
// libcurl로 데이터를 받기 위해 필요한 콜백 함수
// =============================================
static size_t WriteCallback(void *contents, size_t size, size_t nmemb, void *userp)
{
    std::string *str = static_cast<std::string *>(userp);
    size_t totalSize = size * nmemb;
    str->append(static_cast<char *>(contents), totalSize);
    return totalSize;
}

// =============================================
// trial_params를 받아서 auroc를 계산하는 예시 함수
// (Python의 func()에 해당)
// =============================================
double computeAuroc(const nlohmann::json &trial_params)
{
    // 기본값 설정
    double lr = 0.1;
    std::string arc = "mm";

    // JSON 내부에 lr, arc 키가 존재하면 가져오기
    if (trial_params.contains("lr") && trial_params["lr"].is_number())
    {
        lr = trial_params["lr"].get<double>();
    }
    if (trial_params.contains("arc") && trial_params["arc"].is_string())
    {
        arc = trial_params["arc"].get<std::string>();
    }

    // auroc 계산 로직 (예시)
    double base_score = 0.8;
    double lr_influence = (lr - 0.1) * 0.1;
    double arc_influence = (arc == "nn") ? 0.12 : 0.0;
    double auroc = base_score + lr_influence + arc_influence;

    return auroc;
}

/*
 * ----------------------------------------------------------------------------------
 *  curl_easy_setopt() 함수는 libcurl 라이브러리에서 제공하는 함수입니다.
 *  이 함수를 통해 다음과 같은 다양한 동작 옵션을 curl 핸들(CURL* 형태)에게 지시할 수 있습니다.
 *
 *   - 요청할 URL 지정 (CURLOPT_URL)
 *   - 요청에 사용할 콜백 함수(예: 데이터 수신 시 처리 함수) 지정 (CURLOPT_WRITEFUNCTION, etc.)
 *   - POST나 GET 등의 HTTP 메소드 설정
 *   - 헤더 추가, 인증 정보 설정
 *   - 타임아웃, 연결 옵션, SSL 관련 옵션 등
 *
 *  쉽게 말해, curl_easy_setopt는 "curl 핸들에 특정 옵션을 부여"하여
 *  HTTP/FTP 등 네트워크 요청의 다양한 동작 방식을 결정하도록 하는 역할을 합니다.
 *
 *  예시:
 *    // 1) curl 핸들 생성
 *    CURL* curl = curl_easy_init();
 *
 *    // 2) curl 핸들에 옵션 부여
 *    curl_easy_setopt(curl, CURLOPT_URL, "http://example.com");
 *    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
 *    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);
 *    // ... 필요에 따라 다른 옵션들을 지정
 *
 *    // 3) 요청 실행
 *    CURLcode res = curl_easy_perform(curl);
 *
 *    // 4) 요청 후 정리
 *    curl_easy_cleanup(curl);
 *
 *  각 옵션에 따라 값의 타입(문자열, 함수 포인터, 정수 등)이 다르므로
 *  libcurl 공식 문서에서 "CURLOPT_*" 옵션 리스트와 해당 옵션에 필요한 인자 유형을
 *  참고하여 올바른 방식을 사용해야 합니다.
 *
 *  만약 옵션 설정이 성공하면 대체로 CURLE_OK를, 잘못된 옵션이나 유효하지 않은 인자를
 *  전달하면 다른 에러 코드를 반환합니다.
 *
 *  주요 구조:
 *    - CURL* curl = curl_easy_init();         // libcurl 핸들 생성
 *    - curl_easy_setopt(curl, ... , ...);     // 필요한 옵션들 설정
 *    - curl_easy_perform(curl);               // 실제 요청 수행
 *    - curl_easy_cleanup(curl);               // 자원 정리
 *
 * ----------------------------------------------------------------------------------
 */

// =============================================
// 서버에서 Trial 정보를 GET으로 가져옴
// (Python의 get_json(server_url) 역할)
// =============================================
nlohmann::json getTrialParams(const std::string &server_url)
{
    nlohmann::json trial_params;
    // 최종적으로 반환할 JSON. 오류 시 비어있는 객체를 반환.

    // 1) libcurl 초기화
    CURL *curl = curl_easy_init(); // * 포인터 선언
    if (!curl)
    {
        std::cerr << "[Client] curl init failed." << std::endl;
        return trial_params; // 빈 JSON
    }

    // 2) 요청할 URL 설정
    std::string url = server_url + "/trial";
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

    // 3) 응답을 저장할 버퍼
    std::string readBuffer;
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);

    // 4) 타임아웃(10초)
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);

    // 5) 실제 요청 수행
    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK)
    {
        std::cerr << "[Client] curl GET error: " << curl_easy_strerror(res) << std::endl;
        curl_easy_cleanup(curl);
        return trial_params; // 빈 JSON
    }

    // 6) HTTP 응답 코드 확인
    long response_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);

    if (response_code == 200)
    {
        try
        {
            trial_params = nlohmann::json::parse(readBuffer);
            std::cout << "[Client] Received trial params: " << trial_params.dump() << std::endl;
        }
        catch (const std::exception &e)
        {
            std::cerr << "[Client] JSON parse error: " << e.what() << std::endl;
        }
    }
    else
    {
        std::cerr << "[Client] No more trial or error: " << readBuffer << std::endl;
    }

    curl_easy_cleanup(curl);
    return trial_params;
}

// =============================================
// auroc를 서버에 POST로 전송
// (Python의 post_metric(auroc, server_url) 역할)
// =============================================
bool postMetric(double auroc, const std::string &server_url)
{
    // 1) JSON 바디 생성
    nlohmann::json score_data;
    score_data["auroc"] = auroc;
    std::string jsonStr = score_data.dump();

    // 2) curl 초기화
    CURL *curl = curl_easy_init();
    if (!curl)
    {
        std::cerr << "[Client] curl init failed." << std::endl;
        return true; // 실패
    }

    // 3) URL 설정
    std::string url = server_url + "/score";
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);

    // POST로 전송
    curl_easy_setopt(curl, CURLOPT_POST, 1L);

    // JSON 헤더 설정
    struct curl_slist *headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    // 전송할 데이터 설정
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonStr.c_str());

    // 응답 버퍼 세팅
    std::string readBuffer;
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);

    // 실제 전송
    CURLcode res = curl_easy_perform(curl);

    bool result = false;
    if (res != CURLE_OK)
    {
        std::cerr << "[Client] Failed to POST score: "
                  << curl_easy_strerror(res) << std::endl;
        result = true; // 실패
    }
    else
    {
        long response_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
        if (response_code == 200)
        {
            std::cout << "[Client] Computed auroc: " << auroc << std::endl;
            std::cout << "[Client] Score posted successfully." << std::endl;
            result = false; // 성공
        }
        else
        {
            std::cerr << "[Client] Failed to post score: " << readBuffer << std::endl;
            result = true; // 실패
        }
    }

    // 자원 해제
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    return result; // true면 실패
}

// =============================================
// 메인 함수 (Python의 main()에 해당)
// =============================================
int main()
{
    std::string server_url = "http://127.0.0.1:8005";

    while (true)
    {
        try
        {
            // 1) /trial에서 파라미터 GET
            nlohmann::json trial_params = getTrialParams(server_url);
            if (trial_params.empty())
            {
                // trial_params가 비어있으면 더 이상 진행할 trial이 없다고 가정
                break;
            }

            // 2) 파라미터로 모델 학습/검증 후 auroc 계산
            double auroc = computeAuroc(trial_params);

            // 3) /score 로 점수 POST
            bool isFail = postMetric(auroc, server_url);
            if (isFail)
            {
                // 점수 전송에 실패한 경우, 상황에 따라 종료
                break;
            }

            // 잠시 대기 후 다음 루프
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        catch (const std::exception &e)
        {
            std::cerr << "[Client] Exception occurred: " << e.what() << std::endl;
            break;
        }
    }

    return 0;
}
