import torch
import torchvision.transforms as T
from torch.utils.data import DataLoader, Dataset
import numpy as np
import onnxruntime
import os
import glob
import shutil
from PIL import Image
from tqdm import tqdm
import argparse
import sys
import json

sys.path.append(os.path.dirname(os.path.abspath(__file__))) # windows 배포 시, 같은 경로 파일 import 위해 필요
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE" # windows 배포 시, ONNX 와 FAISS 의 OpenMP 충돌 우회를 위해 필요

# 필요하다면 함께 사용
from common import get_memory_bank_manager

# Default constants that will be updated with command-line args
RESIZE_SIZE = 256
ANOMALY_MAP_FOLDER = "anomaly_maps"
MEMORY_BANK_FOLDER = "memory_dist"
MODEL_PATH = "models/model.onnx"
NUM_WORKERS = 0
TEST_RATIO = 0.2


SAVE_DETAILS = '_anomaly_maps'

# ImageNet mean and std
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
USE_IMAGENET_NORM = True  # ImageNet 정규화 사용 플래그

# 중앙 크롭 비율 (1.0 = 원본 크기 유지, 작을수록 더 많이 크롭)
CENTER_CROP_RATE = 0.8

# ----------------------------- 공통 유틸 ----------------------------- #

def init_directories(*dirs):
    for dir_path in dirs:
        if os.path.exists(dir_path):
            shutil.rmtree(dir_path)
        os.makedirs(dir_path)

def init_files(*files):
    for file_path in files:
        if os.path.exists(file_path):
            os.remove(file_path)

def get_image_paths(folder_path):
    image_paths = []
    for ext in ["png", "jpg", "jpeg", "bmp", "tif", "tiff"]:
        image_paths += glob.glob(os.path.join(folder_path, f"*.{ext}"))
    image_paths.sort()
    return image_paths

def report_progress(progress, status="processing"):
    """
    진행 상황을 Electron에 보고하는 함수
    
    매개변수:
        progress: 0에서 100 사이의 진행률 
        status: 현재 처리 상태 메시지
    """
    # JSON 형식으로 진행 상황 보고
    progress_data = {
        "progress": round(progress, 2),
        "status": status
    }
    print(json.dumps(progress_data), flush=True)

def calculate_image_statistics(folder_path):
    """폴더 내 모든 이미지를 256×256으로 리사이즈한 뒤 채널 단위 mean / std 계산"""
    dataset = TransformedDataset(folder_path, transform=None, resize=True)
    loader  = DataLoader(dataset, batch_size=16, shuffle=False)

    sum_c, sum_sq_c = torch.zeros(3), torch.zeros(3)
    total_px = 0
    for imgs, _ in tqdm(loader, desc=f"[통계 계산] {folder_path}"):
        # Convert to proper format for calculation
        imgs_chw = imgs.permute(0, 3, 1, 2).float() / 255.0
        sum_c     += imgs_chw.sum(dim=[0, 2, 3])
        sum_sq_c  += (imgs_chw ** 2).sum(dim=[0, 2, 3])
        total_px  += imgs_chw.shape[0] * imgs_chw.shape[2] * imgs_chw.shape[3]

    mean = sum_c / total_px
    var  = sum_sq_c / total_px - mean**2
    std  = torch.sqrt(var + 1e-8)
    return mean, std

# -------------------------- 데이터셋/트랜스폼 ------------------------- #

