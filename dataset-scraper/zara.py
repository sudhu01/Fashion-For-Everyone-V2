"""
=============================================================================
Zara Flat-Lay Image Scraper for Fashion For Everyone
=============================================================================
Scrapes flat-lay / product-only images from zara.com/in/en for LoRA training.

Strategy:
  1. For each category, load the listing page with Playwright
  2. Wait for product tiles to actually render (SPA - needs JS execution)
  3. Scroll repeatedly to trigger lazy-loading of more products
  4. Extract product URLs from the rendered DOM
  5. Paginate via ?page=N until enough products collected
  6. Visit each product page, extract gallery images AND description
  7. Filter out images containing humans (face/pose/skin detection)
  8. Save clean flat-lay images with metadata including description

Ideal dataset size for Flux 2.0 LoRA per category: 100 clean flat-lay images.

Requirements:
  pip install -r requirements.txt
  playwright install chromium

Usage:
  python zara_scraper.py                          # Scrape all categories
  python zara_scraper.py --category men_tshirts   # Scrape just one
  python zara_scraper.py --dry-run                # List URLs only
  python zara_scraper.py --headful                # Watch browser (debug)
=============================================================================
"""

import argparse
import asyncio
import json
import random
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Set

import requests
from playwright.async_api import async_playwright, Page, Browser, TimeoutError as PwTimeout
from tqdm import tqdm


# ============================================================================
# CONFIGURATION
# ============================================================================

OUTPUT_ROOT = Path("./zara_dataset")
BASE_URL = "https://www.zara.com"

TARGET_IMAGES_PER_CATEGORY = 100
PRODUCT_OVERSCRAPE_FACTOR = 3

PAGE_LOAD_DELAY = (2.0, 4.0)
PRODUCT_DELAY = (1.0, 2.5)
DOWNLOAD_DELAY = (0.3, 0.8)
MAX_PAGES_PER_CATEGORY = 20
BROWSER_HEADLESS = True

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


# ============================================================================
# CATEGORY URLS (verified from zara.com/in/en navigation)
# ============================================================================

MENS_CATEGORIES = {
    "jeans":               "https://www.zara.com/in/en/man-jeans-l659.html",
    "trousers":            "https://www.zara.com/in/en/man-trousers-l838.html",
    "shorts":              "https://www.zara.com/in/en/man-bermudas-l592.html",
    "jackets":             "https://www.zara.com/in/en/man-jackets-l640.html",
    "blazers":             "https://www.zara.com/in/en/man-blazers-l608.html",
    "suits":               "https://www.zara.com/in/en/man-suits-l808.html",
    "hoodies-sweatshirts": "https://www.zara.com/in/en/man-sweatshirts-l821.html",
    "overshirts":          "https://www.zara.com/in/en/man-overshirts-l3174.html",
    "tracksuits":          "https://www.zara.com/in/en/man-tracksuits-l17522.html",
}

WOMENS_CATEGORIES = {
    "dresses":              "https://www.zara.com/in/en/woman-dresses-l1066.html",
    "tops":                 "https://www.zara.com/in/en/woman-tops-l1322.html",
    "shirts":               "https://www.zara.com/in/en/woman-shirts-l1217.html",
    "tshirts":              "https://www.zara.com/in/en/woman-tshirts-l1362.html",
    "trousers":             "https://www.zara.com/in/en/woman-trousers-l1335.html",
    "jeans":                "https://www.zara.com/in/en/woman-jeans-l1119.html",
    "skirts":               "https://www.zara.com/in/en/woman-skirts-l1299.html",
    "shorts-bermuda":       "https://www.zara.com/in/en/woman-trousers-shorts-l1355.html",
    "blazers":              "https://www.zara.com/in/en/woman-blazers-l1055.html",
    "sweatshirts-joggers":  "https://www.zara.com/in/en/woman-sweatshirts-l1320.html",
    "cardigans-jumpers":    "https://www.zara.com/in/en/woman-cardigans-sweaters-l8322.html",
    "bodysuits":            "https://www.zara.com/in/en/woman-body-l1057.html",
}

