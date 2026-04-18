import os
import re
import shutil

ZARA_DATASET_DIR = os.path.join(os.path.dirname(__file__), "zara_dataset")
FINAL_DATASET_DIR = os.path.join(os.path.dirname(__file__), "final_dataset")


def collect_pairs(subdir_path):
    """Return (jpg_path, txt_path) pairs from a subdirectory, sorted numerically."""
    files = os.listdir(subdir_path)
    indices = set()
    for fname in files:
        match = re.match(r'^(\d+)\.jpg$', fname)
        if match:
            indices.add(int(match.group(1)))

    pairs = []
    for idx in sorted(indices):
        jpg = os.path.join(subdir_path, f'{idx}.jpg')
        txt = os.path.join(subdir_path, f'{idx}.txt')
        if not os.path.exists(txt):
            print(f"  Warning: {jpg} has no matching .txt — skipping")
            continue
        pairs.append((jpg, txt))
    return pairs


def main():
    os.makedirs(FINAL_DATASET_DIR, exist_ok=True)

    counter = 1
    for subdir_name in sorted(os.listdir(ZARA_DATASET_DIR)):
        subdir_path = os.path.join(ZARA_DATASET_DIR, subdir_name)
        if not os.path.isdir(subdir_path):
            continue

        pairs = collect_pairs(subdir_path)
        for jpg_src, txt_src in pairs:
            shutil.move(jpg_src, os.path.join(FINAL_DATASET_DIR, f'{counter}.jpg'))
            shutil.move(txt_src, os.path.join(FINAL_DATASET_DIR, f'{counter}.txt'))
            counter += 1

        print(f"  {subdir_name}: {len(pairs)} files moved")

    print(f"\nDone. {counter - 1} image+txt pairs moved to {FINAL_DATASET_DIR}")


if __name__ == "__main__":
    main()
