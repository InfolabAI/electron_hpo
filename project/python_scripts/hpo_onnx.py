import torch
import torchvision.transforms as T
from torch.utils.data import DataLoader
import numpy as np
import os
import argparse

# Import classes, constants and functions from dist_onnx
from dist_onnx import (
    RESIZE_SIZE, ANOMALY_MAP_FOLDER, MEMORY_BANK_FOLDER, MODEL_PATH, NUM_WORKERS,
    IMAGENET_MEAN, IMAGENET_STD, USE_IMAGENET_NORM, CENTER_CROP_RATE,
    init_directories, get_image_paths, calculate_image_statistics,
    TransformedDataset, load_onnx_model, get_patch_features,
    create_memory_bank, compute_top_anomaly_scores, compute_anomaly_map,
    A as BaseA  # Import A class from dist_onnx as BaseA
)

# ------------------------------- Class A ----------------------------- #

class A(BaseA):
    def __init__(self, root="", line_a_path="", line_b_path=""):
        # 경로 설정
        self.root = root
        self.line_a_path = line_a_path
        self.line_b_path = line_b_path

        # 폴더 및 모델 경로 설정
        self.anomaly_map_folder = os.path.join(root, ANOMALY_MAP_FOLDER)
        self.memory_bank_folder = os.path.join(root, MEMORY_BANK_FOLDER)
        self.model_path = os.path.join(root, MODEL_PATH)
        
        # 디렉토리 초기화
        init_directories(self.anomaly_map_folder, self.memory_bank_folder)

        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = load_onnx_model(self.model_path)

        # ONNX 모델은 이미 정규화가 포함되어 있으므로 0-1 범위로만 변환 (정규화 생략)
        print("ONNX 모델은 이미 ImageNet 정규화가 포함되어 있어 추가 정규화를 생략합니다.")
        self.folder_a_mean = None
        self.folder_a_std = None
        self.folder_b_mean = None
        self.folder_b_std = None
        
        print(f"CENTER_CROP_RATE: {CENTER_CROP_RATE}")
        print(f"LOCAL_FOLDER_A: {line_a_path}")
        print(f"LOCAL_FOLDER_B: {line_b_path}")
        
        # 데이터셋 초기화 - 8:2 비율로 train/test 분할
        self.train_ratio = 0.8
        
        # A 라인 데이터셋 (train/test)
        self.ds_a_training = TransformedDataset(
            line_a_path,
            transform=None,
            resize=True,
            mean=self.folder_a_mean,
            std=self.folder_a_std,
            limit=50,
            train_split=self.train_ratio
        )
        
        self.ds_a_test = TransformedDataset(
            line_a_path,
            transform=None,
            resize=True,
            mean=self.folder_a_mean,
            std=self.folder_a_std,
            limit=30,
            train_split=-self.train_ratio  # 음수 값은 test set을 의미
        )
        
        # B 라인 데이터셋 (train/test)
        self.ds_b_training = TransformedDataset(
            line_b_path,
            transform=None,
            resize=True,
            mean=self.folder_b_mean,
            std=self.folder_b_std,
            limit=50,
            train_split=self.train_ratio
        )
        
        self.ds_b_test = TransformedDataset(
            line_b_path,
            transform=None,
            resize=True,
            mean=self.folder_b_mean,
            std=self.folder_b_std,
            limit=30,
            train_split=-self.train_ratio  # 음수 값은 test set을 의미
        )
        
        # 컬러 변환된 데이터셋 (초기 transform은 None으로 설정)
        self.ds_a_color = TransformedDataset(
            line_a_path,
            transform=None,
            resize=True,
            mean=None,
            std=None,
            selected_paths=self.ds_a_training.image_paths.copy()  # 동일한 이미지 사용
        )

    # hpo_onnx.py 전용 함수 구현
    def func(self, brightness: float = 0.0, contrast: float = 0.0, saturation: float = 0.0, hue: float = 0.0) -> float:
        """
        1) A_TRAIN_COLOR 생성: A_TRAIN 각 이미지에 ColorJitter 파라미터 내에서 랜덤한 색상 변환 적용
        2) A_TRAIN + A_TRAIN_COLOR 로 메모리 뱅크 생성
        3) 차이 점수 계산: B_TEST와 A_TEST 간의 anomaly score 차이 계산 후 반환
        
        Args:
            brightness: 밝기 변화 최대 강도 (0: 변화 없음, 값이 클수록 더 큰 변화 가능성)
            contrast: 대비 변화 최대 강도 (0: 변화 없음, 값이 클수록 더 큰 변화 가능성)
            saturation: 채도 변화 최대 강도 (0: 변화 없음, 값이 클수록 더 큰 변화 가능성)
            hue: 색조 변화 최대 강도 (0: 변화 없음, 값이 클수록 더 큰 변화 가능성)

        HPO 파라미터 범위 추천:
        - brightness: 0.0 ~ 0.5
        - contrast: 0.0 ~ 0.5
        - saturation: 0.0 ~ 0.5
        - hue: 0.0 ~ 0.2
        
        Returns:
            float: B_TEST와 A_TEST 간의 anomaly score 차이

        """
        print(f"ColorJitter 파라미터: brightness={brightness}, contrast={contrast}, saturation={saturation}, hue={hue}")
        
        # 결과 저장용 디렉토리 생성
        os.makedirs(self.memory_bank_folder, exist_ok=True)
        os.makedirs(self.anomaly_map_folder, exist_ok=True)

        # A_TRAIN 및 A_TEST 데이터로더 생성
        dl_a_training = DataLoader(self.ds_a_training, batch_size=1, shuffle=False, num_workers=NUM_WORKERS)
        dl_a_test = DataLoader(self.ds_a_test, batch_size=1, shuffle=False, num_workers=NUM_WORKERS)

        # A_COLOR transform 업데이트 (init에서 생성된 데이터셋 재사용)
        color_tf = T.ColorJitter(brightness=brightness, contrast=contrast, saturation=saturation, hue=hue)
        self.ds_a_color.update_transform(color_tf)
        dl_a_color = DataLoader(self.ds_a_color, batch_size=1, shuffle=False, num_workers=NUM_WORKERS)
        
        # B_TEST 데이터로더 생성
        dl_b_test = DataLoader(self.ds_b_test, batch_size=1, shuffle=False, num_workers=NUM_WORKERS)
        
        # --- 메모리 뱅크 (A_TRAINING + A_COLOR) --- #
        mb_mgr = create_memory_bank(
            [self.line_a_path, f"{self.line_a_path}_COLOR1", f"{self.line_a_path}_COLOR2", f"{self.line_a_path}_COLOR3"],
            self.model,
            [dl_a_training, dl_a_color, dl_a_color, dl_a_color],
            memory_bank_folder=self.memory_bank_folder,
        )

        # --- A_TEST에 대한 anomaly score 계산 --- #
        results_a_test = compute_top_anomaly_scores(dl_a_test, mb_mgr, self.model, top_percent=0.1)
        mean_score_a = float(np.mean([r["top_mean_score"] for r in results_a_test])) if results_a_test else 0.0
        
        # --- B_TEST에 대한 anomaly score 계산 --- #
        results_b_test = compute_top_anomaly_scores(dl_b_test, mb_mgr, self.model, top_percent=0.1)
        mean_score_b = float(np.mean([r["top_mean_score"] for r in results_b_test])) if results_b_test else 0.0

        # B_TEST와 A_TEST 간의 차이 반환
        score_diff = mean_score_b - mean_score_a
        print(f"A_TEST 평균 점수: {mean_score_a}")
        print(f"B_TEST 평균 점수: {mean_score_b}")
        print(f"차이 점수: {score_diff}")
        
        return -score_diff # 최소화 문제로 변환