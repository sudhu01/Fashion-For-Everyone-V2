# Fashion For Everyone — Segmentation Guide & Troubleshooting

## Where to Run: Colab vs Cloud GPU

**Start with Google Colab Free Tier (T4 GPU, 15GB VRAM).** It's sufficient for this step. Here's the breakdown:

| Option | GPU | VRAM | Cost | Best For |
|--------|-----|------|------|----------|
| Colab Free | T4 | 15 GB | Free | Segmentation (this step) |
| Colab Pro | T4/A100 | 15-40 GB | ~$10/mo | Faster batch processing |
| RunPod/Vast.ai | A100/4090 | 40-80 GB | ~$0.50-2/hr | Flux LoRA training later |
| Lambda Labs | A100 | 80 GB | ~$1.10/hr | Large batch + training |

Grounding DINO Tiny uses ~1.5 GB VRAM. SAM 2.1 Hiera Large uses ~3-4 GB VRAM. Together they fit comfortably on a T4 with room to spare for batch processing. You'll need a bigger GPU later for Flux LoRA training, but not for segmentation.

## Architecture: Why HuggingFace API over Local Grounding DINO

The boilerplate code uses the **HuggingFace Transformers API** for Grounding DINO rather than the local checkpoint approach. Reasons:

1. **No CUDA compilation headaches** — the local Grounding DINO needs to compile the Deformable Attention CUDA operator, which frequently fails on Colab due to CUDA/GCC version mismatches.
2. **Auto-downloads from HuggingFace Hub** — no manual checkpoint downloading.
3. **Cleaner code** — standard `transformers` API with `AutoProcessor` / `AutoModel`.
4. **Same model, same quality** — `IDEA-Research/grounding-dino-tiny` on HuggingFace is the same weights.

The tradeoff: the local version can be marginally faster. But for hundreds of images, the difference is negligible vs. the setup pain.

## Prompt Engineering Deep Dive

This is the single most impactful thing you can tune. Grounding DINO is a text-grounded detector — the quality of your text prompt directly determines detection quality.

### Rules
- Always **lowercase**
- Always **end with a period**
- Use **". "** (period + space) to separate multiple terms
- Be **specific enough** to avoid false positives, but **general enough** to catch variants

### Category-Specific Advice

**Easy categories** (high detection confidence expected):
- t-shirts, shirts, jeans, shorts, jackets — Grounding DINO knows these well
- Use simple, direct prompts

**Medium categories** (may need threshold tuning):
- Blazers, sweaters, formal trousers, track pants
- Some confusion possible (blazer vs jacket, trousers vs jeans)
- Use more specific terms: "blazer." not "jacket."

**Hard categories** (ethnic/Indian wear):
- Sarees, kurtas, lehenga-choli, dupattas
- Grounding DINO was primarily trained on Western clothing
- These categories will likely need lower thresholds (box=0.15-0.20)
- Try generic descriptions: "draped garment." for sarees
- **Consider Florence-2 as an alternative grounding model** for these — it has better multilingual/diverse training

### Multi-Garment Images

Some Myntra images show full outfits. For example, a "suit" image has both jacket and trousers. Your options:

1. **Detect as one unit**: Use "suit." — gets the whole outfit in one mask
2. **Detect components**: Use "suit jacket. suit trousers." — gets separate masks
3. **Two-pass approach**: Run detection twice with different prompts, merge results

For LoRA training, option 1 (whole outfit) is usually better unless you specifically want to generate individual pieces.

## Threshold Tuning Strategy

Don't guess — use the `threshold_sweep` function in the notebook to systematically test.

Workflow:
1. Pick 5-10 representative images per category
2. Run the sweep function on each
3. Find the threshold where you get **exactly the clothing items you want** (no background objects, no missed items)
4. Err on the side of **slightly lower thresholds** — you can filter bad detections later, but you can't recover missed ones

Typical sweet spots by category type:
- Simple garments: box=0.30, text=0.25
- Ethnic wear: box=0.20, text=0.15
- Layered/complex: box=0.25, text=0.20

## Common Issues & Fixes

### "No detections" on images that clearly have clothing
- Lower both thresholds to 0.15/0.10 and see if anything appears
- Change the text prompt — try simpler terms
- Check image size — very small images (<256px) may not work well; resize up first
- Some product images with heavy text overlays confuse the model

### SAM 2 mask includes background or body parts
- This usually means the bounding box from Grounding DINO was too large
- Increase `box_threshold` to get tighter boxes
- Or use a more specific prompt to avoid detecting the whole person

### SAM 2 mask is too small / misses part of the garment
- The bounding box might be cutting off part of the garment
- Lower `box_threshold` slightly
- For draped items (sarees, dupattas), SAM 2 might struggle with thin/transparent fabric

### Multiple overlapping detections for one item
- Grounding DINO detects "t-shirt" and "top" separately from the prompt "t-shirt. top."
- These overlap significantly
- Fix: Add NMS (Non-Maximum Suppression) post-processing, or use single-term prompts

### CUDA out of memory
- SAM 2 Large is ~3-4GB; if you're running other things in the notebook, clear them
- Use `torch.cuda.empty_cache()` between batches
- Or switch to SAM 2 Hiera Small (less accurate but ~1.5GB)

### Colab disconnects during batch processing
- Save progress frequently (the batch script saves per-image)
- Process in smaller batches (e.g., 50 images at a time)
- Use Colab Pro for longer runtimes

## Quality Assurance Checklist

Before moving to LoRA training, verify:

- [ ] Run `quality_check()` on each category
- [ ] Segmentation masks are tight around clothing (not including face/hands)
- [ ] Background is cleanly removed (no skin/hair artifacts)
- [ ] No duplicate/overlapping extractions for single garments
- [ ] Captions are clean and descriptive (not marketing text)
- [ ] At least 15-20 good images per concept you want to train
- [ ] Images are consistent in quality (remove blurry/bad ones)

## What Comes Next: Preparing for Flux LoRA

Once segmentation is done, you'll need:

1. **Clean dataset**: 15-50 high-quality segmented images per concept
2. **Clean captions**: Structured descriptions (color, type, pattern, fit, material)
3. **Training tool**: kohya_ss, ai-toolkit by Ostris, or SimpleTuner
4. **GPU**: 24GB+ VRAM (4090, A100, or cloud GPU)
5. **Decision**: One general LoRA or multiple category-specific LoRAs?

The `build_lora_dataset()` function in the main script creates the folder structure expected by kohya_ss (image + matching .txt caption file).
