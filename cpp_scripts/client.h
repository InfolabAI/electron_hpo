#pragma once
#include <nlohmann/json.hpp>
#include <string>

// 함수 프로토타입만 선언
size_t WriteCallback(void *contents, size_t size, size_t nmemb, void *userp);
double computeAuroc(const nlohmann::json &trial_params);
nlohmann::json getTrialParams(const std::string &server_url);
bool postMetric(double auroc, const std::string &server_url);
