#!/usr/bin/env python3
"""
Image Viewer Pro - Backend Server
FastAPI server for image processing with EXR support
"""

import sys
import os
import base64
import asyncio
from pathlib import Path
from typing import List, Dict, Optional
import mimetypes

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
    max_size: int = 2048

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
    """Load image using OpenCV with EXR support"""
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
    """Generate thumbnail for image and return binary data"""
    try:
        image_path = request.image_path
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail="Image file not found")
        
        # Try OpenCV first (better for EXR)
        img_array = load_image_opencv(image_path)
        
        if img_array is not None:
            # Create thumbnail from numpy array
            thumbnail = create_thumbnail(img_array, request.size)
            img_bytes = image_to_bytes(thumbnail, quality=85)
            
            return Response(
                content=img_bytes,
                media_type="image/jpeg",
                headers={
                    "X-Image-Width": str(thumbnail.width),
                    "X-Image-Height": str(thumbnail.height)
                }
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
            
            img_bytes = image_to_bytes(pil_img, quality=85)
            
            return Response(
                content=img_bytes,
                media_type="image/jpeg",
                headers={
                    "X-Image-Width": str(pil_img.width),
                    "X-Image-Height": str(pil_img.height)
                }
            )
        
        raise HTTPException(status_code=500, detail="Failed to load image with both OpenCV and PIL")
        
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
            
            # Resize if too large
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
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    
    print(f"Starting Image Viewer Pro Backend on port {port}")
    print(f"OpenCV version: {cv2.__version__}")
    print("Server started")  # This triggers the main process
    
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")