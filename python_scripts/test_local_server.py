import optuna
import os
import json
import threading
import time
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

# 이 방식은 "완전 무조건 flush(unbuffered)"는 아니지만, 줄 단위로 버퍼가 비워짐. 만약 print(..., end='') 처럼 개행 없이 출력하는 경우에는 버퍼가 쌓일 수도 있으니 주의.
sys.stdout.reconfigure(line_buffering=True)


# 전역 변수들
CURRENT_ARGS = None   # 현재 Trial의 파라미터 dict
CURRENT_SCORE = None  # 현재 Trial에 대한 score(auroc)

# -------------------------
# 간단한 Handler 정의
# -------------------------


class SimpleHandler(BaseHTTPRequestHandler):
    # HTTP GET 요청을 처리하는 메서드
    def do_GET(self):
        """
        - /trial 로 요청이 오면, 현재 Trial 파라미터를 JSON으로 응답
        - 그 외 경로는 404
        """
        # 요청받은 경로(self.path)가 "/trial" 인지 확인
        if self.path == "/trial":
            # 전역 변수 CURRENT_ARGS가 비어있지 않은 경우
            if CURRENT_ARGS is not None:
                # HTTP 응답 코드 200(OK)을 전송
                self.send_response(200)
                # 헤더에 Content-type을 'application/json'으로 설정
                self.send_header("Content-type", "application/json")
                # 헤더 전송 종료를 알림
                self.end_headers()
                # CURRENT_ARGS(파이썬 dict 등)를 JSON 문자열로 변환
                resp = json.dumps(CURRENT_ARGS)
                # wfile을 통해 응답 본문(body)을 전송 (UTF-8 인코딩)
                self.wfile.write(resp.encode("utf-8"))
            else:
                # CURRENT_ARGS가 None이라면 404 에러와 메시지 반환
                self.send_error(404, "No current trial parameters.")
        else:
            # "/trial" 이외의 경로로 들어오면 404 에러와 메시지 반환
            self.send_error(404, "Not Found")

    # HTTP POST 요청을 처리하는 메서드
    def do_POST(self):
        """
        - /score 로 요청이 오면, Body(JSON)에서 auroc 점수를 추출하여 CURRENT_SCORE에 세팅
        - {"auroc": float_value} 형태라고 가정
        """
        # 요청받은 경로(self.path)가 "/score" 인지 확인
        if self.path == "/score":
            # 요청 body의 길이(Content-Length) 가져오기
            content_length = int(self.headers["Content-Length"])
            # 요청 body를 읽어서(바이너리 형태) UTF-8로 디코딩
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                # body를 JSON으로 파싱
                data = json.loads(body)
                # 전역 변수 CURRENT_SCORE 사용을 선언
                global CURRENT_SCORE
                # JSON 안에서 "auroc" 키를 가져와 float로 변환해서 CURRENT_SCORE에 대입
                CURRENT_SCORE = float(data["auroc"])
                # 정상 처리를 의미하는 200(OK) 응답 전송
                self.send_response(200)
                # 헤더에 Content-type을 'text/plain'으로 설정
                self.send_header("Content-type", "text/plain")
                # 헤더 전송 종료를 알림
                self.end_headers()
                # 응답 메시지 전송
                self.wfile.write(b"Score received.")
            except Exception as e:
                # JSON 파싱 오류나 "auroc" 키가 없으면 400(Bad Request) 응답
                self.send_error(
                    400, f"Error parsing JSON or missing 'auroc': {e}")
        else:
            # "/score" 이외의 경로로 들어오면 404 에러
            self.send_error(404, "Not Found")


# -------------------------
# JSON 로더 클래스
# -------------------------


class LoadJSON:
    def __init__(self, root):
        self.is_print = True
        self.root = root

    def load_json(self, trial):
        # 실행하는 HPO 프로그램 폴더가 root 라서 json_files/config.json 가 문제없이 동작함
        with open(os.path.join(self.root, 'json_files', 'config.json'), 'r') as f:
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


# -------------------------
# Optuna objective
# -------------------------

class MyObjective:
    def __init__(self, root):
        print(f"root path: {root}")
        self.lj = LoadJSON(root)

    def __call__(self, trial: optuna.Trial) -> float:
        global CURRENT_ARGS, CURRENT_SCORE

        # 1) JSON 기반으로 하이퍼파라미터 세팅
        arg_dict = self.lj.load_json(trial)

        # 2) 웹서버에 응답할 수 있도록 전역변수에 저장
        CURRENT_ARGS = arg_dict
        # 3) 이전 Trial의 잔여값이 남아있을 수 있으므로 None으로 초기화
        CURRENT_SCORE = None

        print(
            f"[Trial {trial.number}] Waiting... (GET /trial -> check parameters, then POST /score -> send auroc).\n{arg_dict}")

        # 4) 사용자 요청이 올 때까지 대기 (CURRENT_SCORE가 셋팅될 때까지)
        while CURRENT_SCORE is None:
            time.sleep(0.01)

        # 5) 외부에서 받은 점수 사용

        auroc = CURRENT_SCORE

        print(f"[Trial {trial.number}] metric({auroc}) -> Trial complete!")
        return auroc


if __name__ == "__main__":
    import argparse
    args = argparse.ArgumentParser()
    args.add_argument("--port", type=int, default=8005)
    args.add_argument("--root", type=str, default='./')
    args.add_argument("--n_trials", type=int, default=30)
    args = args.parse_args()
    oj = MyObjective(root=args.root)
    # -------------------------
    # 1. 로컬 웹서버 기동
    # -------------------------
    host = "0.0.0.0"
    port = 8005
    server = HTTPServer((host, port), SimpleHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"Server started: http://{host}:{port}")

    # -------------------------
    # 2. Optuna 설정 및 실행
    # -------------------------
    sampler = optuna.samplers.TPESampler()
    study = optuna.create_study(direction='maximize', sampler=sampler)
    study.optimize(oj, n_trials=args.n_trials)

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
    with open(os.path.join(args.root, "json_files", "best_metric.json"), "w") as f:
        json.dump({'best_metric': best_trial.value}, f)
    with open(os.path.join(args.root, "json_files", "best_params.json"), "w") as f:
        json.dump(best_trial.params, f)

    # 필요하다면 서버를 종료하고 싶을 때
    # server.shutdown()