class TransformedDataset(Dataset):
    def __init__(
        self,
        folder_path,
        transform=None,
        resize=True,
        limit=None,
        seed=42,
        mean=None,
        std=None,
        selected_paths=None,
        train_split=None,
    ):
        if selected_paths is not None:
            self.image_paths = selected_paths
        else:
            self.image_paths = get_image_paths(folder_path)
            
            
            # Apply train/test split if specified
            if train_split is not None:
                # 파일명 기준으로 정렬 (오름차순)
                self.image_paths.sort()
                
                split_idx = int(len(self.image_paths) * abs(train_split))
                
                if train_split > 0:  # Training set - 뒷부분 사용
                    self.image_paths = self.image_paths[split_idx:]
                else:  # Test set - 앞부분 사용 (1-train_split 비율)
                    self.image_paths = self.image_paths[:split_idx]
            
            # Print the first and last image paths for debugging
            if len(self.image_paths) > 0:
                print(f"First image path: {self.image_paths[0]}")
                if len(self.image_paths) > 1:
                    print(f"Last image path: {self.image_paths[-1]}")

            
            # 항상 최종 경로 리스트 정렬
            self.image_paths.sort()
            
            # Apply limit after splitting if specified
            if limit is not None and len(self.image_paths) > limit:
                np.random.seed(seed)
                self.image_paths = np.random.choice(self.image_paths, limit, replace=False).tolist()
                # 무작위 선택 후에도 정렬 유지
                self.image_paths.sort()

        self.transform = transform
        self.resize = T.Resize((RESIZE_SIZE, RESIZE_SIZE)) if resize else None
        self.mean, self.std = mean, std

    def __len__(self):
        return len(self.image_paths)

    def __getitem__(self, idx):
        img_path = self.image_paths[idx]
        img = Image.open(img_path).convert("RGB")

        # 중앙 크롭 적용
        width, height = img.size
        new_width = int(width * CENTER_CROP_RATE)
        new_height = int(height * CENTER_CROP_RATE)
        img = img.crop((
            (width - new_width) // 2,
            (height - new_height) // 2,
            (width + new_width) // 2,
            (height + new_height) // 2
        ))

        if self.transform:
            img = self.transform(img)
        
        # T.ToTensor() 사용하지 않고 차원 순서 유지
        if self.resize:
            img = self.resize(img)
            
        # PIL 이미지를 numpy 배열로 변환 (H, W, C) 형식 유지
        img_np = np.array(img)
        
        # numpy 배열을 torch 텐서로 변환 (H, W, C) 형식 유지
        img_tensor = torch.from_numpy(img_np).float()

        return img_tensor, img_path

    def update_transform(self, new_transform):
        """Transform을 업데이트하는 메서드"""
        self.transform = new_transform
        return self

# -------------------------- ONNX 모델 관련 --------------------------- #

def load_onnx_model(model_path):
    """ONNX 모델을 GPU로 로드"""
    onnx_model = onnxruntime.InferenceSession(
        model_path,
        providers=['CUDAExecutionProvider']
        #providers=['CPUExecutionProvider']
    )
    return onnx_model

def get_patch_features(model, img_tensor):
    """ONNX 모델을 사용하여 특징을 추출"""
    # ONNX 모델은 numpy 입력을 받으므로 변환
    input_name = model.get_inputs()[0].name
    ort_inputs = {input_name: img_tensor.numpy().astype(np.float32)}
    ort_outputs = model.run(None, ort_inputs)
    features = ort_outputs[0]  # 첫 번째 출력을 사용
    return features

def create_memory_bank(folder_paths, model, dataloaders, memory_bank_folder=MEMORY_BANK_FOLDER):
    print("\n[메모리 뱅크 생성 중]")
    report_progress(0, "메모리 뱅크 생성 중")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    # 총 이미지 수 계산
    total_images = sum(len(dl.dataset) for dl in dataloaders)

    # 이미지당 패치 수 (32x32)
    patches_per_image = 32 * 32
    
    # 총 패치 수 계산
    total_patches = total_images * patches_per_image
    
    # 목표 subsampling 수 (10,000개)
    target_samples = 10000
    
    # coreset_ratio 자동 계산 (최소 0.001, 최대 1.0으로 제한)
    if total_patches > 0:
        calculated_ratio = min(max(target_samples / total_patches, 0.001), 1.0)
        coreset_ratio = calculated_ratio
        print(f"총 이미지 수: {total_images}, 총 패치 수: {total_patches}")
        print(f"목표 샘플 수: {target_samples}, 계산된 coreset_ratio: {coreset_ratio:.6f}")
    else:
        print("경고: 데이터셋이 비어 있습니다. 기본 coreset_ratio를 사용합니다.")

    mb_mgr = get_memory_bank_manager(coreset_ratio, device)

    features_all = []
    
    # 진행률 계산을 위한 변수
    processed_images = 0
    
    for path_idx, (path, dl) in enumerate(zip(folder_paths, dataloaders)):
        for batch_idx, (imgs, _) in enumerate(tqdm(dl, desc=f"> {path}")):
            feats = get_patch_features(model, imgs)
            features_all.append(feats)
            
            # 진행률 업데이트 (메모리 뱅크 생성은 전체 과정의 0-50% 차지)
            processed_images += 1
            progress = (processed_images / total_images) * 50
            report_progress(progress, "메모리 뱅크 생성 중")

    mb_mgr.fill_memory_bank(features_all)

    # Patch shape 추론 & 저장
    feat_side = int(np.sqrt(features_all[0].shape[0]))
    mb_mgr.save(memory_bank_folder, [[feat_side, feat_side]])
    print(f"메모리 뱅크 저장 완료: {memory_bank_folder}")
    report_progress(50, "메모리 뱅크 생성 완료")
    return mb_mgr