ALL_CATEGORIES = {
    **{f"men_{k}": v for k, v in MENS_CATEGORIES.items()},
    **{f"women_{k}": v for k, v in WOMENS_CATEGORIES.items()},
}


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class Product:
    category: str
    product_url: str
    product_id: str
    name: str = ""
    description: str = ""
    image_urls: List[str] = field(default_factory=list)


@dataclass
class ScrapeStats:
    categories_processed: int = 0
    products_found: int = 0
    products_visited: int = 0
    images_downloaded: int = 0
    images_filtered_out: int = 0
    errors: int = 0


# ============================================================================
# PLAYWRIGHT HELPERS
# ============================================================================

PRODUCT_URL_PATTERN = re.compile(r"/in/en/[a-z0-9][\w\-]*-p\d+\.html", re.IGNORECASE)


async def polite_sleep(range_tuple):
    await asyncio.sleep(random.uniform(*range_tuple))


async def dismiss_cookie_banner(page: Page):
    """Zara shows a cookie banner on first visit - try to dismiss it."""
    selectors = [
        "#onetrust-accept-btn-handler",
        "button#onetrust-accept-btn-handler",
        "[data-testid='cookie-accept-all']",
        "button:has-text('ACCEPT ALL')",
        "button:has-text('Accept All')",
        "button:has-text('Accept')",
    ]
    for selector in selectors:
        try:
            btn = page.locator(selector).first
            if await btn.is_visible(timeout=1500):
                await btn.click()
                await asyncio.sleep(1.0)
                return
        except Exception:
            continue


async def wait_for_listing_to_render(page: Page, timeout: int = 25000) -> bool:
    """
    Zara is a SPA - product tiles render via JavaScript after the initial
    HTML loads. Wait until at least one product link is in the DOM.
    """
    try:
        await page.wait_for_selector(
            "a[href*='-p']",
            state="attached",
            timeout=timeout,
        )
        return True
    except PwTimeout:
        return False


async def scroll_to_load_all(page: Page, max_scrolls: int = 30):
    """
    Scroll progressively down the page to trigger lazy loading of all
    product tiles. Stops when the product count stabilises.
    """
    prev_count = 0
    stable_rounds = 0

    for _ in range(max_scrolls):
        await page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
        await asyncio.sleep(1.2)

        try:
            count = await page.locator("a[href*='-p']").count()
        except Exception:
            count = 0

        if count == prev_count:
            stable_rounds += 1
            if stable_rounds >= 3:
                break
        else:
            stable_rounds = 0
            prev_count = count

    # Scroll all the way to the bottom, then back to top
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    await asyncio.sleep(1.5)
    await page.evaluate("window.scrollTo(0, 0)")
    await asyncio.sleep(0.5)


async def extract_product_urls_from_listing(page: Page) -> Set[str]:
    """
    Extract product URLs from the rendered DOM using Zara's specific structure:

      ul.product-grid-block-dynamic__row
        li.product-grid-product
          div.product-grid-product__figure
            a[href]  <-- this is what we want
    """
    selector = "li.product-grid-product div.product-grid-product__figure a[href]"

    hrefs = await page.eval_on_selector_all(
        selector,
        "elements => elements.map(e => e.href)",
    )

    urls = set()
    for href in hrefs:
        if not href:
            continue
        if PRODUCT_URL_PATTERN.search(href):
            clean_url = href.split("?")[0].split("#")[0]
            urls.add(clean_url)

    return urls


async def collect_products_for_category(
    browser: Browser,
    category: str,
    category_url: str,
    target_count: int,
) -> List[Product]:
    """Visit a category listing and paginate until enough products are collected."""
    context = await browser.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1440, "height": 900},
        locale="en-IN",
    )
    page = await context.new_page()

    all_urls: Set[str] = set()
    products: List[Product] = []
    cookies_dismissed = False

    for page_num in range(1, MAX_PAGES_PER_CATEGORY + 1):
        url = category_url if page_num == 1 else f"{category_url}?page={page_num}"
        print(f"  [{category}] Loading page {page_num}: {url}")

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)

            if not cookies_dismissed:
                await dismiss_cookie_banner(page)
                cookies_dismissed = True

            # Wait for the SPA to actually render product tiles
            rendered = await wait_for_listing_to_render(page, timeout=25000)
            if not rendered:
                print(f"  [{category}] Product tiles did not render on page {page_num}")
                break

            await scroll_to_load_all(page)

        except Exception as e:
            print(f"  [{category}] Error loading page {page_num}: {e}")
            break

        page_urls = await extract_product_urls_from_listing(page)
        new_urls = page_urls - all_urls

        if not new_urls:
            print(f"  [{category}] No new products on page {page_num}, stopping")
            break

        all_urls.update(new_urls)

        for url in new_urls:
            match = re.search(r"-p(\d+)\.html", url)
            if match:
                products.append(Product(
                    category=category,
                    product_url=url,
                    product_id=match.group(1),
                ))

        print(f"  [{category}] Page {page_num}: +{len(new_urls)} products (total: {len(all_urls)})")

        if len(all_urls) >= target_count:
            break

        await polite_sleep(PAGE_LOAD_DELAY)

    await context.close()
    return products[:target_count]


