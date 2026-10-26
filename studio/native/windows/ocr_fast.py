"""Fast local OCR for pictures already saved by 来处. Writes one .txt beside each picture."""
import sys
from pathlib import Path

SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'}


def engine():
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        from rapidocr import RapidOCR
    return RapidOCR()


def lines_of(result):
    if result is None:
        return []
    rows = result[0] if isinstance(result, tuple) else result
    if rows is None:
        return []
    if hasattr(rows, 'txts'):
        return [str(text).strip() for text in rows.txts if str(text).strip()]
    found = []
    try:
        items = list(rows)
    except TypeError:
        return []
    for item in items:
        if isinstance(item, (list, tuple)) and len(item) >= 2 and not isinstance(item[1], (int, float)):
            text = str(item[1]).strip()
            if text:
                found.append(text)
    return found


def main():
    args = [arg for arg in sys.argv[1:] if arg != '--fast']
    if len(args) < 2:
        print('用法：ocr 图片目录 输出目录 --fast', file=sys.stderr)
        return 2
    source = Path(args[0])
    dest = Path(args[1])
    if not source.is_dir():
        print('没有找到图片目录。', file=sys.stderr)
        return 2
    dest.mkdir(parents=True, exist_ok=True)
    reader = engine()
    for image in sorted(path for path in source.iterdir() if path.suffix.lower() in SUFFIXES):
        result, _elapsed = reader(str(image))
        (dest / f'{image.stem}.txt').write_text('\n'.join(lines_of(result)), encoding='utf-8')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
