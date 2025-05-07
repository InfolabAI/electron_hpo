import numpy as np
import cv2
from typing import Union, Tuple
import random

class ColorJitter:
    """
    A numpy implementation of torchvision.transforms.ColorJitter.
    
    Randomly changes the brightness, contrast, saturation and hue of an image.
    Input image should be a numpy array with values in range 0-255 in RGB format.
    """
    
    def __init__(
        self,
        brightness: Union[float, Tuple[float, float]] = 0,
        contrast: Union[float, Tuple[float, float]] = 0,
        saturation: Union[float, Tuple[float, float]] = 0,
        hue: Union[float, Tuple[float, float]] = 0
    ):
        """
        Args:
            brightness (float or tuple): How much to jitter brightness. brightness_factor is chosen 
                uniformly from [max(0, 1 - brightness), 1 + brightness] or the given [min, max].
                Should be non-negative numbers.
            contrast (float or tuple): How much to jitter contrast. contrast_factor is chosen
                uniformly from [max(0, 1 - contrast), 1 + contrast] or the given [min, max].
                Should be non-negative numbers.
            saturation (float or tuple): How much to jitter saturation. saturation_factor is chosen
                uniformly from [max(0, 1 - saturation), 1 + saturation] or the given [min, max].
                Should be non-negative numbers.
            hue (float or tuple): How much to jitter hue. hue_factor is chosen uniformly from
                [-hue, hue] or the given [min, max]. Should have 0 <= hue <= 0.5 or 
                -0.5 <= min <= max <= 0.5.
        """
        self.brightness = self._check_input(brightness, 'brightness')
        self.contrast = self._check_input(contrast, 'contrast')
        self.saturation = self._check_input(saturation, 'saturation')
        self.hue = self._check_input(hue, 'hue', center=0, bound=(-0.5, 0.5), is_hue=True)
    
    def _check_input(self, value, name, center=1, bound=(0, float('inf')), is_hue=False):
        """
        Check if the input value is valid and convert to a tuple range if necessary.
        
        Args:
            value: Input value (float or tuple)
            name: Parameter name for error messages
            center: Center value for the range
            bound: Acceptable bounds for the values
            is_hue: Whether this is the hue parameter, which has special handling
            
        Returns:
            Tuple of (min, max) values for the transformation
        """
        if isinstance(value, (list, tuple)):
            if len(value) != 2:
                raise ValueError(f"{name} should be a float or a tuple of two floats")
            
            if not bound[0] <= value[0] <= value[1] <= bound[1]:
                raise ValueError(f"{name} values should be between {bound[0]} and {bound[1]}, got {value}")
                
            return value
        
        if not isinstance(value, (int, float)):
            raise TypeError(f"{name} should be a float or a tuple of two floats, got {type(value)}")
            
        if value < 0:
            raise ValueError(f"{name} should be non-negative, got {value}")
            
        if is_hue:
            if not 0 <= value <= 0.5:
                raise ValueError(f"{name} should be between 0 and 0.5, got {value}")
            return (-value, value)
        
        # For brightness, contrast, saturation:
        # If value is 0, return (center, center) which means no change
        if value == 0:
            return (center, center)
        
        # Generate range according to torchvision docs:
        # Factor is chosen uniformly from [max(0, 1 - param), 1 + param]
        min_val = max(0, center - value)
        max_val = center + value
        
        return (min_val, max_val)
    
    def _get_params(self):
        """
        Get random parameters for the transforms to apply.
        
        Returns:
            Dictionary of transformation parameters
        """
        transforms = []
        
        # Get all possible transforms
        if self.brightness[0] != self.brightness[1]:
            transforms.append('brightness')
        if self.contrast[0] != self.contrast[1]:
            transforms.append('contrast')
        if self.saturation[0] != self.saturation[1]:
            transforms.append('saturation')
        if self.hue[0] != self.hue[1]:
            transforms.append('hue')
        
        # Randomly shuffle the order of transforms
        random.shuffle(transforms)
        
        params = {'transforms': transforms}
        
        # Generate random factors for each transform
        if 'brightness' in transforms:
            params['brightness_factor'] = random.uniform(self.brightness[0], self.brightness[1])
        
        if 'contrast' in transforms:
            params['contrast_factor'] = random.uniform(self.contrast[0], self.contrast[1])
        
        if 'saturation' in transforms:
            params['saturation_factor'] = random.uniform(self.saturation[0], self.saturation[1])
        
        if 'hue' in transforms:
            params['hue_factor'] = random.uniform(self.hue[0], self.hue[1])
            
        return params
    
    def _adjust_brightness(self, img, brightness_factor):
        """
        Adjust brightness of an image.
        
        Args:
            img: Numpy array image (0-255 range) in RGB format
            brightness_factor: Factor to adjust brightness
            
        Returns:
            Brightness adjusted image
        """
        return np.clip(img * brightness_factor, 0, 255).astype(np.uint8)
    
    def _adjust_contrast(self, img, contrast_factor):
        """
        Adjust contrast of an image.
        
        Args:
            img: Numpy array image (0-255 range) in RGB format
            contrast_factor: Factor to adjust contrast
            
        Returns:
            Contrast adjusted image
        """
        # Calculate the mean across spatial dimensions and channels
        mean = np.mean(img, axis=(0, 1), keepdims=True)
        
        # Apply contrast adjustment and clip to valid range
        return np.clip((img - mean) * contrast_factor + mean, 0, 255).astype(np.uint8)
    
    def _adjust_saturation(self, img, saturation_factor):
        """
        Adjust saturation of an image.
        
        Args:
            img: Numpy array image (0-255 range) in RGB format
            saturation_factor: Factor to adjust saturation
            
        Returns:
            Saturation adjusted image
        """
        # Convert to HSV
        hsv_img = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
        
        # Adjust S channel
        hsv_img[:, :, 1] = np.clip(hsv_img[:, :, 1] * saturation_factor, 0, 255).astype(np.uint8)
        
        # Convert back to RGB
        return cv2.cvtColor(hsv_img, cv2.COLOR_HSV2RGB)
    
    def _adjust_hue(self, img, hue_factor):
        """
        Adjust hue of an image.
        
        Args:
            img: Numpy array image (0-255 range) in RGB format
            hue_factor: Factor to adjust hue
            
        Returns:
            Hue adjusted image
        """
        # Convert to HSV
        hsv_img = cv2.cvtColor(img, cv2.COLOR_RGB2HSV).astype(np.int16)
        
        # Adjust H channel (hue)
        # OpenCV uses H values in range [0, 180], so scale the factor
        hsv_img[:, :, 0] = (hsv_img[:, :, 0] + int(hue_factor * 180)) % 180
        
        # Convert back to uint8 and then to RGB
        hsv_img = hsv_img.astype(np.uint8)
        return cv2.cvtColor(hsv_img, cv2.COLOR_HSV2RGB)

    def apply(self, img, params=None):
        """
        Apply color jitter transformation to a single image.
        
        Args:
            img: Numpy array image (0-255 range) in RGB format
            params: Optional transformation parameters. If None, random params are generated.
            
        Returns:
            Transformed image
        """
        if params is None:
            params = self._get_params()
        
        result = img.copy()
        
        for t in params['transforms']:
            if t == 'brightness':
                result = self._adjust_brightness(result, params['brightness_factor'])
            elif t == 'contrast':
                result = self._adjust_contrast(result, params['contrast_factor'])
            elif t == 'saturation':
                result = self._adjust_saturation(result, params['saturation_factor'])
            elif t == 'hue':
                result = self._adjust_hue(result, params['hue_factor'])
        
        return result
    
    def apply_batch(self, imgs, same_across_batch=True):
        """
        Apply color jitter transformation to a batch of images.
        
        Args:
            imgs: Batch of numpy array images (B, H, W, C) with values in range 0-255 in RGB format
            same_across_batch: Whether to apply the same transformation to all images in the batch
            
        Returns:
            Transformed batch of images
        """
        batch_size = imgs.shape[0]
        
        if same_across_batch:
            # Generate one set of params for consistency across the batch
            params = self._get_params()
            
            # Process the batch more efficiently for brightness and contrast
            # which can be vectorized
            curr_batch = imgs.copy()
            
            for t in params['transforms']:
                if t == 'brightness':
                    # Vectorized brightness adjustment
                    curr_batch = np.clip(curr_batch * params['brightness_factor'], 0, 255).astype(np.uint8)
                elif t == 'contrast':
                    # Vectorized contrast adjustment (per image)
                    mean = np.mean(curr_batch, axis=(1, 2), keepdims=True)
                    curr_batch = np.clip((curr_batch - mean) * params['contrast_factor'] + mean, 0, 255).astype(np.uint8)
                elif t == 'saturation' or t == 'hue':
                    # For saturation and hue, we need to process each image individually
                    # since cv2 color conversions don't work directly on batches
                    for i in range(batch_size):
                        if t == 'saturation':
                            curr_batch[i] = self._adjust_saturation(curr_batch[i], params['saturation_factor'])
                        elif t == 'hue':
                            curr_batch[i] = self._adjust_hue(curr_batch[i], params['hue_factor'])
            
            return curr_batch
        else:
            # Apply different transformations to each image
            result = np.zeros_like(imgs)
            for i in range(batch_size):
                result[i] = self.apply(imgs[i])
            return result
    
    def __call__(self, img):
        """
        Apply color jitter transformation to an image or batch of images.
        
        Args:
            img: Numpy array image (H, W, C) or batch of images (B, H, W, C) with values in range 0-255 in RGB format
            
        Returns:
            Transformed image(s)
        """
        # Check if the input is a batch
        is_batch = len(img.shape) == 4
        
        if is_batch:
            # By default, apply the same transformation across the batch for consistency
            return self.apply_batch(img, same_across_batch=True)
        else:
            return self.apply(img)


# Example usage:
if __name__ == "__main__":
    # Create a ColorJitter instance
    color_jitter = ColorJitter(
        brightness=0.4,
        contrast=0.4,
        saturation=0.4,
        hue=0.1
    )
    
    # Load an example image (using OpenCV)
    # Note: OpenCV loads images in BGR format, so convert to RGB
    # img = cv2.cvtColor(cv2.imread('example.jpg'), cv2.COLOR_BGR2RGB)
    
    # Apply color jitter transformation
    # jittered_img = color_jitter(img)
    
    # For batch processing:
    # batch_imgs = np.stack([img1, img2, img3])
    # jittered_batch = color_jitter(batch_imgs)