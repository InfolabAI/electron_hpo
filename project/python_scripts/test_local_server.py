import argparse
import traceback
import optuna
import os
import json
import threading
import time
import sys
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.stdout.reconfigure(line_buffering=True)

# ------------------------------------------------------------------------------
# study_id별 정보를 담아둘 전역 딕셔너리.
# key   = study_id (str)
# value = {
#     "study": optuna.Study 인스턴스
#     "pending_trial": 현재 진행 중인 trial 정보 (파라미터, trial 객체)
#     "completed_trials": [완료된 trial 정보들의 리스트]
#     "client_trial_count": 클라이언트에게 제공된 trial 수
#     "study_lock": threading.Lock() - study 접근을 위한 락
#     "best_params": 지금까지의 best parameters
# }
# ------------------------------------------------------------------------------
active_studies = {}

# ------------------------------------------------------------------------------
# JSON config를 읽어 파라미터를 뽑아내는 클래스
# ------------------------------------------------------------------------------


class LoadJSON:
    def __init__(self, root):
        self.root = root
        self.data = None
        try:
            with open(os.path.join(self.root, 'json_files', 'config.json'), 'r', encoding='utf-8') as f:
                self.data = json.load(f)
            print(f"[Config] JSON 설정 파일 로드 완료: {len(self.data)}개 파라미터 설정")
        except Exception as e:
            print(f"[Config] JSON 설정 파일 로드 오류: {e}")
            # 오류 시 기본 파라미터 설정 (예시)
            self.data = [
                {"name": "lr", "type": "float", "min": "0.001",
                    "max": "0.1", "step": "0.001", "log": "linear"},
                {"name": "arc", "type": "category", "categories": "mm,nn"}
            ]
            print(f"[Config] 기본 파라미터 설정 사용: {self.data}")

    def suggest_params(self, trial: optuna.Trial):
        arg_dict = {}
        for el in self.data:
            try:
                if el['type'] == 'float':
                    arg_dict[el['name']] = trial.suggest_float(
                        el['name'],
                        low=float(el['min']),
                        high=float(el['max']),
                        step=None if el['step'] == '' else float(el['step']),
                        log=False if el['log'] == 'linear' else True
                    )
                elif el['type'] == 'int':
                    arg_dict[el['name']] = trial.suggest_int(
                        el['name'],
                        low=int(el['min']),
                        high=int(el['max']),
                        step=1 if el['step'] == '' else int(el['step'])
                    )
                elif el['type'] == 'category':
                    categories = el['categories'].split(',')
                    arg_dict[el['name']] = trial.suggest_categorical(
                        el['name'], choices=categories
                    )
            except Exception as e:
                print(f"[Config] 파라미터 '{el['name']}' 처리 중 오류: {e}")

        return arg_dict


# ------------------------------------------------------------------------------
# 하이퍼파라미터 최적화 관련 함수들
# ------------------------------------------------------------------------------
def get_or_create_study(study_id, root):
    """study_id에 해당하는 study를 가져오거나 새로 생성"""
    global active_studies

    # 이미 있는 경우 반환
    if study_id in active_studies:
        return active_studies[study_id]

    # 새로 만들기
    timestamp = int(time.time())
    storage_url = "sqlite:///" + os.path.join(root, "db.sqlite3")
    study_name = f"study_{study_id}_{timestamp}"

    try:
        # Study 생성
        sampler = optuna.samplers.TPESampler()
        study = optuna.create_study(
            direction='maximize',
            sampler=sampler,
            storage=storage_url,
            study_name=study_name,
            load_if_exists=False  # 항상 새로 만들기
        )

        # 정보 저장
        active_studies[study_id] = {
            "study": study,
            "pending_trial": None,  # 현재 진행 중인 trial (없음)
            "completed_trials": [],  # 완료된 trial들
            "client_trial_count": 0,  # 클라이언트에게 제공된 trial 수
            "study_lock": threading.Lock(),  # study 접근을 위한 락
            "best_params": None  # 아직 best 없음
        }

        print(f"[{study_id}] 새 study '{study_name}' 생성 완료")
        return active_studies[study_id]

    except Exception as e:
        print(f"[{study_id}] Study 생성 중 오류: {e}")
        traceback.print_exc()
        return None


def create_new_trial(study_id, root):
    """새로운 trial을 생성하고 파라미터 반환"""
    global active_studies

    study_info = get_or_create_study(study_id, root)
    if not study_info:
        return None

    with study_info["study_lock"]:
        # 이미 진행 중인 trial이 있으면, 이전 trial은 취소 처리
        if study_info["pending_trial"]:
            print(f"[{study_id}] 이전 trial 취소 (클라이언트가 점수를 보내지 않음)")
            old_trial = study_info["pending_trial"]["trial"]
            try:
                # Trial을 실패로 표시하여 미완료 상태 정리
                study_info["study"].tell(
                    old_trial.number, state=optuna.trial.TrialState.FAIL)
            except Exception as e:
                print(f"[{study_id}] 이전 trial 취소 중 오류: {e}")

        # 새로운 trial 생성
        try:
            study = study_info["study"]
            trial = study.ask()  # 새 trial 요청

            # 파라미터 생성
            loader = LoadJSON(root)
            params = loader.suggest_params(trial)

            # 정보 저장
            trial_info = {
                "trial": trial,
                "params": params,
                "start_time": time.time(),
                # 클라이언트가 볼 번호
                "trial_number": study_info["client_trial_count"] + 1
            }
            study_info["pending_trial"] = trial_info
            study_info["client_trial_count"] += 1

            print(
                f"[{study_id}] 새 trial #{trial_info['trial_number']} 생성: trial.number={trial.number}, params={params}")
            return params

        except Exception as e:
            print(f"[{study_id}] Trial 생성 중 오류: {e}")
            traceback.print_exc()
            return None


