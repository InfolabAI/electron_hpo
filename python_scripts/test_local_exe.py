import optuna
import os
import json
import subprocess
import time

# -------------------------
# JSON 로더 클래스
# -------------------------


class LoadJSON:
    def __init__(self, root):
        self.is_print = True
        self.root = root

    def load_json(self, trial):
        """
        config.json 내용을 참고하여,
        float, int, category 타입에 맞춰서 Optuna의 suggest_*()를 수행한 뒤
        dict 형태로 (파라미터명 -> 값)을 반환합니다.
        """
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
                    print(f"Error: {e} in processing {el}, len={len(data)}")

        self.is_print = False
        return arg_dict


# -------------------------
# Objective 클래스
# -------------------------
class MyObjective:
    def __init__(self, root, exe_path, score_path):
        """
        :param root: config.json 등이 있는 루트 경로
        :param exe_path: 실행할 exe 파일 경로
        :param score_path: exe 실행 후 결과 점수가 적힐 파일 경로
        """
        print(f"root path: {root}")
        self.lj = LoadJSON(root)
        self.exe_path = exe_path
        self.score_path = score_path
        self.score_list = []

    def __call__(self, trial: optuna.Trial) -> float:
        """
        Optuna가 각 Trial에서 이 함수를 호출하여,
        1) config.json 기반으로 하이퍼파라미터(arg_dict)를 생성한 뒤
        2) exe 파일을 실행 (--파라미터명 값 --파라미터명 값 ...)
        3) 실행 결과로 생성된 score_path 파일에서 점수를 읽어
        4) 해당 점수를 return
        """
        # 1) JSON에서 하이퍼파라미터를 로드
        arg_dict = self.lj.load_json(trial)

        # 2) exe 실행 (subprocess.run으로 blocking 실행)
        cmd = [self.exe_path]
        for k, v in arg_dict.items():
            cmd.append(f"--{k}={str(v)}")
        cmd.append(
            r"--inImg=C:\Users\robert.lim\Documents\HPO\Undistortion_test_dlladded\Undistortion_test\cross_pattern_distorted.bmp")
        cmd.append(
            r"--outImg=C:\Users\robert.lim\Documents\HPO\Undistortion_test_dlladded\Undistortion_test\cross_pattern_undistorted.bmp")
        cmd.append(
            r"--refImg=C:\Users\robert.lim\Documents\HPO\Undistortion_test_dlladded\Undistortion_test\cross_pattern_stationary.bmp")

        print(cmd)
        print(' '.join(cmd))
        ret = subprocess.run(cmd, check=True)
        print(f"ret of process {ret}")

        # 3) exe 실행 후 score_path에 기록된 점수(정수/실수)를 읽어옴
        with open(self.score_path, 'r') as f:
            score_str = f.read().strip()
        auroc = float(score_str)

        # 결과들 로깅 파일
        self.score_list.append(auroc)
        with open('./score_list.txt', 'w') as ff:
            for sc in self.score_list:
                ff.write(f"{sc}\n")

        if os.path.exists(self.score_path):
            os.remove(self.score_path)
            print(f"기존 점수 파일 '{self.score_path}' 을(를) 삭제했습니다.")
        else:
            print(f"삭제할 파일이 없습니다: '{self.score_path}'")

        print(f"[Trial {trial.number}] Params: {arg_dict}")
        print(f"[Trial {trial.number}] metric({auroc}) -> Trial complete!")

        # 4) 점수를 반환(Optuna가 이를 기준으로 최적화를 진행)
        return auroc


# -------------------------
# 실제 실행 예시 (메인)
# -------------------------
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=str, default='./')
    parser.add_argument("--exe_path", type=str,
                        default='path/to/your_executable.exe')
    parser.add_argument("--score_path", type=str,
                        default='path/to/result_score.txt')
    args = parser.parse_args()

    # 위에서 정의한 Objective 클래스에 필요한 인자 전달
    oj = MyObjective(
        root=args.root,
        exe_path=args.exe_path,
        score_path=args.score_path
    )

    # Optuna 스터디 생성 및 실행
    sampler = optuna.samplers.TPESampler()  # TPE Sampler(베이지안 최적화)
    study = optuna.create_study(direction='maximize', sampler=sampler)
    study.optimize(oj, n_trials=1000)  # n_trials 만큼 최적화 수행

    best_trial = study.best_trial
    print("Best trial:")
    print(f"  Value(AUROC): {best_trial.value}")
    print("  Params: ")
    for key, value in best_trial.params.items():
        print(f"    {key}: {value}")

    # 최적 파라미터 / 점수를 json으로 저장하고 싶다면
    os.makedirs(os.path.join(args.root, "json_files"), exist_ok=True)
    with open(os.path.join(args.root, "json_files", "best_metric.json"), "w") as f:
        json.dump({'best_metric': best_trial.value}, f)
    with open(os.path.join(args.root, "json_files", "best_params.json"), "w") as f:
        json.dump(best_trial.params, f)
