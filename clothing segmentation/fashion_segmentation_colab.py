"""
=============================================================================
Fashion For Everyone - Quick Start Colab Notebook
=============================================================================
Copy each section into a separate Colab cell and run sequentially.
Tested on: Google Colab Free Tier (T4 GPU)
=============================================================================
"""

# ============================================================================
# CELL 1: Setup & Installation (~3-5 minutes)
# ============================================================================
# %%
# Mount Google Drive (store your scraped images here)
from google.colab import drive
drive.mount('/content/drive')

# Install dependencies
!pip install -q torch torchvision --upgrade
!pip install -q transformers>=4.40.0 accelerate supervision>=0.21.0
!pip install -q sam2 pillow opencv-python-headless tqdm

# Clone Grounded SAM 2 and install
!git clone -q https://github.com/IDEA-Research/Grounded-SAM-2.git
%cd Grounded-SAM-2

# Install SAM 2 (skip CUDA extension build if it fails - still works)
!SAM2_BUILD_CUDA=0 pip install -e . -q

# Install Grounding DINO
!pip install --no-build-isolation -e grounding_dino -q

# Download SAM 2 checkpoints (sam2.1_hiera_large is best quality)
%cd checkpoints
!bash download_ckpts.sh
%cd /content


# ============================================================================
# CELL 2: Verify GPU & Imports
# ============================================================================
# %%
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"GPU Memory: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB")

import numpy as np
from PIL import Image
from pathlib import Path
import os, json, cv2
from tqdm import tqdm

# Test imports
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
print("Transformers loaded OK")

import sys
sys.path.insert(0, '/content/Grounded-SAM-2')
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
print("SAM 2 loaded OK")

import supervision as sv
print("All imports successful!")


# ============================================================================
# CELL 3: Load Models (~1-2 minutes on first run, cached after)
# ============================================================================
# %%
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Load Grounding DINO (from HuggingFace - auto downloads ~350MB)
print("Loading Grounding DINO...")
gdino_processor = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
gdino_model = AutoModelForZeroShotObjectDetection.from_pretrained(
    "IDEA-Research/grounding-dino-tiny"
).to(DEVICE)
gdino_model.eval()

# Load SAM 2 (from downloaded checkpoint ~900MB)
print("Loading SAM 2.1 Large...")
sam2_model = build_sam2(
    "configs/sam2.1/sam2.1_hiera_l.yaml",
    "/content/Grounded-SAM-2/checkpoints/sam2.1_hiera_large.pt",
    device=DEVICE,
)
sam2_predictor = SAM2ImagePredictor(sam2_model)

print(f"Both models loaded on {DEVICE}!")


# ============================================================================
# CELL 4: Test on YOUR sample images
# ============================================================================
# %%
from IPython.display import display
import matplotlib.pyplot as plt

def detect_and_segment(image_path, text_prompt, box_threshold=0.30, text_threshold=0.25):
    """Complete pipeline: detect clothing → segment → extract."""

    image = Image.open(image_path).convert("RGB")
    image_np = np.array(image)

    # --- Grounding DINO detection ---
    inputs = gdino_processor(
        images=image, text=text_prompt, return_tensors="pt"
    ).to(DEVICE)

    with torch.no_grad():
        outputs = gdino_model(**inputs)

    results = gdino_processor.post_process_grounded_object_detection(
        outputs, inputs.input_ids,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        target_sizes=[image.size[::-1]]
    )[0]

    boxes = results["boxes"].cpu().numpy()
    scores = results["scores"].cpu().numpy()
    labels = results["labels"]

    print(f"Detected {len(boxes)} items: {labels}")
    print(f"Scores: {scores.round(3)}")

    if len(boxes) == 0:
        print("Nothing detected! Try lowering thresholds or changing the prompt.")
        plt.figure(figsize=(8, 8))
        plt.imshow(image_np)
        plt.title("No detections")
        plt.show()
        return None, None, None

    # --- SAM 2 segmentation ---
    sam2_predictor.set_image(image_np)
    masks, iou_scores, _ = sam2_predictor.predict(
        box=boxes, multimask_output=False
    )
    if masks.ndim == 4:
        masks = masks.squeeze(1)
    if iou_scores.ndim == 2:
        iou_scores = iou_scores.squeeze(1)

    # --- Visualize ---
    fig, axes = plt.subplots(1, 3, figsize=(20, 7))

    # Original with boxes
    axes[0].imshow(image_np)
    for box, label, score in zip(boxes, labels, scores):
        x1, y1, x2, y2 = box.astype(int)
        rect = plt.Rectangle((x1, y1), x2-x1, y2-y1, fill=False, color='lime', linewidth=2)
        axes[0].add_patch(rect)
        axes[0].text(x1, y1-5, f"{label} {score:.2f}", color='lime', fontsize=10,
                      bbox=dict(boxstyle='round', facecolor='black', alpha=0.7))
    axes[0].set_title("Detection (Grounding DINO)")
    axes[0].axis('off')

    # Mask overlay
    combined_mask = masks.any(axis=0)
    overlay = image_np.copy()
    overlay[combined_mask] = (overlay[combined_mask] * 0.5 + np.array([0, 255, 0]) * 0.5).astype(np.uint8)
    axes[1].imshow(overlay)
    axes[1].set_title("Segmentation (SAM 2)")
    axes[1].axis('off')

    # Extracted clothing on white
    white_bg = np.full_like(image_np, 255)
    white_bg[combined_mask] = image_np[combined_mask]
    # Crop to mask bounds
    rows = np.any(combined_mask, axis=1)
    cols = np.any(combined_mask, axis=0)
    y1, y2 = np.where(rows)[0][[0, -1]]
    x1, x2 = np.where(cols)[0][[0, -1]]
    cropped = white_bg[max(0,y1-10):y2+10, max(0,x1-10):x2+10]
    axes[2].imshow(cropped)
    axes[2].set_title("Extracted Clothing")
    axes[2].axis('off')

    plt.tight_layout()
    plt.show()

    return masks, boxes, labels


