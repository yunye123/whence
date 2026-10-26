"""Checks the Windows install: app files, speech tools, OCR. Translation key is reported, not required."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

REQUIRED_MODEL = ('model.bin', 'config.json', 'tokenizer.json')


def run(command, timeout):
    return subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)


def main():
    if len(sys.argv) < 2:
        print('缺少安装目录。')
        return 2
    root = Path(sys.argv[1])
    runtime = root / 'runtime'
    python = runtime / 'python' / 'python.exe'
    ffmpeg = runtime / 'ffmpeg' / 'ffmpeg.exe'
    ffprobe = runtime / 'ffmpeg' / 'ffprobe.exe'
    model = runtime / 'models' / 'faster-whisper' / 'large-v3'
    ocr = runtime / 'ocr' / 'ocr.cmd'
    app = root / 'app' / 'studio'
    worker = app / 'native' / 'workers' / 'transcribe.py'
    lines = []
    failed = False

    def check(name, ok, detail=''):
        nonlocal failed
        if not ok:
            failed = True
        lines.append(f"{'通过' if ok else '未通过'}\t{name}" + (f"\t{detail}" if detail else ''))

    check('来处程序', (app / 'dist' / 'index.html').is_file() and (app / 'dist-native' / 'main.cjs').is_file() and (app / 'desktop-assets' / 'field.ico').is_file())
    check('资料目录可写', os.access(root / 'profile', os.W_OK) if (root / 'profile').is_dir() else False)
    check('Python', python.is_file(), first_line(run([str(python), '--version'], 30)) if python.is_file() else '没有 python.exe')
    check('FFmpeg', ffmpeg.is_file(), first_line(run([str(ffmpeg), '-version'], 30)) if ffmpeg.is_file() else '没有 ffmpeg.exe')
    check('ffprobe', ffprobe.is_file(), first_line(run([str(ffprobe), '-version'], 30)) if ffprobe.is_file() else '没有 ffprobe.exe')
    imports = run([str(python), '-c', 'import faster_whisper, yt_dlp; print("ok")'], 120) if python.is_file() else None
    check('语音转写组件', bool(imports and imports.returncode == 0 and 'ok' in imports.stdout), tail(imports.stderr if imports else 'Python 未就绪'))
    check('视频下载组件', bool(imports and imports.returncode == 0), '')
    for name in REQUIRED_MODEL:
        check(f'语音模型 {name}', (model / name).is_file(), str(model / name))
    sample = runtime / 'samples'
    sample.mkdir(parents=True, exist_ok=True)
    picture = sample / 'ocr-sample.png'
    if not picture.is_file():
        try:
            from PIL import Image, ImageDraw, ImageFont
            image = Image.new('RGB', (640, 180), 'white')
            font_path = next((Path(name) for name in (r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf') if Path(name).is_file()), None)
            font = ImageFont.truetype(str(font_path), 64) if font_path else ImageFont.load_default()
            ImageDraw.Draw(image).text((40, 40), '来处识图', fill='black', font=font)
            image.save(picture)
            check('识图样张', True)
        except Exception as error:
            check('识图样张', False, str(error)[-240:])
    else:
        check('识图样张', True)
    script = runtime / 'ocr' / 'ocr_fast.py'
    if ocr.is_file() and script.is_file() and picture.is_file() and python.is_file():
        work = runtime / 'self-test-ocr'
        if work.exists():
            shutil.rmtree(work)
        work.mkdir()
        shutil.copy(picture, work / picture.name)
        recognized = run([str(python), '-X', 'utf8', str(script), str(work), str(work), '--fast'], 180)
        written = (work / 'ocr-sample.txt').read_text(encoding='utf-8', errors='replace') if (work / 'ocr-sample.txt').is_file() else ''
        check('识图', recognized.returncode == 0 and any(token in written for token in ('来处', '识图', 'Whence', 'OCR')), written.strip() or tail(recognized.stderr))
        shutil.rmtree(work, ignore_errors=True)
    else:
        check('识图', False, '识图程序或样张还没有准备好')
    if os.environ.get('WHENCE_SKIP_TRANSCRIBE') == '1':
        lines.append('说明\t语音试转已跳过')
    elif python.is_file() and ffmpeg.is_file() and worker.is_file() and (model / 'model.bin').is_file():
        work = runtime / 'self-test-audio'
        work.mkdir(parents=True, exist_ok=True)
        wav = work / 'silence.wav'
        made = run([str(ffmpeg), '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=16000', '-t', '1', '-c:a', 'pcm_s16le', str(wav)], 60)
        heard = run([str(python), '-X', 'utf8', str(worker), '--input', str(wav), '--model', str(model), '--cpu'], 600) if made.returncode == 0 and wav.is_file() else made
        check('语音试转', heard.returncode == 0 and '"type": "result"' in heard.stdout, tail(heard.stderr or heard.stdout))
        shutil.rmtree(work, ignore_errors=True)
    else:
        check('语音试转', False, '转写程序、模型或 FFmpeg 还没有准备好')
    lines.append('说明\t翻译密钥可以稍后在来处侧栏的钥匙图标里填写，这次不作为失败。')
    report = root / '检查结果.txt'
    report.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))
    return 1 if failed else 0


def first_line(result):
    text = (result.stdout or result.stderr or '').strip().splitlines()
    return text[0][:180] if text else f'退出码 {result.returncode}'


def tail(text):
    compact = ' '.join((text or '').split())
    return compact[-240:]


if __name__ == '__main__':
    try:
        sys.exit(main())
    except subprocess.TimeoutExpired as error:
        print(f'检查超时：{error.cmd[0] if error.cmd else ""}')
        sys.exit(1)
