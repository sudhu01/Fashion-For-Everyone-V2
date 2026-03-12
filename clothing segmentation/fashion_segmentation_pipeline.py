"""
=============================================================================
Fashion For Everyone - Clothing Segmentation Pipeline
=============================================================================
Uses Grounding DINO (HuggingFace) + SAM 2 to detect and segment clothing
from Myntra-scraped model images.

Pipeline: Image → Grounding DINO detects clothing → SAM 2 segments it
          → Extracted clothing on white/transparent background

Environment: Google Colab (T4 GPU free tier is sufficient)
=============================================================================
"""

# ============================================================================
# CELL 1: Installation (run this first in Colab)
# ============================================================================
"""
# --- Run these in separate Colab cells ---

!pip install -q torch torchvision
!pip install -q transformers accelerate supervision
!pip install -q sam2 pillow opencv-python-headless
!pip install -q tqdm pandas

# For Grounded SAM 2 repo (needed for some utilities)
!git clone -q https://github.com/IDEA-Research/Grounded-SAM-2.git
%cd Grounded-SAM-2
!pip install -e . -q
!pip install --no-build-isolation -e grounding_dino -q

# Download SAM 2 checkpoints
!cd checkpoints && bash download_ckpts.sh
%cd /content
"""

# ============================================================================
# CELL 2: Imports
# ============================================================================
import os
import json
import torch
import numpy as np
from PIL import Image
from pathlib import Path
from tqdm import tqdm
import cv2
import supervision as sv

# ============================================================================
# CELL 3: Configuration
# ============================================================================
class Config:
    """Central configuration for the segmentation pipeline."""

    # --- Device ---
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

    # --- Paths (adjust to your Colab/Drive structure) ---
    # Root folder containing scraped images organized by category
    # Expected structure:
    #   DATASET_ROOT/
    #     tshirts/
    #       product_001/
    #         image_0.jpg
    #         image_1.jpg
    #         description.txt   (or .json)
    #       product_002/
    #         ...
    #     casual-shirts/
    #       ...
    DATASET_ROOT = "/content/drive/MyDrive/fashion_dataset"
    OUTPUT_ROOT = "/content/drive/MyDrive/fashion_segmented"

    # --- Model paths ---
    SAM2_CHECKPOINT = "/content/Grounded-SAM-2/checkpoints/sam2.1_hiera_large.pt"
    SAM2_MODEL_CFG = "configs/sam2.1/sam2.1_hiera_l.yaml"

    # If using HuggingFace Grounding DINO (recommended - simpler setup):
    GDINO_MODEL_ID = "IDEA-Research/grounding-dino-tiny"

    # --- Detection thresholds ---
    # These are CRITICAL for your fashion use case - tune per category
    BOX_THRESHOLD = 0.30    # Confidence for bounding box detection
    TEXT_THRESHOLD = 0.25   # Confidence for text-grounding match

    # --- Clothing categories and their text prompts ---
    # IMPORTANT: Grounding DINO prompts must be lowercase and end with a period
    MENS_CLOTHING = {
        'tshirts':           't-shirt. top.',
        'casual-shirts':     'casual shirt. shirt.',
        'formal-shirts':     'formal shirt. dress shirt.',
        'sweatshirts':       'sweatshirt. hoodie.',
        'sweaters':          'sweater. pullover. knit top.',
        'jackets':           'jacket. outerwear.',
        'blazers':           'blazer. suit jacket.',
        'suits':             'suit jacket. suit trousers. suit.',
        'rain-jacket':       'rain jacket. raincoat.',
        'jeans':             'jeans. denim pants.',
        'casual-trousers':   'casual trousers. pants.',
        'formal-trousers':   'formal trousers. dress pants.',
        'shorts':            'shorts.',
        'trackpants':        'track pants. joggers. sweatpants.',
    }

    WOMENS_CLOTHING = {
        'women-kurtas-kurtis-suits': 'kurta. kurti. salwar suit. ethnic tunic.',
        'ethnic-tops':               'ethnic top. embroidered top.',
        'saree':                     'saree. sari. drape.',
        'women-ethnic-wear':         'ethnic dress. anarkali. ethnic wear.',
        'women-ethnic-bottomwear':   'ethnic bottom. churidar. palazzo. salwar.',
        'skirts-palazzos':           'skirt. palazzo pants.',
        'lehenga-choli':             'lehenga. choli. lehenga skirt.',
        'dupatta-shawl':             'dupatta. shawl. scarf. stole.',
        'women-jackets':             'jacket. women jacket. outerwear.',
    }

    ALL_CATEGORIES = {**MENS_CLOTHING, **WOMENS_CLOTHING}

    # --- Output settings ---
    SAVE_VISUALIZATION = True   # Save annotated debug images
    SAVE_MASK = True            # Save binary mask as separate file
    BACKGROUND_COLOR = (255, 255, 255)  # White background for segmented output
    SAVE_TRANSPARENT = True     # Also save RGBA with transparent background


