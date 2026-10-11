# v0.1.0 validation / 版本验证

Verified on Windows 11 with Node.js 24.20.0, using a fresh dependency installation in the standalone public source tree:

- `npm ci`: passed, including the official Electron runtime download and checksum verification. This machine required its existing network proxy for the download; proxy settings are not part of the repository.
- `npm run build`: TypeScript, frontend and native desktop build passed.
- `npm test`: 896 passed, 0 failed, 0 skipped.
- `npm run test:e2e`: passed in real Electron windows with isolated test data. Created a blank canvas; created and edited a note; edited a draft and restored a saved version; imported an image and video; verified decoded video frame advancement; exported through the native file writer; closed and reopened; checked exact content persistence and video playback after reopening. No observed window errors, unhandled rejections, page errors or console errors in this run.
- README screenshots were captured from this test workspace in light and dark mode.

Windows 11 / Node.js 24.20.0 下，独立源码目录的全新依赖安装、构建、896 项测试和真实桌面核心流程检查通过。桌面实测使用隔离资料，验证了笔记、文稿版本、图片视频、导出和重开恢复。截图来自该测试画布。

Scope: this is an MVP source release. These checks do not establish macOS/Linux support, real-world transcription accuracy, every video site's availability, or performance with very large canvases. Automated checks and visual self-review are not user acceptance or an external design award.

The public test suite excludes captured third-party article responses and private development orchestration fixtures. The public source begins with a clean history; local profiles, media libraries and internal evidence directories are not distributed.
