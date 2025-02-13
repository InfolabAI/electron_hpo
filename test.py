import optuna
print("Hello")


def func(**kwargs):
    lr = kwargs.get('lr')
    arc = kwargs.get('arc')

    # 예시로 lr이 크면 점수가 조금 더 높아진다고 "가정"하고,arc가 'nn'이면 점수가 조금 더 높아진다고 "가정"
    base_score = 0.8  # 임의의 베이스 점수
    lr_influence = (lr - 0.1) * 0.1  # lr에 따른 점수 차등
    arc_influence = 0.02 if arc == 'nn' else 0.0

    auroc = base_score + lr_influence + arc_influence

    return auroc


def objective(trial: optuna.Trial) -> float:
    # 하이퍼파라미터 범위 설정
    lr = trial.suggest_float("lr", 0.1, 1.0)
    arc = trial.suggest_categorical("arc", ["mm", "nn"])

    # func을 호출하고 auroc을 반환
    auroc = func(lr=lr, arc=arc)
    return auroc


if __name__ == "__main__":
    # TPE Sampler(베이지안 최적화 방식) 사용
    sampler = optuna.samplers.TPESampler()

    # AUROC을 최대화하려면 direction='maximize'로 설정
    study = optuna.create_study(direction='maximize', sampler=sampler)
    study.optimize(objective, n_trials=30)

    print("Best trial:")
    best_trial = study.best_trial
    print(f"  Value(AUROC): {best_trial.value}")
    print("  Params: ")
    for key, value in best_trial.params.items():
        print(f"    {key}: {value}")