async def extract_product_details(browser: Browser, product: Product) -> None:
    """
    Visit a product page and extract:
      - product name (h1)
      - product description (skipping model-height intro before second <br>)
      - all gallery image URLs from the product-detail-view extra-images list

    Selectors used (from Zara India DOM inspection):

    Gallery:
      ul.product-detail-view__extra-images
        li.product-detail-view__extra-image-wrapper
          button > div > div > picture > source[srcset]

    Description:
      div.product-detail-view__main-info
        div.product-detail-info.product-detail-view__info
          div.product-detail-description.product-detail-info__description
            div.expandable-text
              div.expandable-text__content
                div.expandable-text__inner-content
                  p   <-- description, with <br> tags separating model height
    """
    context = await browser.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1440, "height": 900},
        locale="en-IN",
    )
    page = await context.new_page()

    try:
        await page.goto(product.product_url, wait_until="domcontentloaded", timeout=60000)
        await dismiss_cookie_banner(page)

        # Wait for the product header to render
        try:
            await page.wait_for_selector("h1", timeout=15000)
        except PwTimeout:
            pass

        # Wait for the gallery list to appear
        try:
            await page.wait_for_selector(
                "ul.product-detail-view__extra-images",
                timeout=15000,
            )
        except PwTimeout:
            print(f"    Gallery did not render for {product.product_id}")

        # Slow incremental scroll so every gallery image gets a chance
        # to lazy-load. Recompute scroll height each iteration since the
        # page grows as more images load in.
        await asyncio.sleep(1.0)
        total_height = await page.evaluate("document.body.scrollHeight")
        current = 0
        step = 400
        while current < total_height:
            await page.evaluate(f"window.scrollTo(0, {current})")
            await asyncio.sleep(0.5)
            current += step
            new_height = await page.evaluate("document.body.scrollHeight")
            if new_height > total_height:
                total_height = new_height

        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(1.5)

        # Force every gallery <li> into view to trigger any remaining lazy loads
        try:
            li_handles = await page.query_selector_all(
                "ul.product-detail-view__extra-images li.product-detail-view__extra-image-wrapper"
            )
            for li in li_handles:
                try:
                    await li.scroll_into_view_if_needed(timeout=1000)
                    await asyncio.sleep(0.2)
                except Exception:
                    continue
        except Exception:
            pass

        await page.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(0.5)

        # --- Product name ---
        try:
            product.name = (await page.locator("h1").first.inner_text(timeout=3000)).strip()
        except Exception:
            try:
                title = await page.title()
                product.name = title.split("|")[0].strip() if title else ""
            except Exception:
                product.name = ""

        # --- Product description ---
        # Use the exact selector chain from the user. Grab the inner HTML
        # of the <p> so we can split on <br> tags and discard the model
        # height text that appears before the second <br>.
        product.description = await extract_clean_description(page)

        # --- Gallery images ---
        # Each gallery <li> wraps a <picture> with a <source srcset="...">.
        # srcset can contain multiple comma-separated candidates - we want
        # the largest one (last entry) for highest resolution.
        product.image_urls = await extract_gallery_images(page)

        print(f"    Found {len(product.image_urls)} gallery images for {product.product_id}")

    except Exception as e:
        print(f"    Error extracting from {product.product_url}: {e}")

    await context.close()


