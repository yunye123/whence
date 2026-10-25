"""FIELD local ASR worker. stdout is UTF-8 JSONL; never modifies source media/models.

FIELD's own copy of the legacy ../../workers/transcribe.py (that file stays with the older app and is not changed).
The only difference is punctuation for Chinese speech (CORE-06): faster-whisper writes Chinese without any
punctuation unless the decoder sees punctuated text first, so when the speech is Chinese the worker
- passes a short simplified-Chinese sentence with full punctuation as initial_prompt;
- keeps the small-form marks (﹑ ﹐) Whisper sometimes writes on the word before them, like the other marks, so
  they never become words of their own that take time from the speech;
- writes Western marks between Chinese words as Chinese ones (, ? ! ; : -> ，？！；：), except inside numbers.
Every other parameter (word timestamps, VAD, beam size, GPU fallbacks, output shape) is the legacy one. The prompt is
never part of the result: a segment that only repeats it (Whisper may echo its prompt over noise or music) is dropped.
On some clips the same prompt makes Whisper write the fixed non-speech line "请不吝点赞…明镜与点点栏目"
instead of the soundtrack. That pass is thrown away and the clip is transcribed again without the prompt.
"""
import argparse
import gc
import json
import os
import re
import sys
import time
import traceback

# Read by Whisper as "the text before this audio". Compared on the 2:41 talking-head sample with an example
# dialogue and two casual openers, this one gave punctuation in every segment and changed the fewest words.
PUNCTUATION_PROMPT = "以下是一段普通话口语，使用简体中文，并带有逗号、句号、问号等标点符号。"
PROMPT_LANGUAGES = {"zh", "yue"}
# faster-whisper's default list plus the small forms and semicolons it would otherwise leave as separate words.
APPEND_PUNCTUATIONS = "\"'.。,，!！?？:：”)]}、﹑﹐；;"
CHINESE_MARKS = {",": "，", "﹐": "，", "﹑": "，", "?": "？", "!": "！", ";": "；", ":": "："}
MARK_PATTERN = re.compile(r"[,﹐﹑?!;:]")


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def chinese_marks(text):
    """, ? ! ; : (and the small forms) as Chinese marks; a comma or colon between two digits (1,000 / 10:30) stays."""
    def swap(match):
        at, mark = match.start(), match.group(0)
        if mark in ",:" and 0 < at < len(text) - 1 and text[at - 1].isdigit() and text[at + 1].isdigit():
            return mark
        return CHINESE_MARKS[mark]
    return MARK_PATTERN.sub(swap, text)


def plain(text):
    """Letters and digits only, for comparing a segment with the prompt."""
    return re.sub(r"[\W_]+", "", text or "", flags=re.UNICODE)


PROMPT_PLAIN = plain(PUNCTUATION_PROMPT)


def echoes_prompt(text):
    """True when the segment is only (a part of) the prompt, e.g. "以下是一段普通话口语。"."""
    value = plain(text)
    return len(value) >= 4 and value in PROMPT_PLAIN


def known_hallucination(text):
    """Whisper's fixed Chinese non-speech line, including the same line repeated in one segment."""
    value = plain(text)
    return "明镜与点点" in value or "请不吝点赞" in value


def decode(pipeline, audio, batch, language, prompt, apply_marks, offset):
    options = {"append_punctuations": APPEND_PUNCTUATIONS} if apply_marks else {}
    if prompt:
        options["initial_prompt"] = prompt
    iterator, info = pipeline.transcribe(
        audio, batch_size=batch, language=language, word_timestamps=True, vad_filter=True, beam_size=5, **options)
    segments = []
    dropped = 0
    saw_hallucination = False
    for i, segment in enumerate(iterator):
        if known_hallucination(segment.text):
            saw_hallucination = True
            dropped += 1
            continue
        if prompt and echoes_prompt(segment.text):
            dropped += 1
            continue
        words = [{"id": f"s{i}-w{j}", "text": chinese_marks(w.word) if apply_marks else w.word,
                  "startMs": round(w.start * 1000) + offset,
                  "endMs": round(w.end * 1000) + offset,
                  "probability": w.probability}
                 for j, w in enumerate(segment.words or [])]
        text = segment.text
        if apply_marks:
            # Whisper's words spell the segment text exactly; rebuilding the text from the converted words
            # keeps the two identical, which the reading-line split relies on.
            joined = "".join(w.word for w in segment.words or [])
            text = "".join(w["text"] for w in words) if words and joined == segment.text else chinese_marks(text)
        # Whisper may attach punctuation to zero-duration units. Do not invent
        # word timing: keep the full source sentence as the selectable fallback.
        if any(w["startMs"] < 0 or w["endMs"] <= w["startMs"] for w in words):
            words = []
        segments.append({"id": f"s{i}", "text": text,
                         "startMs": round(segment.start * 1000) + offset,
                         "endMs": round(segment.end * 1000) + offset,
                         "words": words})
        emit({"type": "progress", "progress": min(0.98, segment.end / max(info.duration, 1)),
              "message": f"已转写到 {segment.end:.1f} 秒"})
    return segments, info, dropped, saw_hallucination