# ============================================================================
# CELL 4: Load Models
# ============================================================================
def load_models(config: Config):
    """
    Load Grounding DINO and SAM 2 models.

    Two approaches are provided:
      A) HuggingFace Transformers API (simpler, recommended)
      B) Local Grounding DINO + SAM 2 (from cloned repo)
    """

    print(f"Using device: {config.DEVICE}")

    # ----- Approach A: HuggingFace Transformers (RECOMMENDED) -----
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

    print("Loading Grounding DINO from HuggingFace...")
    gdino_processor = AutoProcessor.from_pretrained(config.GDINO_MODEL_ID)
    gdino_model = AutoModelForZeroShotObjectDetection.from_pretrained(
        config.GDINO_MODEL_ID
    ).to(config.DEVICE)
    gdino_model.eval()

    print("Loading SAM 2...")
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    sam2_model = build_sam2(
        config.SAM2_MODEL_CFG,
        config.SAM2_CHECKPOINT,
        device=config.DEVICE
    )
    sam2_predictor = SAM2ImagePredictor(sam2_model)

    print("Models loaded successfully!")

    return {
        'gdino_processor': gdino_processor,
        'gdino_model': gdino_model,
        'sam2_predictor': sam2_predictor,
    }


# ============================================================================
# CELL 5: Core Detection + Segmentation Functions
# ============================================================================
def detect_clothing(image: Image.Image, text_prompt: str, models: dict, config: Config):
    """
    Use Grounding DINO to detect clothing items in the image.

    Args:
        image: PIL Image
        text_prompt: Grounding DINO text prompt (lowercase, ends with period)
        models: Dict containing loaded models
        config: Config object

    Returns:
        boxes: np.ndarray of shape (N, 4) in xyxy format
        confidences: np.ndarray of shape (N,)
        labels: list of str
    """
    processor = models['gdino_processor']
    model = models['gdino_model']

    inputs = processor(
        images=image,
        text=text_prompt,
        return_tensors="pt"
    ).to(config.DEVICE)

    with torch.no_grad():
        outputs = model(**inputs)

    # Post-process: convert outputs to boxes in image coordinates
    results = processor.post_process_grounded_object_detection(
        outputs,
        inputs.input_ids,
        box_threshold=config.BOX_THRESHOLD,
        text_threshold=config.TEXT_THRESHOLD,
        target_sizes=[image.size[::-1]]  # (height, width)
    )[0]

    boxes = results["boxes"].cpu().numpy()       # (N, 4) in xyxy
    scores = results["scores"].cpu().numpy()     # (N,)
    labels = results["labels"]                    # list of str

    return boxes, scores, labels