async def extract_clean_description(page: Page) -> str:
    """
    Pull the description <p>, then strip the "Model height" line that
    sits before the second <br>. Returns just the garment description.
    """
    selector = (
        "div.product-detail-view__main-info "
        "div.product-detail-info.product-detail-view__info "
        "div.product-detail-description.product-detail-info__description "
        "div.expandable-text "
        "div.expandable-text__content "
        "div.expandable-text__inner-content "
        "p"
    )

    try:
        loc = page.locator(selector).first
        if await loc.count() == 0:
            # Fallback: try a looser selector
            loc = page.locator("div.expandable-text__inner-content p").first
            if await loc.count() == 0:
                return ""

        # Get the inner HTML so we can split on <br> tags reliably.
        # Playwright will give us something like:
        #   "Model height: 188 cm"<br><br>"Regular fit T-shirt..."
        inner_html = await loc.inner_html(timeout=3000)
    except Exception:
        return ""

    if not inner_html:
        return ""

    # Normalise different <br> variants to a single token
    normalised = re.sub(r"<br\s*/?>", "<BR>", inner_html, flags=re.IGNORECASE)
    parts = normalised.split("<BR>")

    # The user said: "store only the content after the second <br>"
    # That means: skip everything before AND including the second <br>,
    # then keep what's left. parts[2:] joined gives us that.
    if len(parts) >= 3:
        garment_html = "<BR>".join(parts[2:])
    else:
        # No double <br> separator - the whole text is probably just
        # the garment description (no model height line)
        garment_html = normalised

    # Strip any remaining HTML tags and decode entities
    text = re.sub(r"<[^>]+>", " ", garment_html)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    text = text.replace("&quot;", '"').replace("&#39;", "'")
    # Strip surrounding quotes the user showed in their example
    text = text.strip().strip('"').strip("'").strip()
    text = re.sub(r"\s+", " ", text)

    return text


async def extract_gallery_images(page: Page) -> List[str]:
    """
    Walk the product-detail-view__extra-images list and pull every srcset
    URL out of the <source> tags inside each <picture>.
    """
    # Query all the <source> elements inside the gallery directly. We grab
    # srcset (and src as a fallback) for each one.
    raw = await page.eval_on_selector_all(
        "ul.product-detail-view__extra-images "
        "li.product-detail-view__extra-image-wrapper "
        "picture source",
        """elements => elements.map(el => ({
            srcset: el.getAttribute('srcset') || '',
            src: el.getAttribute('src') || '',
            media: el.getAttribute('media') || ''
        }))""",
    )

    # Also grab fallback <img> elements in case some <source> tags are empty
    img_fallback = await page.eval_on_selector_all(
        "ul.product-detail-view__extra-images "
        "li.product-detail-view__extra-image-wrapper "
        "picture img",
        "elements => elements.map(el => el.src || el.getAttribute('data-src') || '')",
    )

    seen = set()
    urls = []

    def add_url(raw_url: str):
        if not raw_url:
            return
        if "transparent-background" in raw_url or "loader" in raw_url:
            return
        if "/stdstatic/" in raw_url:
            return
        clean = raw_url.split("?")[0]
        if clean in seen:
            return
        seen.add(clean)
        urls.append(raw_url)  # keep the full URL with query (for high-res)

    for entry in raw:
        srcset = entry.get("srcset", "")
        if srcset:
            # srcset format: "url1 480w, url2 750w, url3 1500w"
            # We want the highest-resolution candidate (last one)
            candidates = [c.strip() for c in srcset.split(",") if c.strip()]
            if candidates:
                # Take the last candidate, strip the size descriptor
                last = candidates[-1]
                url_only = last.split(" ")[0]
                add_url(url_only)
        elif entry.get("src"):
            add_url(entry["src"])

    for src in img_fallback:
        add_url(src)

    return urls


# ============================================================================
# IMAGE DOWNLOAD & HUMAN FILTERING
# ============================================================================

