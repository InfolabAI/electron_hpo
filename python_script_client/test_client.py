# 파일명 예: client.py

import requests
import time
import json


def func(**kwargs):
    """
    클라이언트에서 직접 돌리는 예시 함수(임의 가정).
    여기서 실제로 모델 학습 & 검증 후 점수를 구했다고 가정.
    """
    # HPO 에서 lr, arc 를 설정했을 때의 예제
    lr = kwargs.get('lr', 0.1)
    arc = kwargs.get('arc', 'mm')

    # 예제 코드이므로 삭제(시작)
    base_score = 0.8
    lr_influence = (lr - 0.1) * 0.1
    arc_influence = 0.12 if arc == 'nn' else 0.0
    auroc = base_score + lr_influence + arc_influence
    # 예제 코드이므로 삭제(끝)

    return auroc  # 이번 trial 에 대한 점수를 구한 후 반환(float)


def get_json(server_url, category="trial"):
    if category not in ["trial", "best"]:
        print(f"[Client] Invalid category: {category}")
        return None

    r = requests.get(f"{server_url}/{category}", timeout=10)
    if r.status_code != 200:
        # Trial 정보를 못 받으면 더 이상 할 일이 없다고 가정하고 종료
        print("[Client] No more trial or error:", r.text)
        return None

    trial_params = r.json()
    print("[Client] Received trial params:", trial_params)
    return trial_params


def post_metric(auroc, server_url):
    print(f"[Client] Computed auroc: {auroc}")
    if type(auroc) not in [int, float]:
        print(
            f"For post_metric function, assign auroc as a float or int, current type: {type(auroc)}")
        return
        # 상황에 따라 break 혹은 continue 등 처리
    score_data = {"auroc": auroc}
    r_score = requests.post(
        f"{server_url}/score", json=score_data, timeout=5)
    if r_score.status_code == 200:
        print("[Client] Score posted successfully.")
    else:
        print("[Client] Failed to post score:", r_score.text)
        # 상황에 따라 break 혹은 continue 등 처리
        return True

    # 잠시 대기 후 다음 루프(서버가 다음 trial 준비하도록)
    time.sleep(0.1)

    return False


def main():
    server_url = "http://127.0.0.1:8005"

    while True:
        try:
            # 1) /trial에서 파라미터 GET
            trial_params = get_json(server_url)
            if trial_params is None:
                break

            # 2) 파라미터로 func 실행(예: 모델 학습 + 검증 후 auroc 계산)
            auroc = func(**trial_params)

            # 3) /score 로 점수 POST
            ret = post_metric(auroc, server_url)
            if ret:
                break

        except Exception as e:
            print("[Client] Finished:", e)
            break

    print("[Client] Try the best params.")

    # 최적화 while 문이 종료된 후, category 에 best 를 넣으면 가장 좋은 파라미터를 받아옴
    trial_params = get_json(server_url, category="best")

    # best 파라미터로 func 실행
    auroc = func(**trial_params)


if __name__ == "__main__":
    main()