# ===========================================================
# 🔧 TEST WITH YOUR IMAGES - Update these paths!
# ===========================================================
# Upload a test image to Colab or use from Google Drive

# Option A: Use your uploaded Myntra images
# test_path = "/content/drive/MyDrive/fashion_dataset/tshirts/product_001/image_0.jpg"

# Option B: Quick test with a sample (upload an image to Colab files panel)
# test_path = "/content/sample_tshirt.jpg"

# IMPORTANT: text prompts must be LOWERCASE and END WITH A PERIOD
# Adjust the prompt based on the clothing category
test_prompt = "t-shirt. top."  # For t-shirts

# Uncomment and run:
# masks, boxes, labels = detect_and_segment(test_path, test_prompt)


# ============================================================================
# CELL 5: Threshold Tuning Guide
# ============================================================================
# %%
"""
THRESHOLD TUNING - This is critical for good results!

The two key thresholds:
  box_threshold:  How confident the model must be about the bounding box
  text_threshold: How well the text must match the detected region

Guidelines per clothing type:

SIMPLE ITEMS (t-shirts, shirts, jeans, shorts):
  box_threshold=0.30, text_threshold=0.25
  → These are easy to detect, standard thresholds work

COMPLEX ITEMS (sarees, lehenga-choli, dupatta, suits):
  box_threshold=0.20, text_threshold=0.15
  → Lower thresholds needed because:
    - Draped garments have unusual shapes
    - Multiple components (e.g., lehenga + choli)
    - Less common in Grounding DINO's training data

LAYERED OUTFITS (blazers over shirts, jackets):
  box_threshold=0.25, text_threshold=0.20
  → May detect multiple overlapping items
  → Consider using more specific prompts: "blazer." NOT "jacket. blazer. coat."

ETHNIC WEAR (kurtas, salwar, ethnic tops):
  box_threshold=0.25, text_threshold=0.20
  → Prompt engineering matters a lot here
  → Try both English and transliterated terms
"""

# Quick function to test different thresholds
def threshold_sweep(image_path, text_prompt, thresholds=None):
    """Test multiple threshold combinations on one image."""
    if thresholds is None:
        thresholds = [
            (0.15, 0.10),
            (0.20, 0.15),
            (0.25, 0.20),
            (0.30, 0.25),
            (0.35, 0.30),
            (0.40, 0.35),
        ]

    print(f"Image: {image_path}")
    print(f"Prompt: '{text_prompt}'")
    print(f"{'Box Thresh':<12} {'Text Thresh':<12} {'Detections':<12} {'Labels'}")
    print("-" * 60)

    for box_t, text_t in thresholds:
        image = Image.open(image_path).convert("RGB")
        inputs = gdino_processor(images=image, text=text_prompt, return_tensors="pt").to(DEVICE)

        with torch.no_grad():
            outputs = gdino_model(**inputs)

        results = gdino_processor.post_process_grounded_object_detection(
            outputs, inputs.input_ids,
            box_threshold=box_t, text_threshold=text_t,
            target_sizes=[image.size[::-1]]
        )[0]

        n = len(results["boxes"])
        lbls = results["labels"] if n > 0 else []
        print(f"{box_t:<12.2f} {text_t:<12.2f} {n:<12} {lbls}")