def segment_with_sam2(image_np: np.ndarray, boxes: np.ndarray, models: dict):
    """
    Use SAM 2 to generate pixel-level masks from bounding boxes.

    Args:
        image_np: numpy array (H, W, 3) in RGB
        boxes: np.ndarray (N, 4) in xyxy format
        models: Dict containing loaded models

    Returns:
        masks: np.ndarray of shape (N, H, W) boolean masks
        scores: np.ndarray of shape (N,) IoU scores
    """
    predictor = models['sam2_predictor']
    predictor.set_image(image_np)

    if len(boxes) == 0:
        return np.array([]), np.array([])

    # SAM 2 can take multiple box prompts at once
    masks, iou_scores, _ = predictor.predict(
        point_coords=None,
        point_labels=None,
        box=boxes,
        multimask_output=False,  # Single best mask per box
    )

    # masks shape: (N, 1, H, W) → squeeze to (N, H, W)
    if masks.ndim == 4:
        masks = masks.squeeze(1)

    if iou_scores.ndim == 2:
        iou_scores = iou_scores.squeeze(1)

    return masks, iou_scores


def extract_clothing(
    image_np: np.ndarray,
    mask: np.ndarray,
    background_color=(255, 255, 255),
    save_transparent=True
):
    """
    Extract the clothing region using the segmentation mask.

    Args:
        image_np: (H, W, 3) RGB numpy array
        mask: (H, W) boolean mask
        background_color: tuple for the background fill
        save_transparent: if True, also return RGBA image

    Returns:
        extracted_white_bg: (H, W, 3) clothing on white background, cropped
        extracted_rgba: (H, W, 4) clothing with transparent background, cropped
        bbox: (x1, y1, x2, y2) bounding box of the mask
    """
    # Find bounding box of the mask for tight cropping
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)

    if not rows.any() or not cols.any():
        return None, None, None

    y1, y2 = np.where(rows)[0][[0, -1]]
    x1, x2 = np.where(cols)[0][[0, -1]]

    # Add small padding
    pad = 10
    y1 = max(0, y1 - pad)
    y2 = min(mask.shape[0], y2 + pad)
    x1 = max(0, x1 - pad)
    x2 = min(mask.shape[1], x2 + pad)

    # White background version
    bg = np.full_like(image_np, background_color, dtype=np.uint8)
    bg[mask] = image_np[mask]
    cropped_white = bg[y1:y2, x1:x2]

    # Transparent background version (RGBA)
    cropped_rgba = None
    if save_transparent:
        rgba = np.zeros((image_np.shape[0], image_np.shape[1], 4), dtype=np.uint8)
        rgba[:, :, :3] = image_np
        rgba[:, :, 3] = (mask * 255).astype(np.uint8)
        cropped_rgba = rgba[y1:y2, x1:x2]

    return cropped_white, cropped_rgba, (x1, y1, x2, y2)


# ============================================================================
# CELL 6: Visualization Helpers
# ============================================================================
def visualize_detections(image_np, boxes, masks, labels, scores):
    """Create an annotated visualization using the supervision library."""
    detections = sv.Detections(
        xyxy=boxes,
        mask=masks if len(masks) > 0 else None,
        confidence=scores,
    )

    annotated = image_np.copy()

    # Draw masks
    if masks is not None and len(masks) > 0:
        mask_annotator = sv.MaskAnnotator(opacity=0.4)
        annotated = mask_annotator.annotate(annotated, detections)

    # Draw boxes
    box_annotator = sv.BoxAnnotator()
    annotated = box_annotator.annotate(annotated, detections)

    # Draw labels
    label_strs = [
        f"{label}: {score:.2f}"
        for label, score in zip(labels, scores)
    ]
    label_annotator = sv.LabelAnnotator()
    annotated = label_annotator.annotate(annotated, detections, labels=label_strs)

    return annotated


