import os
import re
from collections import defaultdict

ZARA_DATASET_DIR = os.path.join(os.path.dirname(__file__), "zara_dataset")


def rename_subdir(subdir_path):
    files = os.listdir(subdir_path)

    groups = defaultdict(list)
    for fname in files:
        match = re.match(r'^(\d+)', fname)
        if match:
            product_id = match.group(1)
            groups[product_id].append(fname)

    sorted_ids = sorted(groups.keys())

    for idx, product_id in enumerate(sorted_ids, start=1):
        product_files = sorted(groups[product_id])

        txt_files = [f for f in product_files if f.endswith('.txt')]
        jpg_files = sorted([f for f in product_files if f.endswith('.jpg')])

        if len(txt_files) != 1 or len(jpg_files) != 2:
            print(f"  Skipping {product_id}: expected 1 txt and 2 jpgs, "
                  f"got {len(txt_files)} txt and {len(jpg_files)} jpg(s)")
            continue

        targets = [
            (txt_files[0], f"__tmp_{idx}.txt"),
            (jpg_files[0], f"__tmp_{idx}_0.jpg"),
            (jpg_files[1], f"__tmp_{idx}_1.jpg"),
        ]
        for src, tmp in targets:
            os.rename(os.path.join(subdir_path, src),
                      os.path.join(subdir_path, tmp))

    for idx, product_id in enumerate(sorted_ids, start=1):
        product_files = sorted(groups[product_id])
        txt_files = [f for f in product_files if f.endswith('.txt')]
        jpg_files = sorted([f for f in product_files if f.endswith('.jpg')])

        if len(txt_files) != 1 or len(jpg_files) != 2:
            continue

        finals = [
            (f"__tmp_{idx}.txt",   f"{idx}.txt"),
            (f"__tmp_{idx}_0.jpg", f"{idx}_0.jpg"),
            (f"__tmp_{idx}_1.jpg", f"{idx}_1.jpg"),
        ]
        for tmp, final in finals:
            os.rename(os.path.join(subdir_path, tmp),
                      os.path.join(subdir_path, final))

    print(f"  Renamed {len(sorted_ids)} products in {os.path.basename(subdir_path)}")


def main():
    for name in sorted(os.listdir(ZARA_DATASET_DIR)):
        subdir = os.path.join(ZARA_DATASET_DIR, name)
        if os.path.isdir(subdir):
            print(f"Processing {name}...")
            rename_subdir(subdir)


if __name__ == "__main__":
    main()
