# 파일명 예: client.py

import requests
import time
import json


def func(**kwargs):
    """
    클라이언트에서 직접 돌리는 예시 함수(임의 가정).
    여기서 실제로 모델 학습 & 검증 후 점수를 구했다고 가정.
    """
    lr = kwargs.get('lr', 0.1)
    arc = kwargs.get('arc', 'mm')

    base_score = 0.8
    lr_influence = (lr - 0.1) * 0.1
    arc_influence = 0.12 if arc == 'nn' else 0.0
    auroc = base_score + lr_influence + arc_influence
    return auroc


def main():
    server_url = "http://127.0.0.1:8005"

    while True:
        try:
            # 1) /trial에서 파라미터 GET
            r = requests.get(f"{server_url}/trial", timeout=10)
            if r.status_code != 200:
                # Trial 정보를 못 받으면 더 이상 할 일이 없다고 가정하고 종료
                print("[Client] No more trial or error:", r.text)
                break

            trial_params = r.json()
            print("[Client] Received trial params:", trial_params)

            # 2) 파라미터로 func 실행(예: 모델 학습 + 검증 후 auroc 계산)
            auroc = func(**trial_params)
            print(f"[Client] Computed auroc: {auroc}")

            # 3) /score 로 점수 POST
            score_data = {"auroc": auroc}
            r_score = requests.post(
                f"{server_url}/score", json=score_data, timeout=5)
            if r_score.status_code == 200:
                print("[Client] Score posted successfully.")
            else:
                print("[Client] Failed to post score:", r_score.text)
                # 상황에 따라 break 혹은 continue 등 처리
                break

            # 잠시 대기 후 다음 루프(서버가 다음 trial 준비하도록)
            time.sleep(0.1)

        except Exception as e:
            print("[Client] Error occurred:", e)
            break


if __name__ == "__main__":
    main()