def download_image(url: str, save_path: Path, timeout: int = 20) -> bool:
    try:
        headers = {
            "User-Agent": USER_AGENT,
            "Referer": "https://www.zara.com/",
        }
        response = requests.get(url, headers=headers, timeout=timeout, stream=True)
        response.raise_for_status()

        save_path.parent.mkdir(parents=True, exist_ok=True)
        with open(save_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        if save_path.stat().st_size < 10240:
            save_path.unlink()
            return False
        return True

    except Exception as e:
        print(f"    Download failed for {url}: {e}")
        return False


# Lazy-loaded YOLO model (loads once, reused across calls)
_yolo_model = None


def _get_yolo():
    global _yolo_model
    if _yolo_model is None:
        try:
            from ultralytics import YOLO
            _yolo_model = YOLO("yolov8n.pt")
            print("    YOLO model loaded")
        except ImportError:
            print("    WARNING: ultralytics not installed - human filter degraded")
            _yolo_model = False
        except Exception as e:
            print(f"    WARNING: YOLO failed to load: {e}")
            _yolo_model = False
    return _yolo_model


def has_human(image_path: Path) -> bool:
    """
    Returns True if the image contains a human (image will be filtered OUT).
    Strategy:
      1. YOLOv8 person detection (primary - handles all viewing angles)
      2. Haar face cascade (fallback)
      3. Skin-tone ratio (last resort)
    """
    try:
        import cv2
        import numpy as np

        img = cv2.imread(str(image_path))
        if img is None:
            return True
        h, w = img.shape[:2]
        img_area = h * w

        # --- Primary: YOLOv8 person detection ---
        yolo = _get_yolo()
        if yolo:
            try:
                results = yolo.predict(
                    source=str(image_path),
                    classes=[0],          # COCO class 0 = person
                    conf=0.7,
                    verbose=False,
                )
                if results and len(results) > 0:
                    boxes = results[0].boxes
                    if boxes is not None and len(boxes) > 0:
                        # Require the person bounding box to cover at least
                        # 8% of the image so tiny false positives on fabric
                        # folds or shadows do not trigger rejection
                        for box in boxes.xyxy.cpu().numpy():
                            x1, y1, x2, y2 = box
                            box_area = (x2 - x1) * (y2 - y1)
                            if box_area / img_area > 0.08:
                                return True
            except Exception as e:
                print(f"    YOLO inference failed for {image_path.name}: {e}")

        # --- Fallback: Haar face cascade ---
        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
        if len(faces) > 0:
            return True

        # --- Fallback: Skin-tone ratio ---
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        lower_skin = np.array([0, 20, 70], dtype=np.uint8)
        upper_skin = np.array([20, 255, 255], dtype=np.uint8)
        skin_mask = cv2.inRange(hsv, lower_skin, upper_skin)
        skin_ratio = skin_mask.sum() / (skin_mask.size * 255)
        if skin_ratio > 0.12:
            return True

        return False

    except Exception as e:
        print(f"    Human detection failed for {image_path.name}: {e}")
        # When in doubt, REJECT - safer for LoRA training data
        return True


# ============================================================================
# MAIN SCRAPING LOGIC
# ============================================================================

async def scrape_category(
    browser: Browser,
    category: str,
    category_url: str,
    stats: ScrapeStats,
    dry_run: bool = False,
) -> int:
    print(f"\n{'='*70}")
    print(f"Category: {category}")
    print(f"URL: {category_url}")
    print(f"{'='*70}")

    category_dir = OUTPUT_ROOT / category
    category_dir.mkdir(parents=True, exist_ok=True)

    target_products = TARGET_IMAGES_PER_CATEGORY * PRODUCT_OVERSCRAPE_FACTOR
    products = await collect_products_for_category(
        browser, category, category_url, target_products
    )

    print(f"  Collected {len(products)} products for {category}")
    stats.products_found += len(products)

    if dry_run:
        for p in products[:10]:
            print(f"    [dry-run] {p.product_url}")
        return 0

    clean_images_saved = 0
    metadata = []

    for product in tqdm(products, desc=f"  {category} products"):
        if clean_images_saved >= TARGET_IMAGES_PER_CATEGORY:
            print(f"  [{category}] Target reached ({TARGET_IMAGES_PER_CATEGORY})")
            break

        stats.products_visited += 1

        try:
            await extract_product_details(browser, product)
        except Exception as e:
            print(f"    Error on {product.product_url}: {e}")
            stats.errors += 1
            continue

        if not product.image_urls:
            continue

        # Write the description ONCE per product, before the image loop.
        # All clean images from this product reference this single .txt file.
        product_description = product.description or product.name or ""
        description_filename = f"{product.product_id}.txt"
        description_path = category_dir / description_filename
        if not description_path.exists() and product_description:
            try:
                with open(description_path, "w", encoding="utf-8") as f:
                    f.write(product_description)
            except Exception as e:
                print(f"    Failed to write description {description_filename}: {e}")

        for i, img_url in enumerate(product.image_urls):
            if clean_images_saved >= TARGET_IMAGES_PER_CATEGORY:
                break

            img_filename = f"{product.product_id}_{i}.jpg"
            img_path = category_dir / img_filename

            if img_path.exists():
                continue

            if not download_image(img_url, img_path):
                continue

            if has_human(img_path):
                img_path.unlink()
                stats.images_filtered_out += 1
                continue

            clean_images_saved += 1
            stats.images_downloaded += 1

            metadata.append({
                "filename": img_filename,
                "description_file": description_filename,
                "product_id": product.product_id,
                "product_name": product.name,
                "product_description": product_description,
                "product_url": product.product_url,
                "source_image_url": img_url,
            })

            time.sleep(random.uniform(*DOWNLOAD_DELAY))

        await polite_sleep(PRODUCT_DELAY)

    if metadata:
        meta_path = category_dir / "metadata.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)

    print(f"  [{category}] Saved {clean_images_saved} clean flat-lay images")
    return clean_images_saved


async def main():
    global TARGET_IMAGES_PER_CATEGORY, BROWSER_HEADLESS

    parser = argparse.ArgumentParser(description="Scrape flat-lay images from Zara India")
    parser.add_argument("--category", help="Scrape only this category")
    parser.add_argument("--dry-run", action="store_true", help="List URLs, don't download")
    parser.add_argument("--headful", action="store_true", help="Show browser (for debugging)")
    parser.add_argument("--target", type=int, default=TARGET_IMAGES_PER_CATEGORY,
                        help=f"Target images per category (default: {TARGET_IMAGES_PER_CATEGORY})")
    args = parser.parse_args()

    TARGET_IMAGES_PER_CATEGORY = args.target
    if args.headful:
        BROWSER_HEADLESS = False

    if args.category:
        if args.category not in ALL_CATEGORIES:
            print(f"Unknown category: {args.category}")
            print(f"Available: {list(ALL_CATEGORIES.keys())}")
            return
        categories = {args.category: ALL_CATEGORIES[args.category]}
    else:
        categories = ALL_CATEGORIES

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    stats = ScrapeStats()

    print(f"\nScraping {len(categories)} categories")
    print(f"Target: {TARGET_IMAGES_PER_CATEGORY} clean flat-lay images per category")
    print(f"Output: {OUTPUT_ROOT.absolute()}\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=BROWSER_HEADLESS,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        )

        for category, category_url in categories.items():
            try:
                await scrape_category(
                    browser, category, category_url, stats, dry_run=args.dry_run
                )
                stats.categories_processed += 1
            except Exception as e:
                print(f"FATAL error in {category}: {e}")
                stats.errors += 1

            await polite_sleep((5.0, 10.0))

        await browser.close()

    print(f"\n{'='*70}")
    print("SCRAPING COMPLETE")
    print(f"{'='*70}")
    print(f"Categories processed:    {stats.categories_processed}")
    print(f"Products found:          {stats.products_found}")
    print(f"Products visited:        {stats.products_visited}")
    print(f"Clean images downloaded: {stats.images_downloaded}")
    print(f"Images filtered (human): {stats.images_filtered_out}")
    print(f"Errors:                  {stats.errors}")
    print(f"Output: {OUTPUT_ROOT.absolute()}")

    with open(OUTPUT_ROOT / "scrape_stats.json", "w") as f:
        json.dump({
            "categories_processed": stats.categories_processed,
            "products_found": stats.products_found,
            "products_visited": stats.products_visited,
            "images_downloaded": stats.images_downloaded,
            "images_filtered_out": stats.images_filtered_out,
            "errors": stats.errors,
            "target_per_category": TARGET_IMAGES_PER_CATEGORY,
        }, f, indent=2)


if __name__ == "__main__":
    asyncio.run(main())