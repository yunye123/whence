# Getting started with whence

[简体中文](GETTING_STARTED.md) · [Back to the introduction](../README.en.md)

This guide covers **MVP 0.1.0**. The application UI is in Simplified Chinese, so the guide retains Chinese control labels alongside English explanations. Windows 11 has been checked in actual use. macOS, Linux, and video download and transcription workflows on a fresh machine have not yet been verified.

## 1. Set up and launch

Install Node.js 24 LTS with its bundled npm. Obtain the source and open a terminal at the root containing `package.json`, `studio/`, `electron/`, and `shared/`. Check your versions:

```sh
node --version
npm --version
```

Node should report `v24.x.x`. Run these commands in order, continuing only after the previous command succeeds:

```sh
npm ci
npm run build
npm start
```

`npm ci` installs dependencies from the lockfile and needs network access; the Electron download may also be affected by network restrictions. `npm run build` builds the application, and `npm start` opens the desktop window. These commands do not produce a signed installer.

To work on the source, run this from the root:

```sh
npm run dev
```

To run the project tests:

```sh
npm test
```

Browser contract tests use Playwright's bundled Chromium unless `FIELD_TEST_CHANNEL` is set, in which case they use that channel. After `npm run build`, run `npm run test:e2e` for the real desktop core-flow check. It opens isolated test windows, uses localhost port 5198, and stores temporary data and reports in the ignored `studio/output/` directory.

Daily application data lives in `studio/.native-profile/` and is not committed to Git. Export a backup before moving computers or replacing your source directory. After the first build, Windows users can also double-click `Start Whence.cmd` at the repository root.

If the Electron download fails, restore network access and retry with `npm run runtime:install`. When using a network proxy, ensure the terminal's Node.js process can also reach GitHub.

Passing tests does not establish compatibility with every video site, hardware configuration, or operating system.

## 2. Start with an example canvas

Choose the welcome screen entry closest to your work:

| Entry | Try this first |
| --- | --- |
| 我写文章 — I write | Open a source, see how an excerpt is used in a draft, and follow it back. |
| 我做视频 — I make videos | Open the example transcript, click a timestamp, and inspect a reference in the script. |
| 我做创意 — I do creative work | Explore images and notes, move cards, and organize references into groups. |

The examples demonstrate interaction. Their transcripts are not results from a verified automatic transcription run. Choose “从空白画布开始” (Start with a blank canvas) when you are ready to make your own project.

## 3. Collect, excerpt, and write

1. **Collect sources.** Add notes, or import or drag in images, videos, TXT, and Markdown files. Text is imported as body content; layouts from formats such as Word are not preserved.
2. **Keep the source.** Select text in the reading panel or video transcript, then use “摘录到画布” (Add excerpt to canvas). Video excerpts keep timestamps; text excerpts keep a snapshot and source reference.
3. **Add your interpretation.** Write your observations in “我的理解” (My interpretation), then organize the material with connections and groups. Source text and your own interpretation remain separate.
4. **Develop a draft.** Create a draft, write, insert references, and save a version when you want to keep a particular stage. Autosaving and explicitly saving a version serve different purposes.
5. **Check the original.** Follow a reference or use “本稿来源” (Sources in this draft) to return to the source. Video references can locate the relevant timestamp. Use “返回文稿” (Return to draft) to resume writing.

A web link card stores only the URL and the text you pasted. It does not fetch the page body. Importing a public X post in the desktop app requests `api.fxtwitter.com`. Images are accepted only from `pbs.twimg.com`.

Later edits to a source or transcript do not automatically rewrite existing excerpt snapshots. A snapshot can remain after its source is removed, but the original material may no longer be available to revisit.

## Saving and exporting

Content is stored locally. Watch the save status: if saving fails, do not assume the current content has been backed up. Desktop and browser workspaces may be separate and do not automatically sync.

Open “导出” (Export) and choose an output for your purpose:

| Export option | Purpose and scope |
| --- | --- |
| 便携画布文件 — Portable canvas file (`.field.json`) | Keeps layout, connections, text, versions, and media within the size limits. Import it again to continue editing. |
| 另存完整画布目录 — Save a complete canvas directory | Saves a separate directory copy in the desktop app, suitable for large videos. The source media must be readable during export. |
| 文稿与参考资料 — Drafts and references (Markdown) | Exports drafts, notes, and excerpts with references as footnotes. It does not replace a complete canvas backup. |
| 分镜脚本 — Storyboard script (PDF) | Exports a selected draft as a script for reading, printing, or delivery. |
| 灵感板 — Moodboard (PNG / PDF) | Arranges images into a visual reference you can share. |

Check the success message and open the exported file. For a canvas backup, reopen it and confirm that text and key media can be read. A filename alone does not establish that the backup is complete. Confirm you have a usable copy before clearing application or browser data.

## Windows setup folder

From the repository root, `npm run package:win` builds 来处 and places Python, FFmpeg, the speech model, and image-text recognition in `output/windows-setup/来处/`. Give away the whole folder. The recipient double-clicks 「安装并检查.cmd」. It checks the app, speech transcription, and image text, and adds a desktop shortcut when one is not already there. The translation key can be entered later in the sidebar. Canvases are stored in that folder’s `profile`.

## Optional: video downloads and local transcription

Basic notes, writing, and canvas organization do not require Python. Video link downloads and automatic speech recognition need additional tools and use the desktop entry point.

| Dependency | Purpose |
| --- | --- |
| Python 3.12 | Runs download and transcription tools. |
| `yt-dlp` | Retrieves media from video links. |
| `faster-whisper` | Performs local speech recognition. |
| FFmpeg and ffprobe | Process media and inspect its metadata. Both executables are required. |
| A local Whisper model | Supplies the model files for transcription. These are not included in the source repository. |

