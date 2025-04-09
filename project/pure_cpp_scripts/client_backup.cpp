#include "client.h"
#include <iostream>
#include <string>
#include <thread>
#include <chrono>
#include "json.hpp"
#ifdef _WIN32
// 윈도우: 로컬 폴더의 curl 헤더
#include "libs/curl/curl.h"
#else
// 리눅스: 시스템에 설치된 curl 헤더
#include <curl/curl.h>
#endif

// =============================================
// libcurl로 데이터를 받기 위해 필요한 콜백 함수
// =============================================
size_t WriteCallback(void *contents, size_t size, size_t nmemb, void *userp)
{
    std::string *str = static_cast<std::string *>(userp);
    size_t totalSize = size * nmemb;
    str->append(static_cast<char *>(contents), totalSize);
    return totalSize;
}

// =============================================
// trial_params를 받아서 auroc를 계산하는 예시 함수
// =============================================
double func(const nlohmann::json &trial_params)
{
    double lr = 0.1;
    std::string arc = "mm";

    if (trial_params.contains("lr") && trial_params["lr"].is_number())
    {
        lr = trial_params["lr"].get<double>();
    }
    if (trial_params.contains("arc") && trial_params["arc"].is_string())
    {
        arc = trial_params["arc"].get<std::string>();
    }

    double base_score = 0.8;
    double lr_influence = (lr - 0.1) * 0.1;
    double arc_influence = (arc == "nn") ? 0.12 : 0.0;
    double auroc = base_score + lr_influence + arc_influence;

    return auroc;
}

// =============================================
// 서버에서 Trial 정보를 GET으로 가져옴
// =============================================
nlohmann::json get_json(const std::string &server_url, const std::string &category)
{
    nlohmann::json trial_params;

    if (category != "trial" && category != "best")
    {
        std::cerr << "[Client] Invalid category: " << category << std::endl;
        return trial_params;
    }

    CURL *curl = curl_easy_init();
    if (!curl)
    {
        std::cerr << "[Client] curl init failed." << std::endl;
        return trial_params;
    }

    std::string url = server_url + "/" + category;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);

    std::string readBuffer;
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK)
    {
        std::cerr << "[Client] curl GET error: " << curl_easy_strerror(res) << std::endl;
        curl_easy_cleanup(curl);
        return trial_params;
    }

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
// =============================================
bool post_metric(double auroc, const std::string &server_url)
{
    std::cout << "[Client] Computed auroc: " << auroc << std::endl;

    nlohmann::json score_data;
    score_data["auroc"] = auroc;
    std::string jsonStr = score_data.dump();

    CURL *curl = curl_easy_init();
    if (!curl)
    {
        std::cerr << "[Client] curl init failed." << std::endl;
        return true; // 실패
    }

    std::string url = server_url + "/score";
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);

    struct curl_slist *headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonStr.c_str());

    std::string readBuffer;
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);

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
            std::cout << "[Client] Score posted successfully." << std::endl;
        }
        else
        {
            std::cerr << "[Client] Failed to post score: " << readBuffer << std::endl;
            result = true;
        }
    }

    // 잠시 대기 후 다음 루프
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return result; // true면 실패
}