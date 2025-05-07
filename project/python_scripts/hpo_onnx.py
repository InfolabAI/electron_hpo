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

# 필요하다면 함께 사용
from common import get_memory_bank_manager

# Default constants that will be updated with command-line args
RESIZE_SIZE = 256
ANOMALY_MAP_FOLDER = "anomaly_maps"
MEMORY_BANK_FOLDER = "models"
MODEL_PATH = "models/model.onnx"

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
    ):
        self.image_paths = get_image_paths(folder_path)
        if limit is not None and len(self.image_paths) > limit:
            np.random.seed(seed)
            self.image_paths = np.random.choice(self.image_paths, limit, replace=False).tolist()

        self.transform = transform
        self.resize = T.Resize(RESIZE_SIZE) if resize else None
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

# -------------------------- ONNX 모델 관련 --------------------------- #

def load_onnx_model(model_path):
    """ONNX 모델을 GPU로 로드"""
    onnx_model = onnxruntime.InferenceSession(
        model_path,
        providers=['CUDAExecutionProvider']
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

def create_memory_bank(folder_paths, model, dataloaders, coreset_ratio=0.005, memory_bank_folder=MEMORY_BANK_FOLDER):
    print("\n[메모리 뱅크 생성 중]")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    mb_mgr = get_memory_bank_manager(coreset_ratio, device)

    features_all = []
    for path, dl in zip(folder_paths, dataloaders):
        for imgs, _ in tqdm(dl, desc=f"> {path}"):
            feats = get_patch_features(model, imgs)
            features_all.append(feats)

    mb_mgr.fill_memory_bank(features_all)

    # Patch shape 추론 & 저장
    feat_side = int(np.sqrt(features_all[0].shape[0]))
    mb_mgr.save(memory_bank_folder, [[feat_side, feat_side]])
    print(f"메모리 뱅크 저장 완료: {memory_bank_folder}")
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

    # --------------------------- 핵심 함수 --------------------------- #
    def func(self, brightness: float = 0.0, contrast: float = 0.0, saturation: float = 0.0, hue: float = 0.0) -> float:
        """
        1) A_TRAIN_COLOR 생성: A_TRAIN 각 이미지에 ColorJitter 파라미터 내에서 랜덤한 색상 변환 적용
        2) A_TRAIN + A_TRAIN_COLOR 로 메모리 뱅크 생성
        3) B_TEST (원본) 에 대한 anomaly score 평균 계산 후 음수 부호로 반환
        
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
            float: B_TEST에 대한 anomaly score 평균의 음수값 (최소화 문제로 변환)

        """
        print(f"ColorJitter 파라미터: brightness={brightness}, contrast={contrast}, saturation={saturation}, hue={hue}")
        
        # 결과 저장용 디렉토리 생성
        os.makedirs(self.memory_bank_folder, exist_ok=True)
        os.makedirs(self.anomaly_map_folder, exist_ok=True)

        # --- A_TRAIN 원본 DataLoader --- #
        ds_a_orig = TransformedDataset(
            self.line_a_path,
            transform=None,
            resize=True,
            mean=self.folder_a_mean,
            std=self.folder_a_std,
        )
        dl_a_orig = DataLoader(ds_a_orig, batch_size=1, shuffle=False)

        # --- A_TRAIN_COLOR DataLoader (3개 복제본 생성) --- #
        # ColorJitter 변환은 PIL 이미지에 적용
        transforms_list = [
            T.ColorJitter(brightness=brightness, contrast=contrast, saturation=saturation, hue=hue),
        ]
        
        color_tf = T.Compose(transforms_list)
        
        ds_a_color = TransformedDataset(
            self.line_a_path,
            transform=color_tf,
            resize=True,
            mean=None,
            std=None,
        )
        dl_a_color = DataLoader(ds_a_color, batch_size=1, shuffle=False)
        
        # --- 메모리 뱅크 (A + A_COLOR) --- #
        mb_mgr = create_memory_bank(
            [self.line_a_path, f"{self.line_a_path}_COLOR1", f"{self.line_a_path}_COLOR2", f"{self.line_a_path}_COLOR3"],
            self.model,
            [dl_a_orig, dl_a_color, dl_a_color, dl_a_color],
            coreset_ratio=0.005,
            memory_bank_folder=self.memory_bank_folder,
        )

        # --- B_TEST (원본) DataLoader --- #
        ds_b = TransformedDataset(
            self.line_b_path,
            transform=None,
            resize=True,
            mean=self.folder_b_mean,
            std=self.folder_b_std,
        )
        dl_b = DataLoader(ds_b, batch_size=1, shuffle=False)

        # --- anomaly score 계산 --- #
        results_b = compute_top_anomaly_scores(dl_b, mb_mgr, self.model, top_percent=0.1)
        mean_score = float(np.mean([r["top_mean_score"] for r in results_b])) if results_b else 0.0

        return -mean_score

def main():
    # 명령줄 인수 파싱
    parser = argparse.ArgumentParser(description='HPO ONNX 도구')
    parser.add_argument('line_a_path', help='첫 번째 이미지 라인 폴더 경로')
    parser.add_argument('line_b_path', help='두 번째 이미지 라인 폴더 경로')
    parser.add_argument('--root', default="", help='root 폴더')
    parser.add_argument('--brightness', type=float, default=0.2, help='밝기 변화 강도')
    parser.add_argument('--contrast', type=float, default=0.2, help='대비 변화 강도')
    parser.add_argument('--saturation', type=float, default=0.2, help='채도 변화 강도')
    parser.add_argument('--hue', type=float, default=0.1, help='색조 변화 강도')
    
    args = parser.parse_args()
    
    # A 클래스 인스턴스 생성
    a = A(root=args.root, line_a_path=args.line_a_path, line_b_path=args.line_b_path)
    
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
