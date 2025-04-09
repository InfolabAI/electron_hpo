// #pragma once
//// #include <nlohmann/json.hpp>
// #include "libs/json.hpp"
// #include <string>
//
//// 함수 프로토타입만 선언
// size_t WriteCallback(void *contents, size_t size, size_t nmemb, void *userp);
// double computeAuroc(const nlohmann::json &trial_params);
// nlohmann::json getTrialParams(const std::string &server_url);
// bool postMetric(double auroc, const std::string &server_url);
// 위는 원본 코드

#pragma once

// ===== 플랫폼에 따라 export 매크로 정의 =====
#ifdef _WIN32 // 윈도우 환경
#ifdef BUILDING_DLL
#define CLIENT_API __declspec(dllexport)
#else
#define CLIENT_API __declspec(dllimport)
#endif
#else // 리눅스 등 윈도우가 아닌 환경
#define CLIENT_API
#endif

#include "json.hpp"
#include <string>

// DLL(또는 So)로 내보낼 함수들에 CLIENT_API 매크로 사용
CLIENT_API size_t WriteCallback(void *contents, size_t size, size_t nmemb, void *userp);
CLIENT_API double func(const nlohmann::json &trial_params);
CLIENT_API nlohmann::json get_json(const std::string &server_url, const std::string &category = "trial");
CLIENT_API bool post_metric(double auroc, const std::string &server_url);