# Uncomment to run:
# threshold_sweep("/content/your_image.jpg", "t-shirt. top.")


# ============================================================================
# CELL 6: Prompt Engineering for Your Categories
# ============================================================================
# %%
"""
TEXT PROMPT DESIGN - Crucial for detection quality!

Rules:
  1. ALL LOWERCASE
  2. MUST END WITH A PERIOD
  3. Separate multiple terms with ". " (period + space)
  4. Be specific but not too narrow

The prompts below are starting points - tune them based on your results.
"""

CLOTHING_PROMPTS = {
    # ---- Men's ----
    'tshirts':           't-shirt. crew neck top.',
    'casual-shirts':     'casual shirt. button-up shirt.',
    'formal-shirts':     'formal shirt. dress shirt.',
    'sweatshirts':       'sweatshirt. hoodie. pullover.',
    'sweaters':          'sweater. knit pullover.',
    'jackets':           'jacket.',
    'blazers':           'blazer.',
    'suits':             'suit.',  # Will detect full suit; see note below
    'rain-jacket':       'rain jacket. waterproof jacket.',
    'jeans':             'jeans. denim trousers.',
    'casual-trousers':   'trousers. casual pants.',
    'formal-trousers':   'formal trousers. dress pants.',
    'shorts':            'shorts.',
    'trackpants':        'track pants. joggers.',

    # ---- Women's (these need more careful prompting) ----
    'women-kurtas-kurtis-suits': 'kurta. tunic.',
    'ethnic-tops':               'ethnic top. embroidered blouse.',
    'saree':                     'saree.',  # Sarees are tricky - see notes below
    'women-ethnic-wear':         'dress. ethnic dress.',
    'women-ethnic-bottomwear':   'pants. palazzo. churidar.',
    'skirts-palazzos':           'skirt. palazzo.',
    'lehenga-choli':             'skirt. blouse.',  # Detect components separately
    'dupatta-shawl':             'scarf. shawl. stole.',
    'women-jackets':             'jacket.',
}

"""
SPECIAL NOTES ON TRICKY CATEGORIES:

1. SAREES: Grounding DINO may not know "saree" well. Try:
   - "draped fabric. garment." (generic but catches it)
   - Run at lower thresholds (box=0.15, text=0.10)
   - Consider using Florence-2 instead of Grounding DINO for ethnic wear

2. LEHENGA-CHOLI: Two separate garments worn together.
   - Option A: Detect as "skirt. blouse." to get both pieces
   - Option B: Run two passes - "lehenga skirt." and "choli blouse."
   - Combine masks afterward

3. SUITS: Jacket + trousers as one outfit.
   - "suit." detects the full outfit
   - "suit jacket. suit trousers." detects pieces separately
   - Choose based on whether you want whole-outfit or per-piece images

4. DUPATTA/SHAWL: Often partially visible, draped over shoulders.
   - These are the hardest to segment cleanly
   - May overlap with the main garment
   - Consider whether you actually need these segmented separately
"""


# ============================================================================
# CELL 7: Batch Process Your Dataset
# ============================================================================
# %%

# === CONFIGURE THESE ===
DATASET_ROOT = "/content/drive/MyDrive/fashion_dataset"  # Your scraped images
OUTPUT_ROOT = "/content/drive/MyDrive/fashion_segmented"  # Where to save results

# Categories to process (start with a small subset to verify quality!)
CATEGORIES_TO_PROCESS = {
    'tshirts': 't-shirt. crew neck top.',
    'jeans': 'jeans. denim trousers.',
    # Add more as you verify quality per category
}

# Thresholds
BOX_THRESHOLD = 0.30
TEXT_THRESHOLD = 0.25

