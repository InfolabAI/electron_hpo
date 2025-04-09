#include "client.h"
#include <iostream>
#include <string>
#include <thread>
#include <chrono>
#include <random>
#include <cmath>
#include "json.hpp"
#ifdef _WIN32
// Windows: curl header from local folder
#include "libs/curl/curl.h"
#else
// Linux: curl header from system installation
#include <curl/curl.h>
#endif

// For command line argument parsing
#include <vector>
#include <algorithm>

// =============================================
// Callback function needed to receive data with libcurl
// =============================================
size_t WriteCallback(void *contents, size_t size, size_t nmemb, void *userp)
{
    std::string *str = static_cast<std::string *>(userp);
    size_t totalSize = size * nmemb;
    str->append(static_cast<char *>(contents), totalSize);
    return totalSize;
}

// =============================================
// Example function for model training + validation score calculation
// =============================================
double func(const nlohmann::json &params)
{
    /*
    Example function for model training + validation score calculation
    In practice, this section would contain the model training and evaluation code
    */
    double lr = 0.1;
    std::string arc = "mm";

    if (params.contains("lr") && params["lr"].is_number())
    {
        lr = params["lr"].get<double>();
    }
    if (params.contains("arc") && params["arc"].is_string())
    {
        arc = params["arc"].get<std::string>();
    }

    double base_score = 0.8;
    double lr_influence = (lr - 0.1) * 0.1;
    double arc_influence = (arc == "nn") ? 0.12 : 0.0;
    double auroc = base_score + lr_influence + arc_influence;

    return auroc;
}

// =============================================
// Request new trial parameters from server
// =============================================
std::pair<std::string, nlohmann::json> get_trial_params(const std::string &server_url, const std::string &study_id, int max_retries)
{
    /*
    Request new trial parameters from server
    If study_id is empty, the server will create a new study_id and return it
    */
    std::string endpoint = server_url + "/trial";
    if (!study_id.empty()) {
        endpoint += "?study_id=" + study_id;
    }

    std::string received_study_id;
    nlohmann::json params;

    for (int retry = 0; retry < max_retries; retry++) {
        std::cout << "[Client] Requesting new trial parameters... (attempt " << (retry + 1) << "/" << max_retries << ")" << std::endl;

        CURL *curl = curl_easy_init();
        if (!curl) {
            std::cerr << "[Client] curl init failed." << std::endl;
            continue;
        }

        curl_easy_setopt(curl, CURLOPT_URL, endpoint.c_str());
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);

        std::string readBuffer;
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);

        CURLcode res = curl_easy_perform(curl);
        if (res != CURLE_OK) {
            std::cerr << "[Client] Error during request: " << curl_easy_strerror(res) << std::endl;
            curl_easy_cleanup(curl);
            
            // Retry if not the last attempt
            if (retry < max_retries - 1) {
                std::random_device rd;
                std::mt19937 gen(rd());
                std::uniform_real_distribution<> dis(0.5, 1.0);
                double random_factor = dis(gen);
                double wait_time = std::pow(2, retry) * random_factor;
                
                std::cout << "[Client] Retrying in " << wait_time << " seconds..." << std::endl;
                std::this_thread::sleep_for(std::chrono::duration<double>(wait_time));
            }
            continue;
        }

        long response_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
        curl_easy_cleanup(curl);

        if (response_code == 200) {
            try {
                nlohmann::json response_json = nlohmann::json::parse(readBuffer);
                received_study_id = response_json["study_id"].get<std::string>();
                params = response_json["params"];
                
                std::cout << "[Client] Successfully received new trial parameters: study_id=" << received_study_id 
                          << ", params=" << params.dump() << std::endl;
                
                return {received_study_id, params};
            }
            catch (const std::exception &e) {
                std::cerr << "[Client] JSON parsing error: " << e.what() << std::endl;
            }
        } else {
            std::cerr << "[Client] Failed to request parameters: HTTP " << response_code << " - " << readBuffer << std::endl;
        }

        // Retry if not the last attempt
        if (retry < max_retries - 1) {
            std::random_device rd;
            std::mt19937 gen(rd());
            std::uniform_real_distribution<> dis(0.5, 1.0);
            double random_factor = dis(gen);
            double wait_time = std::pow(2, retry) * random_factor;
            
            std::cout << "[Client] Retrying in " << wait_time << " seconds..." << std::endl;
            std::this_thread::sleep_for(std::chrono::duration<double>(wait_time));
        }
    }

    std::cout << "[Client] Maximum retry attempts exceeded, failed to request parameters" << std::endl;
    return {"", nlohmann::json()};
}

