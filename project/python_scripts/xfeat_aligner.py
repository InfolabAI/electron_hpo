import os
import time
import numpy as np
import cv2
import onnxruntime as ort
from tqdm import tqdm
import argparse
import json
import sys

class XFeatAligner:
    def __init__(self, model_path, input_size=512):
        """
        XFeat 기반 이미지 정렬 클래스 초기화
        
        매개변수:
            model_path: ONNX 모델 파일 경로
            input_size: 입력 이미지 크기
        """
        self.input_size = input_size
        self.model_path = model_path
        self.session = ort.InferenceSession(model_path, providers=["CUDAExecutionProvider"])
    
    def _load_model(self, provider="CPUExecutionProvider"):
        """
        지정된 공급자로 ONNX 모델 로드
        
        매개변수:
            provider: ONNX 실행 공급자 ("CPUExecutionProvider" 또는 "CUDAExecutionProvider")
        """
        session = ort.InferenceSession(self.model_path, providers=[provider])
        print(session.get_providers())
        return session
    
    def warp_corners_and_draw_matches(self, ref_points, dst_points, img1, img2):
        """
        두 이미지 간의 매칭점을 시각화하고 첫 번째 이미지의 경계를 두 번째 이미지에 투영합니다.
        
        매개변수:
            ref_points: 참조 이미지의 특징점 좌표
            dst_points: 대상 이미지의 특징점 좌표
            img1: 참조 이미지
            img2: 대상 이미지
            
        반환값:
            두 이미지의 매칭점과 투영된 경계가 표시된 결합 이미지
        """
        # Homography 행렬 계산 (USAC_MAGSAC 알고리즘 사용)
        H, mask = cv2.findHomography(ref_points, dst_points, cv2.USAC_MAGSAC, 3.5, maxIters=1_000, confidence=0.999)
        mask = mask.flatten()

        # 첫 번째 이미지(img1)의 모서리 좌표 가져오기
        h, w = img1.shape[:2]
        corners_img1 = np.array([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]], dtype=np.float32).reshape(-1, 1, 2)

        # Homography를 사용하여 모서리 좌표를 두 번째 이미지(img2) 공간으로 변환
        warped_corners = cv2.perspectiveTransform(corners_img1, H)

        # 두 번째 이미지에 변환된 모서리 그리기
        img2_with_corners = img2.copy()
        for i in range(len(warped_corners)):
            start_point = tuple(warped_corners[i-1][0].astype(int))
            end_point = tuple(warped_corners[i][0].astype(int))
            cv2.line(img2_with_corners, start_point, end_point, (0, 255, 0), 4)  # 모서리를 녹색 실선으로 표시

        # cv2.drawMatches 함수를 위한 키포인트 및 매치 준비
        keypoints1 = [cv2.KeyPoint(p[0], p[1], 5) for p in ref_points]
        keypoints2 = [cv2.KeyPoint(p[0], p[1], 5) for p in dst_points]
        matches = [cv2.DMatch(i,i,0) for i in range(len(mask)) if mask[i]]

        # 인라이어 매치 그리기
        img_matches = cv2.drawMatches(img1, keypoints1, img2_with_corners, keypoints2, matches, None,
                                    matchColor=(0, 255, 0), flags=2)

        return img_matches
    
    def align(self, ref_img_path, src_folder_path, save_visualizations=False, callback=None):
        """
        참조 이미지에 맞춰 대상 폴더의 모든 이미지를 정렬
        
        매개변수:
            ref_img_path: 참조 이미지 파일 경로
            src_folder_path: 정렬할 이미지가 있는 소스 폴더 경로
            save_visualizations: 시각화 결과를 저장할지 여부
            callback: 진행 상황을 보고하기 위한 콜백 함수
            
        반환값:
            정렬된 이미지가 저장된 폴더 경로
        """

        # 참조 이미지 로드
        ref_img = cv2.imread(ref_img_path)
        if ref_img is None:
            raise ValueError(f"참조 이미지를 로드할 수 없습니다: {ref_img_path}")
        
        # 정렬된 이미지를 저장할 출력 디렉토리 생성
        if src_folder_path.endswith('/') or src_folder_path.endswith('\\'):
            src_folder_path = src_folder_path[:-1]

        dst_folder_path = src_folder_path + '_aligned'

        # 출력 디렉토리가 없으면 생성
        os.makedirs(dst_folder_path, exist_ok=True)
            
        # 시각화 결과를 저장할 폴더 (옵션)
        if save_visualizations:
            vis_folder_path = src_folder_path + '_visualization'
            os.makedirs(vis_folder_path, exist_ok=True)
                
        # 참조 이미지 크기 조정
        resized_ref_img = cv2.resize(ref_img, (self.input_size, self.input_size))
        
        # 입력 디렉토리의 이미지 목록 가져오기
        img_list = [f for f in os.listdir(src_folder_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
        total_images = len(img_list)
        
        # 각 테스트 이미지에 대해 정렬 수행
        for idx, img_name in enumerate(tqdm(img_list, desc=f"정렬 중 {os.path.basename(src_folder_path)}")):
            # 진행 상황 계산 및 보고
            progress = (idx / total_images) * 100
            if callback:
                callback(progress)
            
            # 출력 파일 경로 확인
            output_path = os.path.join(dst_folder_path, img_name)
            
            # 이미 출력 파일이 존재하면 건너뛰기
            if os.path.exists(output_path):
                print(f"파일이 이미 존재합니다, 건너뜁니다: {output_path}")
                continue
                
            # 테스트 이미지 로드 및 크기 조정
            test_img_path = os.path.join(src_folder_path, img_name)
            test_img = cv2.imread(test_img_path)
            if test_img is None:
                print(f"경고: 이미지를 로드할 수 없습니다: {test_img_path}")
                continue
                
            resized_test_img = cv2.resize(test_img, (self.input_size, self.input_size))
            
            # XFeat 모델 입력 준비
            ort_input = {
                'image1': np.array([resized_ref_img], dtype=np.float32),  # 참조 이미지      
                'image2': np.array([resized_test_img], dtype=np.float32),  # 테스트 이미지                    
            }
            
            # XFeat 모델 실행하여 매칭 키포인트 획득
            out = self.session.run(None, ort_input)  
            mkpts_0 = out[0]  # 참조 이미지의 매칭 키포인트
            mkpts_1 = out[1]  # 테스트 이미지의 매칭 키포인트
            
            if len(mkpts_0) < 4:
                print(f"경고: {img_name}에 대한 매칭점이 충분하지 않습니다 ({len(mkpts_0)} 발견). 정렬을 건너뜁니다.")
                continue
                
            # 시각화 저장 (옵션)
            if save_visualizations:
                vis_path = os.path.join(vis_folder_path, f"vis_{img_name}")
                # 시각화 파일이 이미 존재하면 건너뛰기
                if not os.path.exists(vis_path):
                    canvas = self.warp_corners_and_draw_matches(mkpts_0, mkpts_1, resized_ref_img, resized_test_img)
                    cv2.imwrite(vis_path, canvas)
            
            # 테스트 이미지에서 참조 이미지로 Homography 계산
            homography, mask = cv2.findHomography(mkpts_1, mkpts_0, cv2.USAC_MAGSAC, 3.5, maxIters=1_000, confidence=0.999)
            
            # Homography를 사용하여 테스트 이미지 정렬
            aligned_img = cv2.warpPerspective(resized_test_img, homography, (resized_test_img.shape[1], resized_test_img.shape[0])) 
            
            # 정렬된 이미지 저장
            cv2.imwrite(output_path, aligned_img)
        
        # 완료 후 최종 진행 상황 보고
        if callback:
            callback(100)
            
        return dst_folder_path
    
    def test_time(self, ref_img_path, src_folder_path, num_runs=1):
        """
        CPU와 GPU 모드에서의 처리 시간을 비교
        
        매개변수:
            ref_img_path: 참조 이미지 파일 경로
            src_folder_path: 정렬할 이미지가 있는 소스 폴더 경로
            num_runs: 신뢰성을 위한 실행 횟수
            
        반환값:
            CPU 및 GPU 평균 처리 시간이 포함된 사전
        """
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        results = {}
        
        for provider in providers:
            try:
                # 지정된 공급자로 모델 로드 시도
                session = self._load_model(provider)
                
                # 원래 세션 백업
                original_session = self.session
                self.session = session
                
                times = []
                for i in tqdm(range(num_runs), desc=f"실행 중 ({provider})"):
                    start_time = time.time()
                    
                    # 참조 이미지 로드
                    ref_img = cv2.imread(ref_img_path)
                    if ref_img is None:
                        raise ValueError(f"참조 이미지를 로드할 수 없습니다: {ref_img_path}")
                    
                    # 참조 이미지 크기 조정
                    resized_ref_img = cv2.resize(ref_img, (self.input_size, self.input_size))
                    
                    # 입력 디렉토리의 이미지 목록 가져오기
                    img_list = [f for f in os.listdir(src_folder_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
                    
                    # 각 테스트 이미지에 대해 정렬 수행
                    for img_name in tqdm(img_list, desc=f"처리 중 ({provider})", leave=False):
                        # 테스트 이미지 로드 및 크기 조정
                        test_img_path = os.path.join(src_folder_path, img_name)
                        test_img = cv2.imread(test_img_path)
                        if test_img is None:
                            continue
                            
                        resized_test_img = cv2.resize(test_img, (self.input_size, self.input_size))
                        
                        # XFeat 모델 입력 준비
                        ort_input = {
                            'image1': np.array([resized_ref_img], dtype=np.float32),  
                            'image2': np.array([resized_test_img], dtype=np.float32),                   
                        }
                        
                        # XFeat 모델 실행하여 매칭 키포인트 획득
                        out = self.session.run(None, ort_input)  
                        mkpts_0 = out[0]  # 참조 이미지의 매칭 키포인트
                        mkpts_1 = out[1]  # 테스트 이미지의 매칭 키포인트
                        
                        if len(mkpts_0) < 4:
                            continue
                            
                        # 테스트 이미지에서 참조 이미지로 Homography 계산
                        homography, mask = cv2.findHomography(mkpts_1, mkpts_0, cv2.USAC_MAGSAC, 3.5, maxIters=1_000, confidence=0.999)
                        
                        # Homography를 사용하여 테스트 이미지 정렬
                        aligned_img = cv2.warpPerspective(resized_test_img, homography, (resized_test_img.shape[1], resized_test_img.shape[0]))
                        
                    elapsed_time = time.time() - start_time
                    times.append(elapsed_time)
                
                # 원래 세션 복원
                self.session = original_session
                
                # 평균 시간 계산
                avg_time = sum(times) / len(times)
                results[provider] = avg_time
                print(f"{provider} 평균 처리 시간: {avg_time:.4f}초 ({num_runs}회 실행)")
                
            except Exception as e:
                print(f"{provider} 실행 중 오류 발생: {str(e)}")
                results[provider] = None
        
        # CPU와 GPU 속도 차이 계산 (GPU가 사용 가능한 경우)
        if "CUDAExecutionProvider" in results and results["CUDAExecutionProvider"] is not None and results["CPUExecutionProvider"] is not None:
            speedup = results["CPUExecutionProvider"] / results["CUDAExecutionProvider"]
            print(f"GPU 속도 향상: CPU 대비 {speedup:.2f}배 빠름")
        
        return results

def find_first_image_in_folder(folder_path):
    """
    폴더에서 파일명 순으로 첫 번째 이미지 파일 찾기
    
    매개변수:
        folder_path: 이미지를 검색할 폴더 경로
        
    반환값:
        첫 번째 이미지 파일의 전체 경로
    """
    # 이미지 파일 목록 가져오기
    img_list = [f for f in os.listdir(folder_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    
    if not img_list:
        raise ValueError(f"{folder_path}에서 이미지 파일을 찾을 수 없습니다.")
    
    # 파일명 순으로 정렬
    img_list.sort()
    
    # 첫 번째 이미지의 전체 경로 반환
    return os.path.join(folder_path, img_list[0])

def report_progress(progress):
    """
    진행 상황을 Electron에 보고하는 함수
    
    매개변수:
        progress: 0에서 100 사이의 진행률 
    """
    # JSON 형식으로 진행 상황 보고
    progress_data = {
        "progress": round(progress, 2)
    }
    print(json.dumps(progress_data), flush=True)

def main():
    # 명령줄 인수 파싱
    parser = argparse.ArgumentParser(description='XFeat 이미지 정렬 도구')
    parser.add_argument('line_a_path', help='첫 번째 이미지 라인 폴더 경로')
    parser.add_argument('line_b_path', help='두 번째 이미지 라인 폴더 경로')
    parser.add_argument('--root', help='root 폴더')
    parser.add_argument('--model_path', default="models/xfeat_model_512_5000.onnx", help='ONNX 모델 파일 경로')
    parser.add_argument('--save_vis', action='store_true', help='시각화 결과 저장 여부')
    
    args = parser.parse_args()
    
    # line_a_path에서 첫 번째 이미지를 참조 이미지로 사용
    try:
        ref_img_path = find_first_image_in_folder(args.line_a_path)
        print(f"참조 이미지로 {ref_img_path}를 사용합니다.")
    except Exception as e:
        print(f"오류: {str(e)}")
        sys.exit(1)
    
    # XFeatAligner 인스턴스 생성
    aligner = XFeatAligner(model_path=args.root + '/' + args.model_path)
    
    # 총 이미지 수 계산 (line_a + line_b)
    line_a_images = [f for f in os.listdir(args.line_a_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    line_b_images = [f for f in os.listdir(args.line_b_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    total_images = len(line_a_images) + len(line_b_images)
    
    # 진행 상황 콜백 함수 - line_a는 전체의 0-50%, line_b는 50-100%
    def progress_callback_line_a(progress):
        # line_a의 진행률(0-100%)을 전체 진행률의 0-50%로 변환
        overall_progress = progress / 2
        report_progress(overall_progress)
    
    def progress_callback_line_b(progress):
        # line_b의 진행률(0-100%)을 전체 진행률의 50-100%로 변환
        overall_progress = 50 + (progress / 2)
        report_progress(overall_progress)
    
    # line_a_path 정렬
    print(f"line_a_path 폴더 {args.line_a_path} 정렬 중...")
    aligner.align(ref_img_path, args.line_a_path, save_visualizations=args.save_vis, 
                  callback=progress_callback_line_a)
    
    # line_b_path 정렬
    print(f"line_b_path 폴더 {args.line_b_path} 정렬 중...")
    aligner.align(ref_img_path, args.line_b_path, save_visualizations=args.save_vis,
                  callback=progress_callback_line_b)
    
    print("모든 폴더 정렬 완료")
    
    # 완료 메시지 전송
    completion_data = {
        "progress": 100,
        "status": "complete"
    }
    print(json.dumps(completion_data), flush=True)

if __name__ == "__main__":
    main()