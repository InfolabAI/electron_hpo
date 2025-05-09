import requests
import datetime
import time
import json
import argparse
import random
import sys
import traceback
import signal
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__))) # windows 배포 시, 같은 경로 파일 import 위해 필요
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE" # windows 배포 시, ONNX 와 FAISS 의 OpenMP 충돌 우회를 위해 필요

import atexit
import multiprocessing as mp
from multiprocessing import Process, Queue
#from main_simple_torch_normalize_each_anomalymap_shift_c import A
from hpo_onnx import A

# 전역 변수로 프로세스 리스트 관리
child_processes = []

def cleanup_processes():
    """
    모든 자식 프로세스를 정리하는 함수
    """
    global child_processes
    
    print("[Main] 모든 자식 프로세스 종료 중...", file=sys.stderr)
    for p in child_processes:
        if p.is_alive():
            try:
                p.terminate()
                p.join(timeout=1)
                
                # 여전히 살아있으면 강제 종료
                if p.is_alive():
                    print(f"[Main] 프로세스 {p.pid} 강제 종료 중...", file=sys.stderr)
                    os.kill(p.pid, signal.SIGKILL)
            except Exception as e:
                print(f"[Main] 프로세스 종료 중 오류 발생: {e}", file=sys.stderr)
    
    print("[Main] 모든 자식 프로세스 종료 완료", file=sys.stderr)

def signal_handler(sig, frame):
    """
    시그널 핸들러
    """
    print(f"\n[Main] 시그널 {sig} 수신, 프로그램을 종료합니다.", file=sys.stderr)
    cleanup_processes()
    sys.exit(0)

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
                f"[Client] 새 trial 파라미터 요청 중... (시도 {retry+1}/{max_retries})", file=sys.stderr)

            # 요청 전송
            response = requests.get(endpoint, timeout=10)

            if response.status_code == 200:
                data = response.json()
                study_id = data["study_id"]
                params = data["params"]
                print(
                    f"[Client] 새 trial 파라미터 수신 성공: study_id={study_id}, params={params}", file=sys.stderr)
                return study_id, params
            else:
                print(
                    f"[Client] 파라미터 요청 실패: HTTP {response.status_code} - {response.text}", file=sys.stderr)
                study_id = study_id + f"_{retry}"

        except requests.RequestException as e:
            print(f"[Client] 요청 중 오류 발생: {e}", file=sys.stderr)

        # 마지막 시도가 아니면 재시도
        if retry < max_retries - 1:
            wait_time = (2 ** retry) * (0.5 + 0.5 * random.random())
            print(f"[Client] {wait_time:.1f}초 후 재시도...", file=sys.stderr)
            time.sleep(wait_time)

    print("[Client] 최대 재시도 횟수 초과, 파라미터 요청 실패", file=sys.stderr)
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
                f"[Client] 점수 제출 중: score={score}, study_id={study_id} (시도 {retry+1}/{max_retries})", file=sys.stderr)

            # 요청 전송
            response = requests.post(endpoint, json=payload, timeout=10)

            if response.status_code == 200:
                print(f"[Client] 점수 제출 성공!", file=sys.stderr)
                return True
            else:
                print(
                    f"[Client] 점수 제출 실패: HTTP {response.status_code} - {response.text}", file=sys.stderr)

        except requests.RequestException as e:
            print(f"[Client] 요청 중 오류 발생: {e}", file=sys.stderr)

        # 마지막 시도가 아니면 재시도
        if retry < max_retries - 1:
            wait_time = (2 ** retry) * (0.5 + 0.5 * random.random())
            print(f"[Client] {wait_time:.1f}초 후 재시도...", file=sys.stderr)
            time.sleep(wait_time)

    print("[Client] 최대 재시도 횟수 초과, 점수 제출 실패", file=sys.stderr)
    return False