# ============================================================================
# CELL 7: Process a Single Image (use this to test/debug)
# ============================================================================
def process_single_image(
    image_path: str,
    text_prompt: str,
    models: dict,
    config: Config,
    output_dir: str = None,
):
    """
    Full pipeline for a single image:
    detect → segment → extract → save.

    Args:
        image_path: Path to the input image
        text_prompt: Grounding DINO text prompt for the clothing category
        models: Loaded model dict
        config: Config object
        output_dir: Where to save outputs (optional)

    Returns:
        results: list of dicts with keys: mask, extracted_white, extracted_rgba, bbox, label, score
    """
    # Load image
    image = Image.open(image_path).convert("RGB")
    image_np = np.array(image)

    # Step 1: Detect clothing with Grounding DINO
    boxes, scores, labels = detect_clothing(image, text_prompt, models, config)

    if len(boxes) == 0:
        print(f"  No clothing detected in {image_path}")
        return []

    print(f"  Detected {len(boxes)} items: {labels} (scores: {scores.round(2)})")

    # Step 2: Segment with SAM 2
    masks, iou_scores = segment_with_sam2(image_np, boxes, models)

    if len(masks) == 0:
        print(f"  SAM 2 produced no masks for {image_path}")
        return []

    # Step 3: Extract each detected clothing item
    results = []
    for i, (mask, label, det_score, iou_score) in enumerate(
        zip(masks, labels, scores, iou_scores)
    ):
        extracted_white, extracted_rgba, bbox = extract_clothing(
            image_np, mask,
            background_color=config.BACKGROUND_COLOR,
            save_transparent=config.SAVE_TRANSPARENT,
        )

        if extracted_white is None:
            continue

        result = {
            'mask': mask,
            'extracted_white': extracted_white,
            'extracted_rgba': extracted_rgba,
            'bbox': bbox,
            'label': label,
            'detection_score': float(det_score),
            'iou_score': float(iou_score),
        }
        results.append(result)

        # Save outputs if output_dir specified
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            stem = Path(image_path).stem

            # Save extracted clothing (white bg)
            white_path = os.path.join(output_dir, f"{stem}_clothing_{i}_white.jpg")
            Image.fromarray(extracted_white).save(white_path, quality=95)

            # Save extracted clothing (transparent bg)
            if extracted_rgba is not None:
                rgba_path = os.path.join(output_dir, f"{stem}_clothing_{i}_rgba.png")
                Image.fromarray(extracted_rgba).save(rgba_path)

            # Save binary mask
            if config.SAVE_MASK:
                mask_path = os.path.join(output_dir, f"{stem}_clothing_{i}_mask.png")
                Image.fromarray((mask * 255).astype(np.uint8)).save(mask_path)

    # Save visualization
    if output_dir and config.SAVE_VISUALIZATION:
        vis = visualize_detections(image_np, boxes, masks, labels, scores)
        vis_path = os.path.join(output_dir, f"{Path(image_path).stem}_annotated.jpg")
        Image.fromarray(vis).save(vis_path, quality=90)

    return results