// =============================================
// Submit trial result score to server
// =============================================
bool submit_score(const std::string &server_url, const std::string &study_id, double score, int max_retries)
{
    /*
    Submit trial result score to server
    */
    std::string endpoint = server_url + "/score?study_id=" + study_id;
    nlohmann::json payload;
    payload["score"] = score;
    std::string jsonStr = payload.dump();

    for (int retry = 0; retry < max_retries; retry++) {
        std::cout << "[Client] Submitting score: score=" << score << ", study_id=" << study_id 
                  << " (attempt " << (retry + 1) << "/" << max_retries << ")" << std::endl;

        CURL *curl = curl_easy_init();
        if (!curl) {
            std::cerr << "[Client] curl init failed." << std::endl;
            continue;
        }

        curl_easy_setopt(curl, CURLOPT_URL, endpoint.c_str());
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
        curl_easy_setopt(curl, CURLOPT_POST, 1L);

        struct curl_slist *headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/json");
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonStr.c_str());

        std::string readBuffer;
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);

        CURLcode res = curl_easy_perform(curl);
        if (res != CURLE_OK) {
            std::cerr << "[Client] Error during request: " << curl_easy_strerror(res) << std::endl;
            curl_slist_free_all(headers);
            curl_easy_cleanup(curl);
            
            // Retry if not the last attempt
            if (retry < max_retries - 1) {
                std::random_device rd;
                std::mt19937 gen(rd());
                std::uniform_real_distribution<> dis(0.5, 1.0);
                double random_factor = dis(gen);
                double wait_time = std::pow(2, retry) * random_factor;
                
                std::cout << "[Client] Retrying in " << wait_time << " seconds..." << std::endl;
                std::this_thread::sleep_for(std::chrono::duration<double>(wait_time));
            }
            continue;
        }

        long response_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (response_code == 200) {
            std::cout << "[Client] Score submission successful!" << std::endl;
            return true;
        } else {
            std::cerr << "[Client] Score submission failed: HTTP " << response_code << " - " << readBuffer << std::endl;
        }

        // Retry if not the last attempt
        if (retry < max_retries - 1) {
            std::random_device rd;
            std::mt19937 gen(rd());
            std::uniform_real_distribution<> dis(0.5, 1.0);
            double random_factor = dis(gen);
            double wait_time = std::pow(2, retry) * random_factor;
            
            std::cout << "[Client] Retrying in " << wait_time << " seconds..." << std::endl;
            std::this_thread::sleep_for(std::chrono::duration<double>(wait_time));
        }
    }

    std::cout << "[Client] Maximum retry attempts exceeded, failed to submit score" << std::endl;
    return false;
}

// =============================================
// Request best parameters from server
// =============================================
nlohmann::json get_best_params(const std::string &server_url, const std::string &study_id, int max_retries)
{
    /*
    Request best parameters from server
    */
    std::string endpoint = server_url + "/best?study_id=" + study_id;

    for (int retry = 0; retry < max_retries; retry++) {
        std::cout << "[Client] Requesting best parameters... (attempt " << (retry + 1) << "/" << max_retries << ")" << std::endl;

        CURL *curl = curl_easy_init();
        if (!curl) {
            std::cerr << "[Client] curl init failed." << std::endl;
            continue;
        }

        curl_easy_setopt(curl, CURLOPT_URL, endpoint.c_str());
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);

        std::string readBuffer;
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);

        CURLcode res = curl_easy_perform(curl);
        if (res != CURLE_OK) {
            std::cerr << "[Client] Error during request: " << curl_easy_strerror(res) << std::endl;
            curl_easy_cleanup(curl);
            
            // Retry if not the last attempt
            if (retry < max_retries - 1) {
                std::random_device rd;
                std::mt19937 gen(rd());
                std::uniform_real_distribution<> dis(0.5, 1.0);
                double random_factor = dis(gen);
                double wait_time = std::pow(2, retry) * random_factor;
                
                std::cout << "[Client] Retrying in " << wait_time << " seconds..." << std::endl;
                std::this_thread::sleep_for(std::chrono::duration<double>(wait_time));
            }
            continue;
        }

        long response_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
        curl_easy_cleanup(curl);

        if (response_code == 200) {
            try {
                nlohmann::json response_json = nlohmann::json::parse(readBuffer);
                nlohmann::json best_params = response_json["params"];
                std::cout << "[Client] Successfully received best parameters: " << best_params.dump() << std::endl;
                return best_params;
            }
            catch (const std::exception &e) {
                std::cerr << "[Client] JSON parsing error: " << e.what() << std::endl;
            }
        } else {
            std::cerr << "[Client] Failed to request best parameters: HTTP " << response_code << " - " << readBuffer << std::endl;
        }

        // Retry if not the last attempt
        if (retry < max_retries - 1) {
            std::random_device rd;
            std::mt19937 gen(rd());
            std::uniform_real_distribution<> dis(0.5, 1.0);
            double random_factor = dis(gen);
            double wait_time = std::pow(2, retry) * random_factor;
            
            std::cout << "[Client] Retrying in " << wait_time << " seconds..." << std::endl;
            std::this_thread::sleep_for(std::chrono::duration<double>(wait_time));
        }
    }

    std::cout << "[Client] Maximum retry attempts exceeded, failed to request best parameters" << std::endl;
    return nlohmann::json();
}