def get_best_params(server_url, study_id, max_retries=3):
    """
    최고의 파라미터를 서버에 요청
    """
    endpoint = f"{server_url}/best?study_id={study_id}"

    for retry in range(max_retries):
        try:
            print(f"[Client] 최고 파라미터 요청 중... (시도 {retry+1}/{max_retries})", file=sys.stderr)

            # 요청 전송
            response = requests.get(endpoint, timeout=10)

            if response.status_code == 200:
                data = response.json()
                best_params = data["params"]
                print(f"[Client] 최고 파라미터 수신 성공: {best_params}", file=sys.stderr)
                return best_params
            else:
                print(
                    f"[Client] 최고 파라미터 요청 실패: HTTP {response.status_code} - {response.text}", file=sys.stderr)

        except requests.RequestException as e:
            print(f"[Client] 요청 중 오류 발생: {e}", file=sys.stderr)

        # 마지막 시도가 아니면 재시도
        if retry < max_retries - 1:
            wait_time = (2 ** retry) * (0.5 + 0.5 * random.random())
            print(f"[Client] {wait_time:.1f}초 후 재시도...", file=sys.stderr)
            time.sleep(wait_time)

    print("[Client] 최대 재시도 횟수 초과, 최고 파라미터 요청 실패", file=sys.stderr)
    return None


def report_progress(progress, study_id=None, current_trial=None, total_trials=None, best_value=None, best_params=None):
    """
    진행 상황과 study_id를 Electron에 보고하는 함수
    
    매개변수:
        progress: 0에서 100 사이의 진행률
        study_id: Study ID (선택적)
        current_trial: 현재 trial 번호
        total_trials: 총 trial 수
        best_value: 현재까지의 최고 점수
        best_params: 현재까지의 최고 파라미터
    """
    # JSON 형식으로 진행 상황 보고
    progress_data = {
        "progress": round(progress, 2),
        "status": "running"
    }
    
    # 추가 정보가 있으면 포함
    if study_id:
        progress_data["study_id"] = study_id
    if current_trial is not None and total_trials is not None:
        progress_data["current_trial"] = current_trial
        progress_data["total_trials"] = total_trials
    if best_value is not None:
        progress_data["best_value"] = round(float(best_value), 4)
    if best_params is not None:
        progress_data["best_params"] = best_params
        
    # stdout으로 JSON 출력 (Electron과의 통신용)
    print(json.dumps(progress_data))
    sys.stdout.flush()

