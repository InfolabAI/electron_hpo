import optuna
import json
import threading
import time
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

# 이 방식은 "완전 무조건 flush(unbuffered)"는 아니지만, 줄 단위로 버퍼가 비워집니다.
# 만약 print(..., end='') 처럼 개행 없이 출력하는 경우에는 버퍼가 쌓일 수도 있으니 주의하세요.
sys.stdout.reconfigure(line_buffering=True)


# 전역 변수들
CURRENT_ARGS = None   # 현재 Trial의 파라미터 dict
CURRENT_SCORE = None  # 현재 Trial에 대한 score(auroc)

# -------------------------
# 간단한 Handler 정의
# -------------------------


class SimpleHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        """
        - /trial 로 요청이 오면, 현재 Trial 파라미터를 JSON으로 응답
        - 그 외 경로는 404
        """
        if self.path == "/trial":
            if CURRENT_ARGS is not None:
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                resp = json.dumps(CURRENT_ARGS)
                self.wfile.write(resp.encode("utf-8"))
            else:
                self.send_error(404, "No current trial parameters.")
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        """
        - /score 로 요청이 오면, Body(JSON)에서 auroc 점수를 추출하여 CURRENT_SCORE에 세팅
        - {"auroc": float_value} 형태라고 가정
        """
        if self.path == "/score":
            content_length = int(self.headers["Content-Length"])
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                # JSON 안에 {"auroc": ...} 이 있다고 가정
                global CURRENT_SCORE
                CURRENT_SCORE = float(data["auroc"])
                self.send_response(200)
                self.send_header("Content-type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Score received.")
            except Exception as e:
                self.send_error(
                    400, f"Error parsing JSON or missing 'auroc': {e}")
        else:
            self.send_error(404, "Not Found")

# -------------------------
# JSON 로더 클래스
# -------------------------


class LoadJSON:
    def __init__(self):
        self.is_print = True

    def load_json(self, trial):
        # 실행하는 HPO 프로그램 폴더가 root 라서 json_files/config.json 가 문제없이 동작함
        with open('json_files/config.json', 'r') as f:
            data = json.load(f)

        arg_dict = {}
        for el in data:
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
                if self.is_print:
                    print(f"Error: {e} in processing {el}, len {len(data)}")

        self.is_print = False
        return arg_dict


lj = LoadJSON()

# -------------------------
# Optuna objective
# -------------------------


def objective(trial: optuna.Trial) -> float:
    global CURRENT_ARGS, CURRENT_SCORE

    # 1) JSON 기반으로 하이퍼파라미터 세팅
    arg_dict = lj.load_json(trial)

    # 2) 웹서버에 응답할 수 있도록 전역변수에 저장
    CURRENT_ARGS = arg_dict
    # 3) 이전 Trial의 잔여값이 남아있을 수 있으므로 None으로 초기화
    CURRENT_SCORE = None

    print(
        f"[Trial {trial.number}] 대기 중... (GET /trial -> 파라미터 확인 후, POST /score -> auroc 전송)\n{arg_dict}")

    # 4) 사용자 요청이 올 때까지 대기 (CURRENT_SCORE가 셋팅될 때까지)
    while CURRENT_SCORE is None:
        time.sleep(0.01)

    # 5) 외부에서 받은 점수 사용

    auroc = CURRENT_SCORE

    print(f"[Trial {trial.number}] metric({auroc}) -> Trial 완료!")
    return auroc


if __name__ == "__main__":
    # -------------------------
    # 1. 로컬 웹서버 기동
    # -------------------------
    host = "0.0.0.0"
    port = 8005
    server = HTTPServer((host, port), SimpleHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"서버 시작: http://{host}:{port}")

    # -------------------------
    # 2. Optuna 설정 및 실행
    # -------------------------
    sampler = optuna.samplers.TPESampler()
    study = optuna.create_study(direction='maximize', sampler=sampler)
    study.optimize(objective, n_trials=30)

    # -------------------------
    # 3. 결과 출력
    # -------------------------
    best_trial = study.best_trial
    print("Best trial:")
    print(f"  Value(AUROC): {best_trial.value}")
    print("  Params: ")
    for key, value in best_trial.params.items():
        print(f"    {key}: {value}")

    # 실행하는 HPO 프로그램 폴더가 root 라서 json_files/config.json 가 문제없이 동작함
    with open("json_files/best_metric.json", "w") as f:
        json.dump({'best_metric': best_trial.value}, f)
    with open("json_files/best_params.json", "w") as f:
        json.dump(best_trial.params, f)

    # 필요하다면 서버를 종료하고 싶을 때
    # server.shutdown()