def compute_top_anomaly_scores(dataloader, mb_mgr, model, top_percent=0.1):
    scores = []
    for imgs, paths in tqdm(dataloader, desc="[Anomaly Score]"):
        anom_map, _ = compute_anomaly_map(imgs, mb_mgr, model)
        flat = anom_map.flatten()
        k    = int(len(flat) * top_percent)
        topk = np.partition(flat, -k)[-k:]
        scores.append({"image_path": paths[0], "top_mean_score": float(np.mean(topk))})

    return scores

def compute_anomaly_map(img_tensor, mb_mgr, model, reshape=True):
    feats = get_patch_features(model, img_tensor)
    if reshape:
        scores = mb_mgr.predict(feats, [[32, 32]]).squeeze(0) # 내부 *(self.patch_shape[0]) 에 대응하기 위함
    else:
        scores = mb_mgr.predict_no_reshape(feats)
    return scores, feats

# ------------------------------- Class A ----------------------------- #

class A:
    def __init__(self, root="", line_a_path="", line_b_path="", gap=0.0):
        # 경로 설정
        self.root = root
        self.line_a_path = line_a_path
        self.line_b_path = line_b_path
        self.gap = gap  # GAP 값을 인스턴스 변수로 저장

        # 폴더 및 모델 경로 설정
        self.anomaly_map_folder = os.path.join(root, ANOMALY_MAP_FOLDER)
        self.memory_bank_folder = os.path.join(root, MEMORY_BANK_FOLDER)
        self.model_path = os.path.join(root, MODEL_PATH)


        # 라인별 anomaly_map 저장 디렉토리 생성
        # 경로 끝의 슬래시 제거 후 SAVE_DETAILS 추가
        a_test_anomaly_dir = f"{self.line_a_path.rstrip('/')}{SAVE_DETAILS}"
        b_test_anomaly_dir = f"{self.line_b_path.rstrip('/')}{SAVE_DETAILS}"
        self.a_test_anomaly_dir = a_test_anomaly_dir
        self.b_test_anomaly_dir = b_test_anomaly_dir

        # 디렉토리 초기화
        init_directories(self.anomaly_map_folder, self.memory_bank_folder, a_test_anomaly_dir, b_test_anomaly_dir)

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
        self.test_ratio = TEST_RATIO
        
        # A 라인 데이터셋 (train/test)
        self.ds_a_training = TransformedDataset(
            line_a_path,
            transform=None,
            resize=True,
            mean=self.folder_a_mean,
            std=self.folder_a_std,
            train_split=self.test_ratio
        )
        
        self.ds_a_test = TransformedDataset(
            line_a_path,
            transform=None,
            resize=True,
            mean=self.folder_a_mean,
            std=self.folder_a_std,
            train_split=-self.test_ratio  # 음수 값은 test set을 의미
        )
        
        # B 라인 데이터셋 (train/test)
        self.ds_b_training = TransformedDataset(
            line_b_path,
            transform=None,
            resize=True,
            mean=self.folder_b_mean,
            std=self.folder_b_std,
            train_split=self.test_ratio
        )
        
        self.ds_b_test = TransformedDataset(
            line_b_path,
            transform=None,
            resize=True,
            mean=self.folder_b_mean,
            std=self.folder_b_std,
            train_split=-self.test_ratio  # 음수 값은 test set을 의미
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

    # --------------------------- 핵심 함수 --------------------------- #
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
        # 초기 진행 상황 보고
        report_progress(0, "시작")
        
        print(f"ColorJitter 파라미터: brightness={brightness}, contrast={contrast}, saturation={saturation}, hue={hue}")
        
        # 결과 저장용 디렉토리 생성
        os.makedirs(self.memory_bank_folder, exist_ok=True)
        os.makedirs(self.anomaly_map_folder, exist_ok=True)

        # 이미지 경로 명시적으로 정렬 (파일명 기준 오름차순)
        self.ds_a_test.image_paths.sort()
        self.ds_b_test.image_paths.sort()

        # A_TRAIN 및 A_TEST 데이터로더 생성
        dl_a_training = DataLoader(self.ds_a_training, batch_size=1, shuffle=False, num_workers=NUM_WORKERS)
        dl_a_test = DataLoader(self.ds_a_test, batch_size=1, shuffle=False, num_workers=NUM_WORKERS)
        
        # B_TEST 데이터로더 생성
        dl_b_test = DataLoader(self.ds_b_test, batch_size=1, shuffle=False, num_workers=NUM_WORKERS)
        
        # --- 메모리 뱅크 생성 --- #
        # 모든 컬러 파라미터가 0이면 ColorJitter 적용하지 않음
        if brightness == 0.0 and contrast == 0.0 and saturation == 0.0 and hue == 0.0:
            print("모든 ColorJitter 파라미터가 0입니다. ColorJitter를 제외합니다.")
            mb_mgr = create_memory_bank(
                [self.line_a_path],
                self.model,
                [dl_a_training],
                memory_bank_folder=self.memory_bank_folder,
            )
        else:
            # A_COLOR transform 업데이트 (init에서 생성된 데이터셋 재사용)
            color_tf = T.ColorJitter(brightness=brightness, contrast=contrast, saturation=saturation, hue=hue)
            self.ds_a_color.update_transform(color_tf)
            dl_a_color = DataLoader(self.ds_a_color, batch_size=1, shuffle=False, num_workers=NUM_WORKERS)
            
            mb_mgr = create_memory_bank(
                [self.line_a_path, f"{self.line_a_path}_COLOR1", f"{self.line_a_path}_COLOR2", f"{self.line_a_path}_COLOR3"],
                self.model,
                [dl_a_training, dl_a_color, dl_a_color, dl_a_color],
                memory_bank_folder=self.memory_bank_folder,
            )

        # --- A_TEST에 대한 anomaly map 및 점수 계산 --- #
        a_test_anomaly_maps = []
        a_test_scores = []
        
        report_progress(50, "Anomaly Maps 생성 중")
        total_a_test = len(dl_a_test.dataset)
        
        for idx, (imgs, paths) in enumerate(tqdm(dl_a_test, desc="[A_TEST Anomaly Maps]")):
            anom_map, _ = compute_anomaly_map(imgs, mb_mgr, self.model)
            a_test_anomaly_maps.append((anom_map, paths[0]))
            a_test_scores.append(np.max(anom_map))
            
            # 진행률 업데이트 (A_TEST는 50-75% 구간)
            progress = 50 + ((idx + 1) / total_a_test) * 25
            report_progress(progress, "Anomaly Maps 생성 중")
        
        # A_TEST의 최대 anomaly score 계산
        a_test_max_score = np.max(a_test_scores) if a_test_scores else 0.0
        mean_score_a = float(np.mean(a_test_scores)) if a_test_scores else 0.0
        print(f"A_TEST 최대 점수: {a_test_max_score}")
        print(f"A_TEST 평균 점수: {mean_score_a}")
        a_test_max_score = a_test_max_score + self.gap
        

        # --- A_TEST anomaly map을 바이너리 마스크로 변환하여 저장 --- #
        for anom_map, img_path in a_test_anomaly_maps:
            # 원본 이미지 로드하여 크기 확인
            original_img = Image.open(img_path)
            orig_width, orig_height = original_img.size
            
            # anomaly map을 bilinear 보간법으로 crop된 영역 크기로 확대
            # CENTER_CROP_RATE가 0.8이므로, anomaly map은 원본의 80% 크기에 해당
            cropped_width = int(orig_width * CENTER_CROP_RATE)
            cropped_height = int(orig_height * CENTER_CROP_RATE)
            
            anom_map_img = Image.fromarray(anom_map)
            anom_map_img = anom_map_img.resize((cropped_width, cropped_height), Image.BILINEAR)
            anom_map_resized = np.array(anom_map_img)
            
            # 보간된 anomaly map에 대해 바이너리 마스크 생성: max 값보다 낮으면 0, 높거나 같으면 1
            binary_mask_cropped = (anom_map_resized >= a_test_max_score).astype(np.uint8) * 255
            
            # 패딩을 추가하여 원본 이미지 크기로 확장 (가장자리에 패딩 추가)
            binary_mask = np.zeros((orig_height, orig_width), dtype=np.uint8)
            
            # 계산된 크롭 영역의 시작점
            start_x = (orig_width - cropped_width) // 2
            start_y = (orig_height - cropped_height) // 2
            
            # 크롭된 anomaly map을 원본 이미지 중앙에 배치
            binary_mask[start_y:start_y+cropped_height, start_x:start_x+cropped_width] = binary_mask_cropped
            
            # 저장할 파일 경로 생성
            filename = os.path.basename(img_path)
            save_path = os.path.join(self.a_test_anomaly_dir, filename)
            
            # 바이너리 마스크 저장
            Image.fromarray(binary_mask).save(save_path)
        
        # --- B_TEST에 대한 anomaly map 및 점수 계산 --- #
        b_test_anomaly_maps = []
        b_test_scores = []
        
        report_progress(75, "Anomaly Maps 생성 중")
        total_b_test = len(dl_b_test.dataset)
        
        for idx, (imgs, paths) in enumerate(tqdm(dl_b_test, desc="[B_TEST Anomaly Maps]")):
            anom_map, _ = compute_anomaly_map(imgs, mb_mgr, self.model)
            b_test_anomaly_maps.append((anom_map, paths[0]))
            b_test_scores.append(np.max(anom_map))
            
            # 진행률 업데이트 (B_TEST는 75-100% 구간)
            progress = 75 + ((idx + 1) / total_b_test) * 25
            report_progress(progress, "Anomaly Maps 생성 중")
        
        mean_score_b = float(np.mean(b_test_scores)) if b_test_scores else 0.0
        print(f"B_TEST 평균 점수: {mean_score_b}")
        
        # --- B_TEST anomaly map을 바이너리 마스크로 변환하여 저장 --- #
        for anom_map, img_path in b_test_anomaly_maps:
            # 원본 이미지 로드하여 크기 확인
            original_img = Image.open(img_path)
            orig_width, orig_height = original_img.size
            
            # anomaly map을 bilinear 보간법으로 crop된 영역 크기로 확대
            # CENTER_CROP_RATE가 0.8이므로, anomaly map은 원본의 80% 크기에 해당
            cropped_width = int(orig_width * CENTER_CROP_RATE)
            cropped_height = int(orig_height * CENTER_CROP_RATE)
            
            anom_map_img = Image.fromarray(anom_map)
            anom_map_img = anom_map_img.resize((cropped_width, cropped_height), Image.BILINEAR)
            anom_map_resized = np.array(anom_map_img)
            
            # 보간된 anomaly map에 대해 바이너리 마스크 생성: max 값보다 낮으면 0, 높거나 같으면 1
            binary_mask_cropped = (anom_map_resized >= a_test_max_score).astype(np.uint8) * 255
            
            # 패딩을 추가하여 원본 이미지 크기로 확장 (가장자리에 패딩 추가)
            binary_mask = np.zeros((orig_height, orig_width), dtype=np.uint8)
            
            # 계산된 크롭 영역의 시작점
            start_x = (orig_width - cropped_width) // 2
            start_y = (orig_height - cropped_height) // 2
            
            # 크롭된 anomaly map을 원본 이미지 중앙에 배치
            binary_mask[start_y:start_y+cropped_height, start_x:start_x+cropped_width] = binary_mask_cropped
            
            # 저장할 파일 경로 생성
            filename = os.path.basename(img_path)
            save_path = os.path.join(self.b_test_anomaly_dir, filename)
            
            # 바이너리 마스크 저장
            Image.fromarray(binary_mask).save(save_path)

        # B_TEST와 A_TEST 간의 차이 반환
        score_diff = mean_score_b - mean_score_a
        print(f"차이 점수: {score_diff}")
        
        # 완료 메시지 전송
        report_progress(100, "완료")
        
        return -score_diff # 최소화 문제로 변환

def main():
    # 명령줄 인수 파싱
    parser = argparse.ArgumentParser(description='HPO ONNX 도구')
    parser.add_argument('line_a_path', help='첫 번째 이미지 라인 폴더 경로')
    parser.add_argument('line_b_path', help='두 번째 이미지 라인 폴더 경로')
    parser.add_argument('--root', default="", help='root 폴더')
    parser.add_argument('--brightness', type=float, default=0, help='밝기 변화 강도')
    parser.add_argument('--contrast', type=float, default=0, help='대비 변화 강도')
    parser.add_argument('--saturation', type=float, default=0, help='채도 변화 강도')
    parser.add_argument('--hue', type=float, default=0, help='색조 변화 강도')
    parser.add_argument('--gap', type=float, default=0.0)
    
    args = parser.parse_args()

    # A 클래스 인스턴스 생성
    a = A(root=args.root, line_a_path=args.line_a_path, line_b_path=args.line_b_path, gap=args.gap)
    
    # func 함수 호출하여 결과 출력
    result = a.func(
        brightness=args.brightness,
        contrast=args.contrast, 
        saturation=args.saturation,
        hue=args.hue
    )
    
    print(f"결과: {result}")
    
    return result

# ------------------------------ 실행 예시 ----------------------------- #

if __name__ == "__main__":
    main()