def worker_process(process_id, line_a_path, line_b_path, root, get_params_queue, params_result_queue, 
                  submit_score_queue, submission_result_queue, max_trials_per_worker):
    """
    자식 프로세스에서 실행되는 워커 함수
    """
    print(f"[Worker-{process_id}] 워커 프로세스 시작", file=sys.stderr)
    trials_completed = 0
    
    try:
        while trials_completed < max_trials_per_worker:
            # 파라미터 요청을 큐에 추가
            get_params_queue.put(process_id)
            print(f"[Worker-{process_id}] 파라미터 요청 큐에 추가", file=sys.stderr)
            
            # 결과 대기
            result = params_result_queue.get()
            if result.get('process_id') != process_id:
                # 다른 프로세스의 결과면 다시 큐에 넣고 재시도
                params_result_queue.put(result)
                time.sleep(0.1)
                continue
                
            if not result.get('success'):
                print(f"[Worker-{process_id}] 파라미터 요청 실패, 종료합니다", file=sys.stderr)
                break
                
            study_id = result.get('study_id')
            params = result.get('params')
            
            # 파라미터로 모델 학습 및 평가
            print(f"[Worker-{process_id}] 받은 파라미터로 모델 학습 중: {params}", file=sys.stderr)
            score = func(line_a_path, line_b_path, root, **params)
            print(f"[Worker-{process_id}] 모델 평가 완료: 점수 = {score:.6f}", file=sys.stderr)
            
            # 점수 제출 요청을 큐에 추가
            submit_score_queue.put({
                'process_id': process_id,
                'study_id': study_id,
                'score': score
            })
            print(f"[Worker-{process_id}] 점수 제출 큐에 추가", file=sys.stderr)
            
            # 제출 결과 대기
            submission_result = submission_result_queue.get()
            if submission_result.get('process_id') != process_id:
                # 다른 프로세스의 결과면 다시 큐에 넣고 재시도
                submission_result_queue.put(submission_result)
                time.sleep(0.1)
                continue
                
            if not submission_result.get('success'):
                print(f"[Worker-{process_id}] 점수 제출 실패, 종료합니다", file=sys.stderr)
                break
                
            trials_completed += 1
            print(f"[Worker-{process_id}] Trial {trials_completed}/{max_trials_per_worker} 완료", file=sys.stderr)
            
    except Exception as e:
        print(f"[Worker-{process_id}] 오류 발생: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
    
    print(f"[Worker-{process_id}] 워커 프로세스 종료 (총 {trials_completed} trials 완료)", file=sys.stderr)

def main():
    # 시그널 핸들러 등록
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # 프로그램 종료 시 cleanup 함수 등록
    atexit.register(cleanup_processes)
    
    parser = argparse.ArgumentParser(description="하이퍼파라미터 최적화 클라이언트")
    # xfeat_aligner.py와 같은 필수 위치 인수 추가
    parser.add_argument('line_a_path', help='첫 번째 이미지 라인 폴더 경로')
    parser.add_argument('line_b_path', help='두 번째 이미지 라인 폴더 경로')
    parser.add_argument('--root', help='root 폴더')
    
    # 기존 매개변수 유지
    parser.add_argument("--server_url", type=str,
                        default="http://127.0.0.1:8005", help="서버 URL")
    parser.add_argument("--study_id", type=str, default=None,
                        help="Study ID (없으면 자동 생성)")
    parser.add_argument("--max_trials", type=int,
                        default=30000, help="수행할 최대 trial 수")
    # 멀티프로세싱 관련 매개변수 추가
    parser.add_argument("--num_processes", type=int,
                        default=1, help="사용할 프로세스 수") # /home/hee/electron_project/project/iqgen_scripts/memory/nnscorer_search_index.faiss 를 모두 공유하기 때문에 지금은 1개만 사용해야 함
    args = parser.parse_args()


    print(f"[Client] 하이퍼파라미터 최적화 시작", file=sys.stderr)
    print(f"[Client] - 첫 번째 이미지 라인: {args.line_a_path}", file=sys.stderr)
    print(f"[Client] - 두 번째 이미지 라인: {args.line_b_path}", file=sys.stderr)
    print(f"[Client] - Root 폴더: {args.root}", file=sys.stderr)
    print(f"[Client] - 서버 URL: {args.server_url}", file=sys.stderr)
    print(f"[Client] - Study ID: {args.study_id if args.study_id else '자동 생성'}", file=sys.stderr)
    print(f"[Client] - 최대 Trial 수: {args.max_trials}", file=sys.stderr)
    print(f"[Client] - 프로세스 수: {args.num_processes}", file=sys.stderr)

    
    study_id = args.study_id
    # 현재 날짜시간 정보를 study_id 뒤에 붙이기
    if study_id:
        current_time = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        study_id = f"{study_id}_{current_time}"
    
    max_trials = args.max_trials
    best_score = None
    best_params = None
    trial_count = 0


    # 큐 생성
    get_params_queue = Queue()       # 파라미터 요청 큐
    params_result_queue = Queue()    # 파라미터 결과 큐
    submit_score_queue = Queue()     # 점수 제출 큐
    submission_result_queue = Queue() # 제출 결과 큐
    
    # 각 워커 프로세스가 처리할 trial 수 계산
    max_trials_per_worker = max_trials // args.num_processes
    if max_trials % args.num_processes > 0:
        max_trials_per_worker += 1

    report_progress(0, study_id=study_id, current_trial=0, total_trials=max_trials, best_value=None)

    # 워커 프로세스 시작
    global child_processes
    processes = []
    for i in range(args.num_processes):
        p = Process(target=worker_process, args=(
            i, args.line_a_path, args.line_b_path, args.root, 
            get_params_queue, params_result_queue, submit_score_queue, 
            submission_result_queue, max_trials_per_worker
        ))
        # 데몬 프로세스로 설정하여 메인 프로세스가 종료되면 함께 종료되도록 함
        p.daemon = True
        p.start()
        processes.append(p)
    
    # 전역 변수에 프로세스 리스트 저장
    child_processes = processes
    
    try:
        # 큐 모니터링 메인 루프
        active_processes = len(processes)
        while active_processes > 0 and trial_count < max_trials:
            # 살아있는 프로세스 수 확인
            active_processes = sum(p.is_alive() for p in processes)
            
            # 파라미터 요청 큐 처리
            if not get_params_queue.empty():
                process_id = get_params_queue.get()
                print(f"[Main] 프로세스 {process_id}의 파라미터 요청 처리 중", file=sys.stderr)
                
                # 서버에서 파라미터 요청
                new_study_id, params = get_trial_params(args.server_url, study_id)
                
                if new_study_id and params:
                    # 성공 시 study_id 업데이트 (첫 번째 요청인 경우)
                    if not study_id:
                        study_id = new_study_id
                    
                    # 결과를 파라미터 결과 큐에 추가
                    params_result_queue.put({
                        'process_id': process_id,
                        'success': True,
                        'study_id': new_study_id,
                        'params': params
                    })
                else:
                    # 실패 시 오류 결과 전달
                    params_result_queue.put({
                        'process_id': process_id,
                        'success': False
                    })
            
            # 점수 제출 큐 처리
            if not submit_score_queue.empty():
                data = submit_score_queue.get()
                process_id = data['process_id']
                score_study_id = data['study_id']
                score = data['score']
                
                print(f"[Main] 프로세스 {process_id}의 점수 제출 처리 중", file=sys.stderr)
                
                # 서버에 점수 제출
                success = submit_score(args.server_url, score_study_id, score)
                
                # 최고 점수 업데이트
                if success and (best_score is None or score > best_score):
                    best_score = score
                    # 최고 파라미터 요청
                    current_best_params = get_best_params(args.server_url, score_study_id)
                    if current_best_params:
                        best_params = current_best_params
                        print(f"[Main] 현재까지 최고 파라미터: {best_params}", file=sys.stderr)
                
                # 결과를 제출 결과 큐에 추가
                submission_result_queue.put({
                    'process_id': process_id,
                    'success': success
                })
                
                # Trial 카운트 증가 및 진행 상황 보고
                trial_count += 1
                progress = (trial_count / max_trials) * 100
                report_progress(progress, study_id=study_id, current_trial=trial_count, 
                               total_trials=max_trials, best_value=best_score, best_params=best_params)
                
                print(f"[Main] Trial {trial_count}/{max_trials} 완료 (진행률: {progress:.2f}%)", file=sys.stderr)
            
            # 1초마다 큐 확인
            time.sleep(1)
        
        # 모든 프로세스가 종료되었거나 최대 trial 수에 도달
        print(f"[Main] 모든 워커 프로세스 종료 대기 중...", file=sys.stderr)
        cleanup_processes()
        
        # 모든 trial 완료 후 최종 확인
        if trial_count > 0:
            print("\n[Client] === 최고 파라미터 최종 확인 ===", file=sys.stderr)
            final_best_params = get_best_params(args.server_url, study_id)

            if final_best_params:
                # 최고 파라미터로 최종 평가 - 명령줄 인수도 함께 전달
                final_score = func(args.line_a_path, args.line_b_path, args.root, **final_best_params)
                print(f"\n[Client] === 최고 파라미터 최종 평가 ===", file=sys.stderr)
                print(f"[Client] - 파라미터: {final_best_params}", file=sys.stderr)
                print(f"[Client] - 최종 점수: {final_score:.6f}", file=sys.stderr)
                best_score = final_score
                best_params = final_best_params
            else:
                print("[Client] 최고 파라미터를 받을 수 없습니다.", file=sys.stderr)

    except KeyboardInterrupt:
        print("\n[Client] 사용자에 의해 중단되었습니다.", file=sys.stderr)
        cleanup_processes()
    except Exception as e:
        print(f"[Client] 오류 발생: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        cleanup_processes()

    print(f"\n[Client] 총 {trial_count}/{max_trials} trial 완료", file=sys.stderr)
    
    # 완료 메시지 전송
    completion_data = {
        "progress": 100,
        "status": "complete",
        "study_id": study_id,
        "success": True,
        "best_value": round(float(best_score), 4) if best_score is not None else None,
        "best_params": best_params
    }
    
    print(json.dumps(completion_data))
    sys.stdout.flush()
    
    print("[Client] 클라이언트 종료", file=sys.stderr)


if __name__ == "__main__":
    main()
