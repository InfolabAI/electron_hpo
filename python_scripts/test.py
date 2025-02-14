import optuna
import json


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
                    # convert string to the name of python variable
                    arg_dict[el['name']] = trial.suggest_float(
                        el['name'], low=float(el['min']), high=float(el['max']), step=None if el['step'] == '' else float(el['step']), log=False if el['log'] == 'linear' else True)
                elif el['type'] == 'int':
                    arg_dict[el['name']] = trial.suggest_int(
                        el['name'], low=int(el['min']), high=int(el['max']), step=1 if el['step'] == '' else int(el['step']))
                elif el['type'] == 'category':
                    arg_dict[el['name']] = trial.suggest_categorical(
                        el['name'], choices=el['categories'].split(','))
            except Exception as e:
                if self.is_print:
                    print(f"Error: {e} in processing {el}, len {len(data)}")

        # json 에서 lr, arc 가져오기
        self.is_print = False
        return arg_dict


lj = LoadJSON()


def func(**kwargs):
    lr = kwargs.get('lr')
    arc = kwargs.get('arc')

    # 예시로 lr이 크면 점수가 조금 더 높아진다고 "가정"하고,arc가 'nn'이면 점수가 조금 더 높아진다고 "가정"
    base_score = 0.8  # 임의의 베이스 점수
    lr_influence = (lr - 0.1) * 0.1  # lr에 따른 점수 차등
    arc_influence = 0.12 if arc == 'nn' else 0.0

    auroc = base_score + lr_influence + arc_influence

    return auroc


def objective(trial: optuna.Trial) -> float:
    # 하이퍼파라미터 범위 설정
    # lr = trial.suggest_float("lr", 0.1, 1.0)
    # arc = trial.suggest_categorical("arc", ["mm", "nn"])

    arg_dict = lj.load_json(trial)

    # func을 호출하고 auroc을 반환
    auroc = func(**arg_dict)
    return auroc


if __name__ == "__main__":
    # TPE Sampler(베이지안 최적화 방식) 사용
    sampler = optuna.samplers.TPESampler()

    # AUROC을 최대화하려면 direction='maximize'로 설정
    study = optuna.create_study(direction='maximize', sampler=sampler)
    study.optimize(objective, n_trials=50)

    print("Best trial:")
    best_trial = study.best_trial
    print(f"  Value(AUROC): {best_trial.value}")
    print("  Params: ")
    for key, value in best_trial.params.items():
        print(f"    {key}: {value}")