# ============================================================================
# CELL 8: Batch Processing - Process Entire Dataset
# ============================================================================
def process_dataset(config: Config, models: dict, categories: dict = None):
    """
    Process the full scraped dataset.

    Expected input structure:
        DATASET_ROOT/
          {category}/
            {product_id}/
              image_0.jpg, image_1.jpg, ...
              description.txt (or metadata.json)

    Output structure:
        OUTPUT_ROOT/
          {category}/
            {product_id}/
              image_0_clothing_0_white.jpg   (clothing on white bg)
              image_0_clothing_0_rgba.png    (clothing, transparent bg)
              image_0_clothing_0_mask.png    (binary mask)
              image_0_annotated.jpg          (visualization)
              metadata.json                  (detection metadata)
    """
    if categories is None:
        categories = config.ALL_CATEGORIES

    dataset_root = Path(config.DATASET_ROOT)
    output_root = Path(config.OUTPUT_ROOT)

    # Stats tracking
    stats = {
        'total_images': 0,
        'total_detections': 0,
        'failed_images': 0,
        'categories_processed': {},
    }

    for category, text_prompt in categories.items():
        category_dir = dataset_root / category

        if not category_dir.exists():
            print(f"Skipping {category} - directory not found")
            continue

        print(f"\n{'='*60}")
        print(f"Processing category: {category}")
        print(f"Text prompt: '{text_prompt}'")
        print(f"{'='*60}")

        cat_detections = 0
        cat_images = 0

        # Iterate over product folders
        product_dirs = sorted([
            d for d in category_dir.iterdir()
            if d.is_dir()
        ])

        # If images are directly in category folder (no product subdirs)
        image_files = sorted(
            list(category_dir.glob("*.jpg")) +
            list(category_dir.glob("*.jpeg")) +
            list(category_dir.glob("*.png"))
        )

        if product_dirs:
            # Product-subfolder structure
            for product_dir in tqdm(product_dirs, desc=f"  {category}"):
                images = sorted(
                    list(product_dir.glob("*.jpg")) +
                    list(product_dir.glob("*.jpeg")) +
                    list(product_dir.glob("*.png"))
                )

                output_dir = output_root / category / product_dir.name

                for img_path in images:
                    cat_images += 1
                    try:
                        results = process_single_image(
                            str(img_path), text_prompt, models, config,
                            output_dir=str(output_dir)
                        )
                        cat_detections += len(results)

                        # Save metadata
                        if results:
                            meta = [{
                                'image': img_path.name,
                                'label': r['label'],
                                'detection_score': r['detection_score'],
                                'iou_score': r['iou_score'],
                                'bbox': list(r['bbox']),
                            } for r in results]

                            meta_path = output_dir / f"{img_path.stem}_meta.json"
                            with open(meta_path, 'w') as f:
                                json.dump(meta, f, indent=2)

                    except Exception as e:
                        print(f"  ERROR processing {img_path}: {e}")
                        stats['failed_images'] += 1

        elif image_files:
            # Flat structure - images directly in category folder
            output_dir = output_root / category

            for img_path in tqdm(image_files, desc=f"  {category}"):
                cat_images += 1
                try:
                    results = process_single_image(
                        str(img_path), text_prompt, models, config,
                        output_dir=str(output_dir)
                    )
                    cat_detections += len(results)
                except Exception as e:
                    print(f"  ERROR processing {img_path}: {e}")
                    stats['failed_images'] += 1

        stats['total_images'] += cat_images
        stats['total_detections'] += cat_detections
        stats['categories_processed'][category] = {
            'images': cat_images,
            'detections': cat_detections,
        }

        print(f"  → {category}: {cat_images} images, {cat_detections} detections")

    # Print summary
    print(f"\n{'='*60}")
    print("DATASET PROCESSING COMPLETE")
    print(f"{'='*60}")
    print(f"Total images processed: {stats['total_images']}")
    print(f"Total clothing items extracted: {stats['total_detections']}")
    print(f"Failed images: {stats['failed_images']}")
    print(f"Output saved to: {output_root}")

    # Save stats
    stats_path = output_root / "processing_stats.json"
    os.makedirs(output_root, exist_ok=True)
    with open(stats_path, 'w') as f:
        json.dump(stats, f, indent=2)

    return stats


# ============================================================================
# CELL 9: Build LoRA Training Dataset (for Flux fine-tuning)
# ============================================================================
def build_lora_dataset(config: Config, output_csv_path: str = None):
    """
    After segmentation, build a clean dataset for Flux LoRA training.

    Creates a CSV/JSON mapping:
        image_path → caption/prompt

    This prepares your data for tools like:
      - kohya_ss (most popular LoRA trainer)
      - ai-toolkit by Ostris
      - SimpleTuner

    Output format (for kohya-style training):
        output_dir/
          img/
            000001.png    (segmented clothing image)
            000001.txt    (text caption)
            000002.png
            000002.txt
            ...
    """
    output_root = Path(config.OUTPUT_ROOT)
    lora_dir = output_root / "lora_training_data" / "img"
    os.makedirs(lora_dir, exist_ok=True)

    if output_csv_path is None:
        output_csv_path = str(output_root / "lora_training_data" / "metadata.csv")

    idx = 0
    records = []

    for category in config.ALL_CATEGORIES.keys():
        cat_dir = output_root / category

        if not cat_dir.exists():
            continue

        # Find all white-bg extracted images
        white_images = sorted(cat_dir.rglob("*_white.jpg"))

        for img_path in white_images:
            # Look for corresponding metadata
            meta_path = img_path.parent / f"{img_path.stem.replace('_white', '')}_meta.json"
            stem_base = img_path.stem.replace('_clothing_0_white', '').replace('_clothing_1_white', '')

            # Load description if available
            desc_path = None
            for ext in ['.txt', '.json']:
                candidate = img_path.parent / f"description{ext}"
                if candidate.exists():
                    desc_path = candidate
                    break

            caption = ""
            if desc_path and desc_path.suffix == '.txt':
                caption = desc_path.read_text().strip()
            elif desc_path and desc_path.suffix == '.json':
                with open(desc_path) as f:
                    data = json.load(f)
                    caption = data.get('description', data.get('title', ''))

            # If no description file, build caption from category
            if not caption:
                caption = f"a {category.replace('-', ' ')} clothing item"

            # Clean the caption for LoRA training
            # Remove marketing fluff, keep structural descriptors
            caption = clean_caption_for_training(caption, category)

            # Copy image and save caption
            new_img_name = f"{idx:06d}.png"
            new_txt_name = f"{idx:06d}.txt"

            # Convert to PNG for consistency
            img = Image.open(img_path).convert("RGB")
            img.save(lora_dir / new_img_name)

            # Save caption as .txt file (kohya format)
            (lora_dir / new_txt_name).write_text(caption)

            records.append({
                'index': idx,
                'image': new_img_name,
                'caption': caption,
                'category': category,
                'source_path': str(img_path),
            })

            idx += 1

    # Save CSV metadata
    import csv
    with open(output_csv_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['index', 'image', 'caption', 'category', 'source_path'])
        writer.writeheader()
        writer.writerows(records)

    print(f"LoRA training dataset built: {idx} images")
    print(f"  Images: {lora_dir}")
    print(f"  Metadata: {output_csv_path}")

    return records


