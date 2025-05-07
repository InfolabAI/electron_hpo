import requests
import time
import json
import argparse
import random
import sys
import traceback
#from main_simple_torch_normalize_each_anomalymap_shift_c import A
from project.python_scripts.hpo_onnx import A

def func(line_a_path, line_b_path, root=None, **kwargs):
    """
    모델 학습 + 검증 후 점수를 구하는 예시 함수
    실제로는 이 부분에 모델 학습 및 평가 코드가 들어갈 것
    """
    brightness = kwargs.get('brightness', 0)
    contrast = kwargs.get('contrast', 0)
    saturation = kwargs.get('saturation', 0)
    hue = kwargs.get('hue', 0)

    # A 클래스 인스턴스 생성 시 경로 매개변수 전달
    class_a = A(root=root, line_a_path=line_a_path, line_b_path=line_b_path)
    
    # func 메서드에는 색상 조정 매개변수만 전달
    score = class_a.func(brightness=brightness, contrast=contrast, saturation=saturation, hue=hue)

    return score


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
    
    # numpy.float32를 Python float으로 변환하여 JSON 직렬화 가능하게 함
    if hasattr(score, 'item'):  # numpy.float32 또는 torch.Tensor인 경우
        score = float(score.item())
    else:
        score = float(score)  # 다른 타입도 float으로 변환
        
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
    # xfeat_aligner.py와 같은 필수 위치 인수 추가
    parser.add_argument('line_a_path', help='첫 번째 이미지 라인 폴더 경로')
    parser.add_argument('line_b_path', help='두 번째 이미지 라인 폴더 경로')
    parser.add_argument('--root', help='root 폴더')
    
    # 기존 매개변수 유지
    parser.add_argument("--server_url", type=str,
                        default="http://10.164.4.103:8005", help="서버 URL")
    parser.add_argument("--study_id", type=str, default=None,
                        help="Study ID (없으면 자동 생성)")
    parser.add_argument("--max_trials", type=int,
                        default=5000, help="수행할 최대 trial 수")
    args = parser.parse_args()

    print(f"[Client] 하이퍼파라미터 최적화 시작")
    print(f"[Client] - 첫 번째 이미지 라인: {args.line_a_path}")
    print(f"[Client] - 두 번째 이미지 라인: {args.line_b_path}")
    print(f"[Client] - Root 폴더: {args.root}")
    print(f"[Client] - 서버 URL: {args.server_url}")
    print(f"[Client] - Study ID: {args.study_id if args.study_id else '자동 생성'}")
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

            # 2. 파라미터로 모델 학습 및 평가 - 명령줄 인수도 함께 전달
            print(f"[Client] 받은 파라미터로 모델 학습 중: {params}")
            # 명령줄 인수(line_a_path, line_b_path, root)를 함수에 전달
            score = func(args.line_a_path, args.line_b_path, args.root, **params)
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
                # 최고 파라미터로 최종 평가 - 명령줄 인수도 함께 전달
                final_score = func(args.line_a_path, args.line_b_path, args.root, **best_params)
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
