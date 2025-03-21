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
            nlohmann::json trial_params = get_json(server_url);
            if (trial_params.empty())
            {
                break;
            }

            // 2) 파라미터로 func 실행
            double auroc = func(trial_params);

            // 3) /score로 점수 POST
            bool ret = post_metric(auroc, server_url);
            if (ret)
            {
                break;
            }
        }
        catch (const std::exception &e)
        {
            std::cerr << "[Client] Finished: " << e.what() << std::endl;
            break;
        }
    }

    std::cout << "[Client] Try the best params." << std::endl;
    // 최적화가 종료된 후, 가장 좋은 파라미터를 받아옴
    nlohmann::json best_params; // 선언을 분리해야 windows 에서 빌드 시 에러 없음. 템플릿 이름 확인(name lookup) 처리 방식이 Linux의 GCC/Clang과 다름.
    best_params = get_json(server_url, "best");

    // best 파라미터로 func 실행
    double auroc = func(best_params);

    return 0;
}