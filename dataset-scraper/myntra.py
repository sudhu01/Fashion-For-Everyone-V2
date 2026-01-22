import requests, os, re, time
from urllib.parse import urljoin
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright


class MyntraScraper:

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        self.mensClothing = ['tshirts', 'casual-shirts', 'formal-shirts', 'sweatshirts', 'sweaters', 'jackets', 'blazers', 'suits', 'rain-jacket','jeans', 'casual-trousers', 'formal-trousers', 'shorts', 'trackpants']
        self.womensClothing = ['women-kurtas-kurtis-suits','ethnic-tops','saree','women-ethnic-wear','women-ethnic-bottomwear','skirts-palazzos','lehenga-choli','dupatta-shawl','women-jackets']
        self.imageCount = 0
    
    def getClothingAndDescription(self, type: str, clothing: str, n: int):
        if type.lower() != 'men' and type.lower() != 'women':
            raise TypeError("Clothing type must be either 'men' or 'women'")
        
        if type.lower() == 'men':
            if clothing not in self.mensClothing:
                raise ValueError(f"Invalid clothing choice. Clothing selected for men must be strictly of the following (case sensitive): {self.mensClothing}")
            url = f'{self.base_url}/men-{clothing}'
        else:
            if clothing not in self.womensClothing:
                raise ValueError(f"Invalid clothing choice. Clothing selected for women must be strictly of the following (case sensitive): {self.womensClothing}")
            url = f'{self.base_url}/{clothing}'

        print(f"Scraping: {url}")

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=False,
                args=[
                    "--disable-http2",
                    "--disable-blink-features=AutomationControlled"
                ]
            )
            
            page = browser.new_page()
            
            try:
                page.goto(url, wait_until="load", timeout=60000)
                
                time.sleep(5)
                
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                time.sleep(2)
                page.evaluate("window.scrollTo(0, 0)")
                time.sleep(1)
                
                try:
                    page.wait_for_selector("ul.results-base", timeout=10000)
                    print("  Product listings loaded successfully")
                except:
                    print("  Warning: Could not confirm product listings loaded")
                
                soup = BeautifulSoup(page.content(), "html.parser")
                
            except Exception as e:
                print(f"Error loading page: {e}")
                browser.close()
                return                

            clothingList = soup.find('ul', class_='results-base')
            if clothingList is None:
                raise ValueError("Invalid clothing items class name or url, unable to fetch ul of clothing items")
            
            clothingItems = clothingList.find_all('li', limit=n)
            print(f"Found {len(clothingItems)} items")

            for idx, item in enumerate(clothingItems):
                print(f"Processing item {idx + 1}/{len(clothingItems)}")
                
                a = item.find('a')
                if a is None:
                    print(f"  Skipping item {idx + 1}: No link found")
                    continue
                
                link = a.get('href')
                if link is None:
                    print(f"  Skipping item {idx + 1}: No href attribute")
                    continue
                
                link = str(link) if not isinstance(link, str) else link            
                product_url = urljoin(self.base_url, link)
                
                print(f"  Fetching product: {product_url}")
                
                try:
                    page.goto(product_url, wait_until="domcontentloaded", timeout=60000)
                    try:
                        page.wait_for_selector("div.image-grid-image", timeout=10000)
                    except:
                        print("  Warning: Timeout waiting for images to load.")
                    
                    soup2 = BeautifulSoup(page.content(), "html.parser")

                    imgGrids = soup2.find_all("div", class_="image-grid-image")
                    if not imgGrids:
                        print(f"  No images found for this item")
                    
                    image_urls = []
                    for imgGrid in imgGrids:
                        style = imgGrid.get('style')
                        if style:
                            match = re.search(r'url\(["\']?(.*?)["\']?\)', str(style))
                            if match:
                                image_urls.append(match.group(1))
                    
                    image_offset = 0
                    for image_url in image_urls:
                        try:
                            if not image_url.startswith('http'):
                                image_url = f"https:{image_url}" if image_url.startswith('//') else image_url

                            img_response = requests.get(image_url, headers=self.headers, timeout=10)
                            if img_response.status_code == 200:
                                img_filename = f'../dataset/{self.imageCount}_{image_offset}.jpg'
                                with open(img_filename, 'wb') as f:
                                    f.write(img_response.content)
                                print(f"  Saved: {img_filename}")
                                image_offset += 1

                        except Exception as e:
                            print(f"  Img Error: {e}")

                    p_desc = soup2.find('p', class_='pdp-product-description-content')
                    description = p_desc.get_text(strip=True) if p_desc else "No description available"
                    
                    desc_filename = f'../dataset/{self.imageCount}.txt'
                    with open(desc_filename, 'w', encoding='utf-8') as f:
                        f.write(description)
                    print(f"  Saved Description.")

                    self.imageCount += 1
                    
                    time.sleep(2)
                        
                except Exception as e:
                    print(f"  Error fetching product page: {e}")
                    continue

                browser.close()


if __name__ == "__main__":
    MS = MyntraScraper('https://www.myntra.com')

    mensClothing = MS.mensClothing
    womensClothing = MS.womensClothing
    
    for clothing in mensClothing:
        try:
            MS.getClothingAndDescription('men', clothing, 5)
        except Exception as e:
            print(f"Error processing {clothing}: {e}")
            continue
    
    for clothing in womensClothing:
        try:
            MS.getClothingAndDescription('women', clothing, 5)
        except Exception as e:
            print(f"Error processing {clothing}: {e}")
            continue
    
    print(f"\nTotal items processed: {MS.imageCount}")