#include "client.h"
#include <iostream>
#include <thread>
#include <chrono>


// =============================================
// Simple command line argument parsing function
// =============================================
std::string get_arg_value(const std::vector<std::string> &args, const std::string &option, const std::string &default_value = "")
{
    auto it = std::find(args.begin(), args.end(), option);
    if (it != args.end() && ++it != args.end()) {
        return *it;
    }
    return default_value;
}

// =============================================
// Main function
// =============================================
int main(int argc, char *argv[])
{
    // Parse command line arguments
    std::vector<std::string> args(argv, argv + argc);
    std::string server_url = get_arg_value(args, "--server_url", "http://127.0.0.1:8005");
    std::string study_id = get_arg_value(args, "--study_id", "");
    std::string max_trials_str = get_arg_value(args, "--max_trials", "50");
    int max_trials = std::stoi(max_trials_str);

    // Print initialization messages
    std::cout << "[Client] Starting hyperparameter optimization" << std::endl;
    std::cout << "[Client] - Server URL: " << server_url << std::endl;
    std::cout << "[Client] - Study ID: " << (study_id.empty() ? "auto-generated" : study_id) << std::endl;
    std::cout << "[Client] - Maximum trials: " << max_trials << std::endl;

    int trial_count = 0;

    try {
        // Perform each trial
        for (int trial_idx = 1; trial_idx <= max_trials; trial_idx++) {
            std::cout << "\n[Client] === Starting Trial " << trial_idx << "/" << max_trials << " ===" << std::endl;

            // 1. Request new parameters
            std::pair<std::string, nlohmann::json> result = get_trial_params(server_url, study_id); // Not using C++17 structured binding
            std::string new_study_id = result.first;
            nlohmann::json params = result.second;
            if (new_study_id.empty() || params.empty()) {
                std::cout << "[Client] Could not receive parameters. Exiting." << std::endl;
                break;
            }
            
            // Update study_id on first trial
            if (study_id.empty()) {
                study_id = new_study_id;
            }

            // 2. Train and evaluate model with parameters
            std::cout << "[Client] Training model with received parameters: " << params.dump() << std::endl;
            double score = func(params);
            std::cout << "[Client] Model evaluation complete: score = " << score << std::endl;

            // 3. Submit score
            bool success = submit_score(server_url, study_id, score);
            if (!success) {
                std::cout << "[Client] Could not submit score. Exiting." << std::endl;
                break;
            }

            trial_count++;
            std::cout << "[Client] Trial " << trial_idx << "/" << max_trials << " completed" << std::endl;
        }

        // Request best parameters after all trials
        if (trial_count > 0) {
            std::cout << "\n[Client] === Requesting best parameters ===" << std::endl;
            nlohmann::json best_params = get_best_params(server_url, study_id);

            if (!best_params.empty()) {
                // Final evaluation with best parameters
                double final_score = func(best_params);
                std::cout << "\n[Client] === Final evaluation with best parameters ===" << std::endl;
                std::cout << "[Client] - Parameters: " << best_params.dump() << std::endl;
                std::cout << "[Client] - Final score: " << final_score << std::endl;
            } else {
                std::cout << "[Client] Could not receive best parameters." << std::endl;
            }
        }
    } catch (const std::exception &e) {
        std::cerr << "[Client] Error occurred: " << e.what() << std::endl;
    }

    std::cout << "\n[Client] Completed " << trial_count << "/" << max_trials << " trials" << std::endl;
    std::cout << "[Client] Client terminated" << std::endl;

    return 0;
}