def batch_process():
    """Process all images in selected categories."""

    for category, prompt in CATEGORIES_TO_PROCESS.items():
        cat_dir = Path(DATASET_ROOT) / category
        out_dir = Path(OUTPUT_ROOT) / category

        if not cat_dir.exists():
            print(f"⚠ Skipping {category}: {cat_dir} not found")
            continue

        # Collect all images (handles both flat and nested structures)
        all_images = sorted(
            list(cat_dir.rglob("*.jpg")) +
            list(cat_dir.rglob("*.jpeg")) +
            list(cat_dir.rglob("*.png"))
        )

        print(f"\n{'='*50}")
        print(f"Category: {category} ({len(all_images)} images)")
        print(f"Prompt: '{prompt}'")
        print(f"{'='*50}")

        success_count = 0
        fail_count = 0

        for img_path in tqdm(all_images, desc=category):
            try:
                # Preserve subdirectory structure
                rel_path = img_path.relative_to(cat_dir)
                save_dir = out_dir / rel_path.parent
                os.makedirs(save_dir, exist_ok=True)

                image = Image.open(str(img_path)).convert("RGB")
                image_np = np.array(image)

                # Detect
                inputs = gdino_processor(
                    images=image, text=prompt, return_tensors="pt"
                ).to(DEVICE)

                with torch.no_grad():
                    outputs = gdino_model(**inputs)

                results = gdino_processor.post_process_grounded_object_detection(
                    outputs, inputs.input_ids,
                    box_threshold=BOX_THRESHOLD,
                    text_threshold=TEXT_THRESHOLD,
                    target_sizes=[image.size[::-1]]
                )[0]

                boxes = results["boxes"].cpu().numpy()

                if len(boxes) == 0:
                    fail_count += 1
                    continue

                # Segment
                sam2_predictor.set_image(image_np)
                masks, iou_scores, _ = sam2_predictor.predict(
                    box=boxes, multimask_output=False
                )
                if masks.ndim == 4:
                    masks = masks.squeeze(1)

                # Extract and save each detected item
                for i, mask in enumerate(masks):
                    # White background extraction
                    white_bg = np.full_like(image_np, 255)
                    white_bg[mask] = image_np[mask]

                    # Crop to mask bounds
                    rows = np.any(mask, axis=1)
                    cols = np.any(mask, axis=0)
                    if not rows.any():
                        continue
                    y1, y2 = np.where(rows)[0][[0, -1]]
                    x1, x2 = np.where(cols)[0][[0, -1]]
                    pad = 10
                    y1, x1 = max(0, y1-pad), max(0, x1-pad)
                    y2, x2 = min(mask.shape[0], y2+pad), min(mask.shape[1], x2+pad)

                    cropped = white_bg[y1:y2, x1:x2]
                    stem = img_path.stem

                    # Save white background version
                    Image.fromarray(cropped).save(
                        save_dir / f"{stem}_seg_{i}.jpg", quality=95
                    )

                    # Save transparent version
                    rgba = np.zeros((*image_np.shape[:2], 4), dtype=np.uint8)
                    rgba[:,:,:3] = image_np
                    rgba[:,:,3] = (mask * 255).astype(np.uint8)
                    Image.fromarray(rgba[y1:y2, x1:x2]).save(
                        save_dir / f"{stem}_seg_{i}.png"
                    )

                success_count += 1

            except Exception as e:
                fail_count += 1
                if fail_count <= 5:  # Only print first 5 errors
                    print(f"  Error on {img_path.name}: {e}")

        print(f"✓ {category}: {success_count} success, {fail_count} failed/empty")

# Run it!
batch_process()


# ============================================================================
# CELL 8: Quality Check - Visual Inspection
# ============================================================================
# %%
def quality_check(segmented_dir, num_samples=12):
    """Display a grid of segmented images for visual QA."""
    seg_dir = Path(segmented_dir)
    images = sorted(list(seg_dir.rglob("*_seg_0.jpg")))[:num_samples]

    if not images:
        print(f"No segmented images found in {segmented_dir}")
        return

    cols = 4
    rows = (len(images) + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(16, 4*rows))
    axes = axes.flatten() if rows > 1 else [axes] if cols == 1 else axes.flatten()

    for idx, (ax, img_path) in enumerate(zip(axes, images)):
        img = Image.open(img_path)
        ax.imshow(np.array(img))
        ax.set_title(img_path.name, fontsize=8)
        ax.axis('off')

    # Hide empty axes
    for ax in axes[len(images):]:
        ax.axis('off')

    plt.suptitle(f"Quality Check: {segmented_dir}", fontsize=14)
    plt.tight_layout()
    plt.show()

# Uncomment to run:
# quality_check("/content/drive/MyDrive/fashion_segmented/tshirts")