Python packages must be installed in the environment the application actually uses. Set the locations under “本机工具” in the sidebar. Saving takes effect immediately and does not require a restart. A blank field uses the environment variable below; if that is also unset, the computer’s default location is used. Set environment variables before launch:

| Variable | What it points to |
| --- | --- |
| `CANVAS_PYTHON` | The Python executable. |
| `CANVAS_FFMPEG` | The FFmpeg executable. |
| `CANVAS_FFPROBE` | The ffprobe executable. |
| `CANVAS_MODEL` | A local model directory compatible with `faster-whisper`. |

When these variables are unset, Windows keeps the AppData defaults for Python 3.12, FFmpeg, and ffprobe. macOS and Linux default to `python3`, `ffmpeg`, and `ffprobe`. On every system the model directory defaults to `~/.cache/faster-whisper/large-v3`. Non-Windows systems are no longer blocked by a hard-coded `.exe` path. That does not mean video download or transcription has been verified on macOS or Linux.

Install and configure these dependencies separately: `npm ci` does not install Python tools or download a model. Model size, processing speed, and available compute devices depend on your environment. This workflow has not yet been verified end to end on a fresh machine.

Once configured, submit a link through “导入 → 视频链接” (Import → Video link), then follow the interface to download and transcribe. Review and correct automatically recognized text. You can also organize existing subtitles. Downloads contact the source site; login requirements, access restrictions, expired links, or deleted content can prevent retrieval. Not every site is guaranteed to work. If a download fails, keep the source link and check the reason shown on its task card.

## Optional: translate English into Chinese

English in notes, excerpts, drafts, and video transcripts can be translated into Simplified Chinese in the desktop app. The source stays where it is. The translation is stored on the same card or the same transcript line. Opening the app in a browser does not offer this. After a transcript is translated, it can switch between the original and the Chinese script, and it opens on the Chinese script. Excerpts placed on the canvas prefer the Chinese line; a line without a translation keeps its original sentence.

Open “翻译密钥” at the bottom of the sidebar, enter the API key, and save. The key is encrypted with the operating system and kept in this computer’s 来处 profile. It is not written into a canvas or an export. Saving does not require a restart. Leave the address and model empty to use the defaults below.

The environment variables still work when nothing has been saved in the app. A key saved in the app takes priority.

| Variable | Purpose |
| --- | --- |
| `CANVAS_TRANSLATE_API_KEY` | Used when no key has been saved in the app. |
| `CANVAS_TRANSLATE_BASE_URL` | Optional. Defaults to `https://api.deepseek.com`. A full URL that already ends in `/chat/completions` is also accepted, and the same value can be entered under “翻译密钥”. Do not put the key in the URL. |
| `CANVAS_TRANSLATE_MODEL` | Optional. Defaults to `deepseek-v4-flash`. It can also be entered under “翻译密钥”. |

The values below are placeholders. Do not commit a real key:

```sh
export CANVAS_TRANSLATE_API_KEY="your-key"
export CANVAS_TRANSLATE_BASE_URL="https://api.deepseek.com"
export CANVAS_TRANSLATE_MODEL="deepseek-v4-flash"
```

Windows PowerShell:

```powershell
$env:CANVAS_TRANSLATE_API_KEY="your-key"
```

English content shows “译成中文”. A partial translation offers “继续翻译”. A finished translation can be requested again with “重新翻译”. Chinese content does not show the button. An excerpt keeps its English snapshot. When the card has no separate “我的理解”, the card shows “译文”. If the key is missing or the request fails, the source stays unchanged and the reason is shown.

## MVP limits

- No accounts, cloud sync, or collaboration. English-to-Chinese translation is optional and calls out only after the desktop app is given an API key. There is no built-in cloud account. Automatic speech recognition is optional local processing.
- Starting the desktop app again returns to the window that is already open. Read-only applies only to a second page from the same origin, for example two browser tabs on the same workspace: the later page is read-only. Close the page that is editing, then reload the other page before editing.
- Up to 500 cards and 1,500 connections per canvas, 100 canvases per workspace, and 100 saved versions per draft.
- Portable canvas files are limited to 96 MiB, with up to 64 MiB per media item and 68 MiB of total binary media. These are portable file limits, not universal limits on all media. Use complete directory export in the desktop app when needed.
- TXT / Markdown imports are limited to 100,000 characters and 1 MB. Groups organize the canvas; they are not permanent nested grouping entities.
- Transcript correction works on sentence segments and does not provide word-level timing edits. Check speech recognition accuracy against your actual material.

## Troubleshooting

| Symptom | Check first |
| --- | --- |
| `node` or `npm` is not found | Finish installing Node.js, reopen the terminal, and check the versions. |
| `npm ci` fails | Confirm the repository root, Node 24, and network access for dependency downloads. Keep the actual error output. |
| `npm start` fails | Confirm that `npm run build` succeeded, then inspect the terminal error. |
| The canvas is read-only | Check whether another browser tab has the same workspace open. Starting the desktop app again returns to the existing window. |
| Downloads or transcription fail | Open “本机工具” in the sidebar, fill in Python, FFmpeg, ffprobe, and the speech-model directory, then choose “检查”. Also read the reason on the task card. |
| English translation fails | Check that a key is saved under “翻译密钥”, or that the environment variable was set before launch, and that the base URL, model, and the reason shown in the interface are right. Do not send the key to anyone. |
| Portable export exceeds its limit | Use “另存完整画布目录” in the desktop app and confirm that the media is still readable. |

When reporting a problem, include the version, operating system, steps, expected result, and actual error. Remove personal paths, private content, and credentials from screenshots and logs.
