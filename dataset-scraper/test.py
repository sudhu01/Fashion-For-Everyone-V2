from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()
    
    page.goto("https://www.myntra.com/men-tshirts", wait_until="load", timeout=30000)
    
    time.sleep(5)
    
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(2)
    
    soup = BeautifulSoup(page.content(), "html.parser")
    
    print("Looking for product containers...")
    
    ul_results = soup.find('ul', class_='results-base')
    print(f"ul.results-base found: {ul_results is not None}")
    
    li_products = soup.find_all('li', class_='product-base')
    print(f"li.product-base count: {len(li_products)}")
    
    all_lis = soup.find_all('li', limit=5)
    print(f"\nFirst 5 <li> tags classes:")
    for i, li in enumerate(all_lis):
        print(f"  {i+1}. Classes: {li.get('class')}")
    
    all_links = soup.find_all('a', href=True, limit=10)
    print(f"\nFirst 10 links:")
    for i, link in enumerate(all_links):
        href = link.get('href')
        if href and ('/' in href):
            print(f"  {i+1}. {href[:80]}")
    
    with open("page_structure.html", "w", encoding="utf-8") as f:
        f.write(page.content())
    print("\nFull HTML saved to page_structure.html")
    
    input("Press Enter to close...")
    browser.close()