def run(args):
    from faster_whisper import BatchedInferencePipeline, WhisperModel
    from faster_whisper.audio import decode_audio
    started = time.monotonic()
    audio = decode_audio(args.input, sampling_rate=16000)
    timings = {"decodeAudio": round(time.monotonic() - started, 3)}
    attempts = [("cpu", "int8", 1)] if args.cpu else [
        ("cuda", "float16", 8), ("cuda", "float16", 2),
        ("cuda", "float16", 1), ("cpu", "int8", 1)]
    last_error = None
    for device, precision, batch in attempts:
        model = pipeline = iterator = None
        try:
            emit({"type": "progress", "progress": 0.02,
                  "message": f"加载本机模型：{device} / batch {batch}"})
            step = time.monotonic()
            model = WhisperModel(args.model, device=device, compute_type=precision,
                                 local_files_only=True)
            pipeline = BatchedInferencePipeline(model=model)
            timings["loadModel"] = round(time.monotonic() - step, 3)
            language = None
            prompt = None
            if not args.no_punctuation_prompt and model.model.is_multilingual:
                # The same speech-only detection the batched pipeline would run itself, done first so the prompt is
                # only given to Chinese speech (a Chinese example could pull other languages towards Chinese).
                step = time.monotonic()
                language, _, _ = model.detect_language(audio, vad_filter=True)
                timings["detectLanguage"] = round(time.monotonic() - step, 3)
                if language in PROMPT_LANGUAGES:
                    prompt = PUNCTUATION_PROMPT
            apply_marks = bool(prompt)
            step = time.monotonic()
            segments, info, dropped, saw_hallucination = decode(
                pipeline, audio, batch, language if prompt else None, prompt, apply_marks, args.offset_ms)
            retried = False
            if prompt and saw_hallucination:
                emit({"type": "progress", "progress": 0.05,
                      "message": "标点提示让这段口播写成了固定错句，正在不带提示重转"})
                segments, info, dropped_again, _again = decode(
                    pipeline, audio, batch, language, None, apply_marks, args.offset_ms)
                dropped += dropped_again
                retried = True
                prompt = None
            timings["transcribe"] = round(time.monotonic() - step, 3)
            emit({"type": "result", "engine": "faster-whisper/" + os.path.basename(os.path.normpath(args.model)),
                  "device": device, "elapsedSeconds": round(time.monotonic() - started, 3),
                  "language": info.language, "punctuationPrompt": bool(prompt), "droppedPromptEchoes": dropped,
                  "retriedWithoutPrompt": retried, "timings": timings, "segments": segments})
            return
        except Exception as error:
            last_error = error
            detail = str(error)
            retryable = any(s in detail.lower() for s in
                           ["cuda", "cudnn", "cublas", "out of memory", "gpu", "float16"])
            if device == "cpu" or not retryable:
                raise
            emit({"type": "progress", "progress": 0,
                  "message": f"GPU 尝试失败，降低负载重试：{detail[-500:]}"})
        finally:
            iterator = pipeline = model = None
            gc.collect()
    raise last_error or RuntimeError("转写未完成")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--offset-ms", type=int, default=0)
    parser.add_argument("--cpu", action="store_true")
    # Only for side-by-side checks against the legacy behaviour; the app never passes it.
    parser.add_argument("--no-punctuation-prompt", action="store_true")
    try:
        run(parser.parse_args())
    except Exception as error:
        emit({"type": "error", "message": str(error)[-2000:]})
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
