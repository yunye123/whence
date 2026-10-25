# 更新记录 / Changelog

本文件记录开源版的功能范围与限制。/ This file records the scope and limitations of the open-source edition.

## 未发布 / Unreleased

## 0.2.0

### 中文

- 新增：未签名的 Windows NSIS 安装包（仅 x64）和 macOS dmg（x64、arm64 各一份）。没有代码签名、Apple 公证或应用内自动更新。`npm start` 的资料仍在 `studio/.native-profile/`；安装后的资料在名为 `whence` 的用户数据目录，不与开发目录合并。
- 新增：桌面版可以把笔记、摘录、文稿和逐字稿里的英语译成简体中文。原文保留，译文写在同一张卡片或同一句字幕上。启动前设置 `CANVAS_TRANSLATE_API_KEY`，可选 `CANVAS_TRANSLATE_BASE_URL` 与 `CANVAS_TRANSLATE_MODEL`。请求的做法改编自 Zara Zhang 的 [youtube-digest](https://github.com/zarazhangrui/youtube-digest)（MIT）。
- 修复：链接卡工具栏的“打开网页”在桌面版点了没有反应。桌面版会拦截页面自行打开新窗口，现在改为通过系统浏览器打开，失败时给出提示。
- 修复：内置示例画布里，文章卡与链接卡、视频卡与剧照互相压住的问题，现在卡片之间留有间距。
- 修复：欢迎页启动时偶发的 `ResizeObserver loop completed with undelivered notifications` 报错；新增冷启动回归测试（需先构建并预览，不属于 `npm test`）。
- 修复：用鼠标拖动框选画布时界面崩溃（“界面出了错 / Maximum update depth exceeded”）。框选扫到已保存的连线时，连线的选中状态被两处代码互相改写成死循环，现在只由一处维护；新增框选回归测试 `studio/tests/marquee-select.browser.mjs`（需先启动开发服务，不属于 `npm test`）。

### English

- Add: unsigned installers — a Windows NSIS package (x64 only) and macOS dmg files (one x64, one arm64). There is no code signing, Apple notarization, or in-app auto-update. `npm start` still stores data in `studio/.native-profile/`. The installed app stores data in a user-data folder named `whence`, separate from the development profile.
- Add: the desktop app can translate English in notes, excerpts, drafts, and transcripts into Simplified Chinese. The source stays in place, and the translation is stored on the same card or transcript line. Set `CANVAS_TRANSLATE_API_KEY` before launch. `CANVAS_TRANSLATE_BASE_URL` and `CANVAS_TRANSLATE_MODEL` are optional. The request behavior is adapted from Zara Zhang's [youtube-digest](https://github.com/zarazhangrui/youtube-digest) (MIT).
- Fix: the "Open page" button on a link card did nothing in the desktop app, because the desktop shell blocks pages from opening windows themselves. It now opens in the system browser and shows a message if that fails.
- Fix: in the built-in example boards, the article card overlapped the link card, and the video card overlapped its stills. The cards now keep a gap.
- Fix: an occasional `ResizeObserver loop completed with undelivered notifications` error when the welcome screen starts. Added a cold-start regression test (it needs a build and preview first, so it is not part of `npm test`).
- Fix: dragging a selection box on the canvas crashed the app ("界面出了错" / "Maximum update depth exceeded"). When the box swept over a saved line, two pieces of code kept overwriting that line's selected state in a loop; it is now maintained in one place. Added a marquee-select regression test, `studio/tests/marquee-select.browser.mjs` (it needs the dev server running, so it is not part of `npm test`).

## 0.1.0 — MVP

### 中文

首个开源 MVP，面向文字工作者、视频博主与创意工作者。应用采用简体中文界面，提供中英文介绍与使用文档。

- 本地画布：笔记、图片、视频、连线与分组。
- 写作：文稿编辑、保存版本、插入参考与来源回查。
- 摘录：保留原文快照、来源与视频时间点，支持记录自己的理解。
- 保存与导出：本机保存、便携画布文件、桌面完整目录副本，以及 Markdown、脚本 PDF 和灵感板导出。
- 入门：文字、视频、创意三类示例画布。
- 可选媒体流程：视频链接下载、本机自动转写与逐字稿校对；需要额外工具和模型。
- 许可：项目源码 MIT；第三方字体 OFL，其他依赖保留各自许可。

**验证与限制：** Windows 11 已有实际运行验证；macOS、Linux 暂未验证。高级媒体流程尚未在全新机器上完成验证，不保证所有视频站点可用。当前没有账户、云同步、多人协作或云端 AI。容量与保存边界见[开始使用](docs/GETTING_STARTED.md#mvp-限制)。

### English

The first open-source MVP, for writers, video creators, and creative professionals. The application has a Simplified Chinese UI, with introductions and guides in Chinese and English.

- Local canvas: notes, images, videos, connections, and groups.
- Writing: draft editing, saved versions, references, and navigation back to sources.
- Excerpts: source snapshots, references, and video timestamps, with space for your own interpretation.
- Saving and export: local saving, portable canvas files, complete directory copies in the desktop app, Markdown, script PDFs, and moodboards.
- Onboarding: example canvases for writing, video, and creative work.
- Optional media workflows: video link downloads, local speech recognition, and transcript correction; additional tools and model files are required.
- Licensing: MIT for project source code; OFL for third-party fonts. Other dependencies retain their respective licenses.

**Verification and limits:** Windows 11 has been checked in actual use. macOS and Linux have not yet been verified. Advanced media workflows have not been verified on a fresh machine, and not every video site is guaranteed to work. Accounts, cloud sync, collaboration, and cloud AI are not included. See [Getting started](docs/GETTING_STARTED.en.md#mvp-limits) for capacity and saving limits.