def submit_trial_score(study_id, score):
    """현재 진행 중인 trial에 점수 제출"""
    global active_studies

    if study_id not in active_studies:
        print(f"[{study_id}] 존재하지 않는 study에 점수 제출 시도")
        return False

    study_info = active_studies[study_id]

    with study_info["study_lock"]:
        if not study_info["pending_trial"]:
            print(f"[{study_id}] 진행 중인 trial이 없는데 점수 제출 시도")
            return False

        try:
            trial_info = study_info["pending_trial"]
            trial = trial_info["trial"]

            # 점수 기록
            trial_info["score"] = score
            trial_info["end_time"] = time.time()

            # 완료로 표시
            study_info["study"].tell(trial.number, score)

            # 완료된 trial 목록에 추가
            study_info["completed_trials"].append(trial_info)

            # best 갱신 확인
            if study_info["best_params"] is None or score > study_info["best_params"]["score"]:
                study_info["best_params"] = {
                    "params": trial_info["params"],
                    "score": score,
                    "trial_number": trial_info["trial_number"]
                }

            print(f"[{study_id}] Trial #{trial_info['trial_number']} 완료: score={score}, best_so_far={study_info['best_params']['score']}")

            # pending trial 초기화
            study_info["pending_trial"] = None
            return True

        except Exception as e:
            print(f"[{study_id}] 점수 제출 중 오류: {e}")
            traceback.print_exc()
            return False


def get_best_params(study_id):
    """현재까지의 최고 파라미터 반환"""
    global active_studies

    if study_id not in active_studies:
        print(f"[{study_id}] 존재하지 않는 study의 best params 요청")
        return None

    study_info = active_studies[study_id]

    with study_info["study_lock"]:
        # 완료된 trial이 없으면 실패
        if not study_info["completed_trials"]:
            print(f"[{study_id}] 완료된 trial이 없어 best 반환 불가")
            return None

        # 저장된 best 파라미터 반환
        best_info = study_info["best_params"]
        if best_info:
            print(
                f"[{study_id}] Best params 반환: trial #{best_info['trial_number']}, score={best_info['score']}")
            # 통계도 출력
            n_completed = len(study_info["completed_trials"])
            n_total = study_info["client_trial_count"]
            print(f"[{study_id}] 통계: 총 {n_total}개 trial 중 {n_completed}개 완료됨")
            return best_info["params"]

        return None


# ------------------------------------------------------------------------------
# HTTP 핸들러
# ------------------------------------------------------------------------------
class SimpleHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        query = urllib.parse.parse_qs(parsed_path.query)

        # URL에서 study_id 가져오기
        study_id = query.get("study_id", [None])[0]
        if not study_id:
            # ID가 없으면 자동 생성
            study_id = str(uuid.uuid4())[:8]  # 짧은 ID 생성

        if path == "/trial":
            # 새 파라미터 얻기
            params = create_new_trial(study_id, args.root)

            if params:
                # 성공
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()

                # study_id도 응답에 포함
                response = {
                    "study_id": study_id,
                    "params": params
                }
                self.wfile.write(json.dumps(response).encode("utf-8"))
            else:
                # 실패
                self.send_error(500, "Failed to create trial")

        elif path == "/best":
            # 최고 파라미터 얻기
            if not study_id:
                self.send_error(400, "Missing study_id parameter")
                return

            best_params = get_best_params(study_id)

            if best_params:
                # 성공
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()

                # study_id도 응답에 포함
                response = {
                    "study_id": study_id,
                    "params": best_params
                }
                self.wfile.write(json.dumps(response).encode("utf-8"))
            else:
                # 실패
                self.send_error(404, "No best parameters available")

        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        query = urllib.parse.parse_qs(parsed_path.query)

        # URL에서 study_id 가져오기
        study_id = query.get("study_id", [None])[0]
        if not study_id:
            self.send_error(400, "Missing study_id parameter")
            return

        if path == "/score":
            # 요청 바디 파싱
            content_length = int(self.headers["Content-Length"])
            body = self.rfile.read(content_length).decode("utf-8")

            try:
                data = json.loads(body)
                # "score" 또는 "auroc" 필드 사용
                score = float(data.get("score", data.get("auroc", 0.0)))

                # 점수 제출
                success = submit_trial_score(study_id, score)

                if success:
                    # 성공
                    self.send_response(200)
                    self.send_header("Content-type", "application/json")
                    self.end_headers()

                    response = {
                        "study_id": study_id,
                        "status": "success"
                    }
                    self.wfile.write(json.dumps(response).encode("utf-8"))
                else:
                    # 실패
                    self.send_error(400, "Failed to submit score")

            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
            except ValueError:
                self.send_error(400, "Invalid score value")

        else:
            self.send_error(404, "Not Found")

    def log_message(self, format, *args):
        # 기본 로깅 비활성화 (우리가 직접 로깅)
        return


# ------------------------------------------------------------------------------
# 메인 실행부
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("--port", type=int, default=8005)
        parser.add_argument("--root", type=str, default='./')
        args = parser.parse_args()

        # 웹서버 기동
        host = "0.0.0.0"
        port = args.port
        server = HTTPServer((host, port), SimpleHandler)
        print(f"Server started: http://{host}:{port}")

        # 서버 메인루프
        server.serve_forever()

    except KeyboardInterrupt:
        print("\n서버가 사용자에 의해 종료되었습니다.")
    except Exception as e:
        traceback.print_exc()
        input("Press Enter to exit...")