def clean_caption_for_training(caption: str, category: str) -> str:
    """
    Clean Myntra product descriptions into concise training captions.

    Good caption: "navy blue solid round neck short sleeve cotton t-shirt"
    Bad caption:  "Buy Men Navy Blue Solid Round Neck T-shirt - Tshirts for Men 12345 | Myntra"
    """
    import re

    caption = caption.lower().strip()

    # Remove common marketing/e-commerce noise
    noise_patterns = [
        r'buy\s+(men|women|boys|girls)\s+',
        r'\s*-\s*(tshirts|shirts|jeans|tops|dresses)\s+for\s+(men|women)\s+\d+.*',
        r'\|\s*myntra.*$',
        r'free shipping.*$',
        r'cash on delivery.*$',
        r'(?:rs\.?|inr|₹)\s*\d+',
        r'(?:extra\s+)?\d+%\s*off',
        r'best\s+price.*$',
    ]

    for pattern in noise_patterns:
        caption = re.sub(pattern, '', caption, flags=re.IGNORECASE)

    # Remove extra whitespace
    caption = re.sub(r'\s+', ' ', caption).strip()

    # Ensure it starts with "a" or "an" for natural language
    if not caption.startswith(('a ', 'an ')):
        caption = f"a {caption}"

    return caption


# ============================================================================
# CELL 10: Main Execution
# ============================================================================
def main():
    """Run the full pipeline."""

    config = Config()

    # --- Step 1: Load models ---
    models = load_models(config)

    # --- Step 2: Quick test on a single image ---
    # Uncomment and adjust path to test:
    #
    # test_results = process_single_image(
    #     image_path="/content/drive/MyDrive/fashion_dataset/tshirts/sample/image_0.jpg",
    #     text_prompt="t-shirt. top.",
    #     models=models,
    #     config=config,
    #     output_dir="/content/test_output"
    # )
    # print(f"Test: {len(test_results)} items detected")

    # --- Step 3: Process full dataset ---
    # Process all categories:
    stats = process_dataset(config, models)

    # Or process specific categories:
    # stats = process_dataset(config, models, categories={
    #     'tshirts': 't-shirt. top.',
    #     'jeans': 'jeans. denim pants.',
    # })

    # --- Step 4: Build LoRA training dataset ---
    records = build_lora_dataset(config)

    print("\nPipeline complete!")
    print("Next steps:")
    print("  1. Review segmented outputs for quality")
    print("  2. Remove any bad segmentations manually")
    print("  3. Use the lora_training_data/ folder with kohya_ss or ai-toolkit")


if __name__ == "__main__":
    main()
