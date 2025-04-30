import requests
import time
import json
import argparse
import random
import sys
import traceback


def func(**kwargs):
    """
    모델 학습 + 검증 후 점수를 구하는 예시 함수
    실제로는 이 부분에 모델 학습 및 평가 코드가 들어갈 것
    """
    lr = kwargs.get('lr', 0.1)
    arc = kwargs.get('arc', 'mm')

    # 예시: 단순히 파라미터에 따른 스코어를 계산
    base_score = 0.8
    lr_influence = (lr - 0.1) * 0.1
    arc_influence = 0.12 if arc == 'nn' else 0.0
    auroc = base_score + lr_influence + arc_influence

    # 약간의 랜덤성 추가 (예시용)
    # auroc += random.uniform(-0.01, 0.01)

    return auroc


def get_trial_params(server_url, study_id=None, max_retries=3):
    """
    서버에서 새 trial 파라미터를 요청
    study_id가 None이면 서버가 새 study_id를 생성해서 반환
    """

    endpoint = f"{server_url}/trial"
    if study_id:
        endpoint += f"?study_id={study_id}"

    for retry in range(max_retries):
        try:
            print(
                f"[Client] 새 trial 파라미터 요청 중... (시도 {retry+1}/{max_retries})")

            # 요청 전송
            response = requests.get(endpoint, timeout=10)

            if response.status_code == 200:
                data = response.json()
                study_id = data["study_id"]
                params = data["params"]
                print(
                    f"[Client] 새 trial 파라미터 수신 성공: study_id={study_id}, params={params}")
                return study_id, params
            else:
                print(
                    f"[Client] 파라미터 요청 실패: HTTP {response.status_code} - {response.text}")
                study_id = study_id + f"_{retry}"

        except requests.RequestException as e:
            print(f"[Client] 요청 중 오류 발생: {e}")

        # 마지막 시도가 아니면 재시도
        if retry < max_retries - 1:
            wait_time = (2 ** retry) * (0.5 + 0.5 * random.random())
            print(f"[Client] {wait_time:.1f}초 후 재시도...")
            time.sleep(wait_time)

    print("[Client] 최대 재시도 횟수 초과, 파라미터 요청 실패")
    return None, None


def submit_score(server_url, study_id, score, max_retries=3):
    """
    trial 결과 점수를 서버에 제출
    """
    endpoint = f"{server_url}/score?study_id={study_id}"
    payload = {"score": score}

    for retry in range(max_retries):
        try:
            print(
                f"[Client] 점수 제출 중: score={score}, study_id={study_id} (시도 {retry+1}/{max_retries})")

            # 요청 전송
            response = requests.post(endpoint, json=payload, timeout=10)

            if response.status_code == 200:
                print(f"[Client] 점수 제출 성공!")
                return True
            else:
                print(
                    f"[Client] 점수 제출 실패: HTTP {response.status_code} - {response.text}")

        except requests.RequestException as e:
            print(f"[Client] 요청 중 오류 발생: {e}")

        # 마지막 시도가 아니면 재시도
        if retry < max_retries - 1:
            wait_time = (2 ** retry) * (0.5 + 0.5 * random.random())
            print(f"[Client] {wait_time:.1f}초 후 재시도...")
            time.sleep(wait_time)

    print("[Client] 최대 재시도 횟수 초과, 점수 제출 실패")
    return False


def get_best_params(server_url, study_id, max_retries=3):
    """
    최고의 파라미터를 서버에 요청
    """
    endpoint = f"{server_url}/best?study_id={study_id}"

    for retry in range(max_retries):
        try:
            print(f"[Client] 최고 파라미터 요청 중... (시도 {retry+1}/{max_retries})")

            # 요청 전송
            response = requests.get(endpoint, timeout=10)

            if response.status_code == 200:
                data = response.json()
                best_params = data["params"]
                print(f"[Client] 최고 파라미터 수신 성공: {best_params}")
                return best_params
            else:
                print(
                    f"[Client] 최고 파라미터 요청 실패: HTTP {response.status_code} - {response.text}")

        except requests.RequestException as e:
            print(f"[Client] 요청 중 오류 발생: {e}")

        # 마지막 시도가 아니면 재시도
        if retry < max_retries - 1:
            wait_time = (2 ** retry) * (0.5 + 0.5 * random.random())
            print(f"[Client] {wait_time:.1f}초 후 재시도...")
            time.sleep(wait_time)

    print("[Client] 최대 재시도 횟수 초과, 최고 파라미터 요청 실패")
    return None


def main():
    parser = argparse.ArgumentParser(description="하이퍼파라미터 최적화 클라이언트")
    parser.add_argument("--server_url", type=str,
                        default="http://127.0.0.1:8005", help="서버 URL")
    parser.add_argument("--study_id", type=str, default=None,
                        help="Study ID (없으면 자동 생성)")
    parser.add_argument("--max_trials", type=int,
                        default=50, help="수행할 최대 trial 수")
    args = parser.parse_args()

    print(f"[Client] 하이퍼파라미터 최적화 시작")
    print(f"[Client] - 서버 URL: {args.server_url}")
    print(
        f"[Client] - Study ID: {args.study_id if args.study_id else '자동 생성'}")
    print(f"[Client] - 최대 Trial 수: {args.max_trials}")

    study_id = args.study_id
    trial_count = 0
    max_trials = args.max_trials

    try:
        # 각 trial 수행
        for trial_idx in range(1, max_trials + 1):
            print(f"\n[Client] === Trial {trial_idx}/{max_trials} 시작 ===")

            # 1. 새 파라미터 요청
            study_id, params = get_trial_params(args.server_url, study_id)
            if not study_id or not params:
                print("[Client] 파라미터를 받을 수 없어 종료합니다.")
                break

            # 2. 파라미터로 모델 학습 및 평가
            print(f"[Client] 받은 파라미터로 모델 학습 중: {params}")
            score = func(**params)
            print(f"[Client] 모델 평가 완료: 점수 = {score:.6f}")

            # 3. 점수 제출
            success = submit_score(args.server_url, study_id, score)
            if not success:
                print("[Client] 점수를 제출할 수 없어 종료합니다.")
                break

            trial_count += 1
            print(f"[Client] Trial {trial_idx}/{max_trials} 완료")

        # 모든 trial 완료 후 최고 파라미터 요청
        if trial_count > 0:
            print("\n[Client] === 최고 파라미터 요청 중 ===")
            best_params = get_best_params(args.server_url, study_id)

            if best_params:
                # 최고 파라미터로 최종 평가
                final_score = func(**best_params)
                print(f"\n[Client] === 최고 파라미터 최종 평가 ===")
                print(f"[Client] - 파라미터: {best_params}")
                print(f"[Client] - 최종 점수: {final_score:.6f}")
            else:
                print("[Client] 최고 파라미터를 받을 수 없습니다.")

    except KeyboardInterrupt:
        print("\n[Client] 사용자에 의해 중단되었습니다.")
    except Exception as e:
        print(f"[Client] 오류 발생: {e}")
        traceback.print_exc()

    print(f"\n[Client] 총 {trial_count}/{max_trials} trial 완료")
    print("[Client] 클라이언트 종료")


if __name__ == "__main__":
    main()
