#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Image Viewer Pro - Backend Server
FastAPI server for image processing with EXR support
"""

import sys
import os

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.detach())
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.detach())
import base64
import asyncio
import hashlib
import time
from pathlib import Path
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import mimetypes
import multiprocessing

# Add current directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import Response
    from pydantic import BaseModel
    import uvicorn
    from PIL import Image
    import numpy as np
    import cv2
except ImportError as e:
    print(f"Missing required package: {e}")
    print("Please install requirements: pip install fastapi uvicorn pillow opencv-python numpy")
    sys.exit(1)

# Initialize FastAPI app
app = FastAPI(title="Image Viewer Pro Backend", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supported image extensions
SUPPORTED_EXTENSIONS = {
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif',
    '.webp', '.exr', '.hdr', '.pic', '.psd'
}

# Performance configurations
MAX_WORKERS = min(32, (os.cpu_count() or 1) + 4)  # Otimizado para I/O bound

# Setup cache directory
try:
    CACHE_DIR = Path.home() / '.image_viewer_cache'
    CACHE_DIR.mkdir(exist_ok=True)
    cache_status = "enabled"
except Exception as e:
    # Fallback to temp directory
    import tempfile
    CACHE_DIR = Path(tempfile.gettempdir()) / 'image_viewer_cache'
    CACHE_DIR.mkdir(exist_ok=True)
    cache_status = f"fallback to temp ({e})"

# Thread pool para processamento paralelo
thread_pool = ThreadPoolExecutor(max_workers=MAX_WORKERS)

print(f"Performance config: {MAX_WORKERS} workers, Cache: {cache_status}")
print(f"Cache directory: {CACHE_DIR}")

# Request models
class ScanFolderRequest(BaseModel):
    folder_path: str
    recursive: bool = False

class ThumbnailRequest(BaseModel):
    image_path: str
    size: int = 200

class BatchThumbnailRequest(BaseModel):
    image_paths: List[str]
    size: int = 200

class ImageInfoRequest(BaseModel):
    image_path: str

class FullImageRequest(BaseModel):
    image_path: str
    max_size: int = 0  # 0 = sem limite, valor padrão para resolução completa

# Response models
class ImageFile(BaseModel):
    path: str
    name: str
    size: int
    extension: str
    is_supported: bool

class ScanResult(BaseModel):
    success: bool
    images: List[ImageFile]
    total_count: int
    error: Optional[str] = None

class ThumbnailResult(BaseModel):
    success: bool
    data_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    error: Optional[str] = None

class BatchThumbnailResult(BaseModel):
    success: bool
    thumbnails: Dict[str, ThumbnailResult]
    total_processed: int
    error: Optional[str] = None

class ImageInfoResult(BaseModel):
    success: bool
    width: Optional[int] = None
    height: Optional[int] = None
    channels: Optional[int] = None
    format: Optional[str] = None
    size_bytes: Optional[int] = None
    error: Optional[str] = None

# Utility functions
def is_image_file(file_path: Path) -> bool:
    """Check if file is a supported image format"""
    return file_path.suffix.lower() in SUPPORTED_EXTENSIONS

def get_file_info(file_path: Path) -> ImageFile:
    """Get basic file information"""
    try:
        stat = file_path.stat()
        return ImageFile(
            path=str(file_path),
            name=file_path.name,
            size=stat.st_size,
            extension=file_path.suffix.lower(),
            is_supported=is_image_file(file_path)
        )
    except Exception as e:
        return ImageFile(
            path=str(file_path),
            name=file_path.name,
            size=0,
            extension=file_path.suffix.lower(),
            is_supported=False
        )

def load_image_opencv(image_path: str) -> Optional[np.ndarray]:
    """Load image using OpenCV with EXR support and GPU optimization"""
    try:
        # Set OpenEXR environment variable
        os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
        
        # Load image
        img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
        
        if img is None:
            return None
            
        # Convert BGR to RGB for regular images
        if len(img.shape) == 3 and img.shape[2] == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        elif len(img.shape) == 3 and img.shape[2] == 4:
            img = cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)
            
        return img
    except Exception as e:
        print(f"OpenCV load failed for {image_path}: {e}")
        return None

def create_thumbnail_optimized(img_array: np.ndarray, size: int) -> Image.Image:
    """Create thumbnail with GPU acceleration if available"""
    try:
        # Process HDR images
        if img_array.dtype in [np.float32, np.float64]:
            img_array = process_hdr_image(img_array)
        
        # Use OpenCV for resizing (potentially GPU accelerated)
        height, width = img_array.shape[:2]
        
        # Calculate new dimensions maintaining aspect ratio
        if width > height:
            new_width = size
            new_height = int((height * size) / width)
        else:
            new_height = size
            new_width = int((width * size) / height)
        
        # Resize using OpenCV (faster than PIL)
        if len(img_array.shape) == 3:
            resized = cv2.resize(img_array, (new_width, new_height), interpolation=cv2.INTER_LANCZOS4)
        else:
            resized = cv2.resize(img_array, (new_width, new_height), interpolation=cv2.INTER_LANCZOS4)
        
        # Convert to PIL Image
        if len(resized.shape) == 2:  # Grayscale
            pil_img = Image.fromarray(resized, mode='L')
        elif resized.shape[2] == 3:  # RGB
            pil_img = Image.fromarray(resized, mode='RGB')
        elif resized.shape[2] == 4:  # RGBA
            pil_img = Image.fromarray(resized, mode='RGBA')
        else:
            raise ValueError(f"Unsupported image shape: {resized.shape}")
        
        # Convert RGBA to RGB for JPEG compatibility
        if pil_img.mode == 'RGBA':
            background = Image.new('RGB', pil_img.size, (255, 255, 255))
            background.paste(pil_img, mask=pil_img.split()[3])
            pil_img = background
        
        return pil_img
        
    except Exception as e:
        print(f"Optimized thumbnail creation failed: {e}")
        # Fallback to original method
        return create_thumbnail(img_array, size)

def load_image_pil(image_path: str) -> Optional[Image.Image]:
    """Load image using PIL as fallback"""
    try:
        return Image.open(image_path)
    except Exception as e:
        print(f"PIL load failed for {image_path}: {e}")
        return None

def process_hdr_image(img_array: np.ndarray, gamma: float = 2.2) -> np.ndarray:
    """Process HDR/EXR image with tone mapping"""
    if img_array.dtype == np.float32 or img_array.dtype == np.float64:
        # Clip negative values
        img_array = np.maximum(img_array, 0)
        
        # Simple tone mapping with gamma correction
        img_array = np.power(img_array, 1.0 / gamma)
        
        # Normalize to 0-1 range
        img_max = np.max(img_array)
        if img_max > 0:
            img_array = img_array / img_max
        
        # Convert to 8-bit
        img_array = (img_array * 255).astype(np.uint8)
    
    return img_array

def create_thumbnail(img_array: np.ndarray, size: int) -> Image.Image:
    """Create thumbnail from numpy array"""
    # Process HDR images
    if img_array.dtype in [np.float32, np.float64]:
        img_array = process_hdr_image(img_array)
    
    # Convert to PIL Image
    if len(img_array.shape) == 2:  # Grayscale
        pil_img = Image.fromarray(img_array, mode='L')
    elif img_array.shape[2] == 3:  # RGB
        pil_img = Image.fromarray(img_array, mode='RGB')
    elif img_array.shape[2] == 4:  # RGBA
        pil_img = Image.fromarray(img_array, mode='RGBA')
    else:
        raise ValueError(f"Unsupported image shape: {img_array.shape}")
    
    # Create thumbnail
    pil_img.thumbnail((size, size), Image.Resampling.LANCZOS)
    
    # Convert RGBA to RGB for JPEG compatibility
    if pil_img.mode == 'RGBA':
        background = Image.new('RGB', pil_img.size, (255, 255, 255))
        background.paste(pil_img, mask=pil_img.split()[3])
        pil_img = background
    
    return pil_img

def get_cache_key(image_path: str, size: int) -> str:
    """Generate cache key for thumbnail"""
    # Use file path + modification time + size for cache key
    try:
        mtime = os.path.getmtime(image_path)
        cache_string = f"{image_path}_{size}_{mtime}"
        return hashlib.md5(cache_string.encode()).hexdigest()
    except:
        return hashlib.md5(f"{image_path}_{size}".encode()).hexdigest()

def get_cached_thumbnail(cache_key: str) -> Optional[bytes]:
    """Get cached thumbnail if exists"""
    cache_file = CACHE_DIR / f"{cache_key}.jpg"
    if cache_file.exists():
        try:
            return cache_file.read_bytes()
        except:
            return None
    return None

def save_cached_thumbnail(cache_key: str, image_bytes: bytes):
    """Save thumbnail to cache"""
    try:
        cache_file = CACHE_DIR / f"{cache_key}.jpg"
        cache_file.write_bytes(image_bytes)
    except Exception as e:
        print(f"Cache save failed: {e}")

def process_image_worker(image_path: str, size: int) -> Dict:
    """Worker function for parallel image processing"""
    try:
        # Check cache first
        cache_key = get_cache_key(image_path, size)
        cached_bytes = get_cached_thumbnail(cache_key)
        
        if cached_bytes:
            return {
                'success': True,
                'image_bytes': cached_bytes,
                'from_cache': True,
                'path': image_path
            }
        
        # Process image
        img_array = load_image_opencv(image_path)
        
        if img_array is not None:
            thumbnail = create_thumbnail_optimized(img_array, size)
            img_bytes = image_to_bytes(thumbnail, quality=85)
            
            # Save to cache
            save_cached_thumbnail(cache_key, img_bytes)
            
            return {
                'success': True,
                'image_bytes': img_bytes,
                'width': thumbnail.width,
                'height': thumbnail.height,
                'from_cache': False,
                'path': image_path
            }
        
        # Fallback to PIL
        pil_img = load_image_pil(image_path)
        if pil_img is not None:
            pil_img.thumbnail((size, size), Image.Resampling.LANCZOS)
            
            if pil_img.mode == 'RGBA':
                background = Image.new('RGB', pil_img.size, (255, 255, 255))
                background.paste(pil_img, mask=pil_img.split()[3])
                pil_img = background
            
            img_bytes = image_to_bytes(pil_img, quality=85)
            save_cached_thumbnail(cache_key, img_bytes)
            
            return {
                'success': True,
                'image_bytes': img_bytes,
                'width': pil_img.width,
                'height': pil_img.height,
                'from_cache': False,
                'path': image_path
            }
        
        return {'success': False, 'error': 'Failed to load image', 'path': image_path}
        
    except Exception as e:
        return {'success': False, 'error': str(e), 'path': image_path}

def image_to_bytes(pil_img: Image.Image, format: str = 'JPEG', quality: int = 90) -> bytes:
    """Convert PIL Image to bytes"""
    import io
    
    buffer = io.BytesIO()
    pil_img.save(buffer, format=format, quality=quality)
    return buffer.getvalue()

def image_to_data_url(pil_img: Image.Image, format: str = 'JPEG', quality: int = 90) -> str:
    """Convert PIL Image to data URL (legacy support)"""
    import io
    
    buffer = io.BytesIO()
    pil_img.save(buffer, format=format, quality=quality)
    img_data = buffer.getvalue()
    
    mime_type = f'image/{format.lower()}'
    b64_data = base64.b64encode(img_data).decode('utf-8')
    
    return f'data:{mime_type};base64,{b64_data}'

# API Endpoints
@app.get("/")
async def root():
    return {"message": "Image Viewer Pro Backend", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "opencv_version": cv2.__version__}

@app.get("/performance-stats")
async def get_performance_stats():
    """Get performance statistics"""
    try:
        import psutil
        memory_usage = psutil.Process().memory_info().rss / (1024 * 1024)
    except ImportError:
        memory_usage = 0
    
    # Cache statistics
    cache_files = list(CACHE_DIR.glob("*.jpg"))
    cache_size_mb = sum(f.stat().st_size for f in cache_files) / (1024 * 1024)
    
    return {
        "cpu_cores": os.cpu_count(),
        "thread_workers": MAX_WORKERS,
        "memory_usage_mb": round(memory_usage, 2),
        "cache_files": len(cache_files),
        "cache_size_mb": round(cache_size_mb, 2),
        "opencv_version": cv2.__version__,
        "gpu_available": cv2.cuda.getCudaEnabledDeviceCount() > 0 if hasattr(cv2, 'cuda') else False
    }

@app.post("/scan-folder", response_model=ScanResult)
async def scan_folder(request: ScanFolderRequest):
    """Scan folder for image files"""
    try:
        folder_path = Path(request.folder_path)
        
        if not folder_path.exists():
            raise HTTPException(status_code=404, detail="Folder not found")
        
        if not folder_path.is_dir():
            raise HTTPException(status_code=400, detail="Path is not a directory")
        
        images = []
        
        if request.recursive:
            # Recursive scan
            for file_path in folder_path.rglob('*'):
                if file_path.is_file() and is_image_file(file_path):
                    images.append(get_file_info(file_path))
        else:
            # Non-recursive scan
            for file_path in folder_path.iterdir():
                if file_path.is_file() and is_image_file(file_path):
                    images.append(get_file_info(file_path))
        
        # Sort by name
        images.sort(key=lambda x: x.name.lower())
        
        return ScanResult(
            success=True,
            images=images,
            total_count=len(images)
        )
        
    except Exception as e:
        return ScanResult(
            success=False,
            images=[],
            total_count=0,
            error=str(e)
        )

@app.post("/thumbnail-binary")
async def generate_thumbnail_binary(request: ThumbnailRequest):
    """Generate thumbnail for image and return binary data (optimized)"""
    try:
        image_path = request.image_path
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail="Image file not found")
        
        # Process in thread pool for better performance
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            thread_pool, 
            process_image_worker, 
            image_path, 
            request.size
        )
        
        if result['success']:
            headers = {
                "X-From-Cache": str(result.get('from_cache', False))
            }
            
            if 'width' in result:
                headers["X-Image-Width"] = str(result['width'])
            if 'height' in result:
                headers["X-Image-Height"] = str(result['height'])
            
            return Response(
                content=result['image_bytes'],
                media_type="image/jpeg",
                headers=headers
            )
        else:
            raise HTTPException(status_code=500, detail=result.get('error', 'Failed to process image'))
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/thumbnail", response_model=ThumbnailResult)
async def generate_thumbnail(request: ThumbnailRequest):
    """Generate thumbnail for image (legacy Base64 support)"""
    try:
        image_path = request.image_path
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail="Image file not found")
        
        # Try OpenCV first (better for EXR)
        img_array = load_image_opencv(image_path)
        
        if img_array is not None:
            # Create thumbnail from numpy array
            thumbnail = create_thumbnail(img_array, request.size)
            data_url = image_to_data_url(thumbnail)
            
            return ThumbnailResult(
                success=True,
                data_url=data_url,
                width=thumbnail.width,
                height=thumbnail.height
            )
        
        # Fallback to PIL
        pil_img = load_image_pil(image_path)
        if pil_img is not None:
            pil_img.thumbnail((request.size, request.size), Image.Resampling.LANCZOS)
            
            # Convert RGBA to RGB if needed
            if pil_img.mode == 'RGBA':
                background = Image.new('RGB', pil_img.size, (255, 255, 255))
                background.paste(pil_img, mask=pil_img.split()[3])
                pil_img = background
            
            data_url = image_to_data_url(pil_img)
            
            return ThumbnailResult(
                success=True,
                data_url=data_url,
                width=pil_img.width,
                height=pil_img.height
            )
        
        raise Exception("Failed to load image with both OpenCV and PIL")
        
    except Exception as e:
        return ThumbnailResult(
            success=False,
            error=str(e)
        )

@app.post("/image-info", response_model=ImageInfoResult)
async def get_image_info(request: ImageInfoRequest):
    """Get detailed image information"""
    try:
        image_path = request.image_path
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail="Image file not found")
        
        # Get file size
        file_size = os.path.getsize(image_path)
        
        # Try OpenCV first
        img_array = load_image_opencv(image_path)
        
        if img_array is not None:
            height, width = img_array.shape[:2]
            channels = img_array.shape[2] if len(img_array.shape) > 2 else 1
            
            # Determine format
            ext = Path(image_path).suffix.lower()
            format_name = ext[1:].upper() if ext else "UNKNOWN"
            
            return ImageInfoResult(
                success=True,
                width=width,
                height=height,
                channels=channels,
                format=format_name,
                size_bytes=file_size
            )
        
        # Fallback to PIL
        pil_img = load_image_pil(image_path)
        if pil_img is not None:
            width, height = pil_img.size
            channels = len(pil_img.getbands())
            
            return ImageInfoResult(
                success=True,
                width=width,
                height=height,
                channels=channels,
                format=pil_img.format or "UNKNOWN",
                size_bytes=file_size
            )
        
        raise Exception("Failed to get image info")
        
    except Exception as e:
        return ImageInfoResult(
            success=False,
            error=str(e)
        )



@app.post("/batch-thumbnails-parallel")
async def generate_batch_thumbnails_parallel(request: BatchThumbnailRequest):
    """Generate multiple thumbnails in parallel using all CPU cores"""
    try:
        start_time = time.time()
        
        # Filter existing files
        valid_paths = [path for path in request.image_paths if os.path.exists(path)]
        
        if not valid_paths:
            return {"success": False, "error": "No valid image files found"}
        
        # Process all images in parallel
        loop = asyncio.get_event_loop()
        
        # Create tasks for parallel processing
        tasks = [
            loop.run_in_executor(thread_pool, process_image_worker, path, request.size)
            for path in valid_paths
        ]
        
        # Wait for all tasks to complete
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Prepare response
        thumbnails_data = []
        cache_hits = 0
        processed_count = 0
        
        for result in results:
            if isinstance(result, Exception):
                continue
                
            if result['success']:
                processed_count += 1
                if result.get('from_cache', False):
                    cache_hits += 1
                    
                thumbnails_data.append({
                    'path': result['path'],
                    'success': True,
                    'image_bytes': result['image_bytes'],
                    'width': result.get('width', 0),
                    'height': result.get('height', 0),
                    'from_cache': result.get('from_cache', False)
                })
            else:
                thumbnails_data.append({
                    'path': result['path'],
                    'success': False,
                    'error': result.get('error', 'Unknown error')
                })
        
        processing_time = time.time() - start_time
        
        return {
            "success": True,
            "thumbnails": thumbnails_data,
            "total_processed": processed_count,
            "cache_hits": cache_hits,
            "processing_time": round(processing_time, 3),
            "images_per_second": round(processed_count / processing_time, 1) if processing_time > 0 else 0
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/batch-thumbnails", response_model=BatchThumbnailResult)
async def generate_batch_thumbnails(request: BatchThumbnailRequest):
    """Generate multiple thumbnails in batch for better performance (legacy Base64)"""
    try:
        thumbnails = {}
        processed_count = 0
        
        for image_path in request.image_paths:
            try:
                if not os.path.exists(image_path):
                    thumbnails[image_path] = ThumbnailResult(
                        success=False,
                        error="Image file not found"
                    )
                    continue
                
                # Try OpenCV first (better for EXR)
                img_array = load_image_opencv(image_path)
                
                if img_array is not None:
                    # Create thumbnail from numpy array
                    thumbnail = create_thumbnail(img_array, request.size)
                    data_url = image_to_data_url(thumbnail, quality=85)  # Slightly lower quality for speed
                    
                    thumbnails[image_path] = ThumbnailResult(
                        success=True,
                        data_url=data_url,
                        width=thumbnail.width,
                        height=thumbnail.height
                    )
                    processed_count += 1
                    continue
                
                # Fallback to PIL
                pil_img = load_image_pil(image_path)
                if pil_img is not None:
                    pil_img.thumbnail((request.size, request.size), Image.Resampling.LANCZOS)
                    
                    # Convert RGBA to RGB if needed
                    if pil_img.mode == 'RGBA':
                        background = Image.new('RGB', pil_img.size, (255, 255, 255))
                        background.paste(pil_img, mask=pil_img.split()[3])
                        pil_img = background
                    
                    data_url = image_to_data_url(pil_img, quality=85)
                    
                    thumbnails[image_path] = ThumbnailResult(
                        success=True,
                        data_url=data_url,
                        width=pil_img.width,
                        height=pil_img.height
                    )
                    processed_count += 1
                else:
                    thumbnails[image_path] = ThumbnailResult(
                        success=False,
                        error="Failed to load image with both OpenCV and PIL"
                    )
                    
            except Exception as e:
                thumbnails[image_path] = ThumbnailResult(
                    success=False,
                    error=str(e)
                )
        
        return BatchThumbnailResult(
            success=True,
            thumbnails=thumbnails,
            total_processed=processed_count
        )
        
    except Exception as e:
        return BatchThumbnailResult(
            success=False,
            thumbnails={},
            total_processed=0,
            error=str(e)
        )

@app.post("/full-image-binary")
async def get_full_image_binary(request: FullImageRequest):
    """Get full resolution image as binary data"""
    try:
        image_path = request.image_path
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail="Image file not found")
        
        # Try OpenCV first
        img_array = load_image_opencv(image_path)
        
        if img_array is not None:
            # Process HDR images
            if img_array.dtype in [np.float32, np.float64]:
                img_array = process_hdr_image(img_array)
            
            # Convert to PIL
            if len(img_array.shape) == 2:
                pil_img = Image.fromarray(img_array, mode='L')
            elif img_array.shape[2] == 3:
                pil_img = Image.fromarray(img_array, mode='RGB')
            elif img_array.shape[2] == 4:
                pil_img = Image.fromarray(img_array, mode='RGBA')
            else:
                raise ValueError(f"Unsupported image shape: {img_array.shape}")
            
            # Resize if too large (max_size = 0 means no limit)
            if request.max_size > 0:
                pil_img.thumbnail((request.max_size, request.max_size), Image.Resampling.LANCZOS)
            
            # Convert RGBA to RGB for JPEG
            if pil_img.mode == 'RGBA':
                background = Image.new('RGB', pil_img.size, (255, 255, 255))
                background.paste(pil_img, mask=pil_img.split()[3])
                pil_img = background
            
            img_bytes = image_to_bytes(pil_img, quality=95)
            
            return Response(
                content=img_bytes,
                media_type="image/jpeg",
                headers={
                    "X-Image-Width": str(pil_img.width),
                    "X-Image-Height": str(pil_img.height)
                }
            )
        
        raise HTTPException(status_code=500, detail="Failed to load full image")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/full-image", response_model=ThumbnailResult)
async def get_full_image(request: FullImageRequest):
    """Get full resolution image (with optional max size limit)"""
    try:
        image_path = request.image_path
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail="Image file not found")
        
        # Try OpenCV first
        img_array = load_image_opencv(image_path)
        
        if img_array is not None:
            # Process HDR images
            if img_array.dtype in [np.float32, np.float64]:
                img_array = process_hdr_image(img_array)
            
            # Convert to PIL
            if len(img_array.shape) == 2:
                pil_img = Image.fromarray(img_array, mode='L')
            elif img_array.shape[2] == 3:
                pil_img = Image.fromarray(img_array, mode='RGB')
            elif img_array.shape[2] == 4:
                pil_img = Image.fromarray(img_array, mode='RGBA')
            else:
                raise ValueError(f"Unsupported image shape: {img_array.shape}")
            
            # Resize if too large (max_size = 0 means no limit)
            if request.max_size > 0:
                pil_img.thumbnail((request.max_size, request.max_size), Image.Resampling.LANCZOS)
            
            # Convert RGBA to RGB for JPEG
            if pil_img.mode == 'RGBA':
                background = Image.new('RGB', pil_img.size, (255, 255, 255))
                background.paste(pil_img, mask=pil_img.split()[3])
                pil_img = background
            
            data_url = image_to_data_url(pil_img, quality=95)
            
            return ThumbnailResult(
                success=True,
                data_url=data_url,
                width=pil_img.width,
                height=pil_img.height
            )
        
        raise Exception("Failed to load full image")
        
    except Exception as e:
        return ThumbnailResult(
            success=False,
            error=str(e)
        )

if __name__ == "__main__":
    try:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
        
        # Calculate optimal configuration
        cpu_count = os.cpu_count() or 1
        
        print(f"Starting Image Viewer Pro Backend on port {port}")
        print(f"System: {cpu_count} CPU cores, {MAX_WORKERS} thread workers")
        print(f"OpenCV version: {cv2.__version__}")
        print(f"Cache directory: {CACHE_DIR}")
        print("Server started")  # This triggers the main process
        
        # Use single worker with high thread count for better thread pool sharing
        uvicorn.run(
            app, 
            host="127.0.0.1", 
            port=port, 
            workers=1,  # Single worker to share thread pool
            log_level="info",
            access_log=False,  # Disable access log for better performance
            loop="asyncio"
        )
    except Exception as e:
        print(f"Failed to start server: {e}")
        sys.exit(1)