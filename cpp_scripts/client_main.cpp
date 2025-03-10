#include "client.h"
#include <iostream>
#include <thread>
#include <chrono>

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
        }
        catch (const std::exception &e)
        {
            std::cerr << "[Client] Exception occurred: " << e.what() << std::endl;
            break;
        }
    }

    return 0;
}
