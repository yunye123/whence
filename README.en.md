# 来处 whence

**Turn what you collect into work of your own.**

[简体中文](README.md) · [Getting started](docs/GETTING_STARTED.en.md) · [Changelog](CHANGELOG.md)

whence is a local creative canvas for writers, video creators, and creative professionals. Keep text, images, and video together, extract useful passages, connect ideas, and develop a draft. Excerpts retain their sources so you can return to the original text or video timestamp while writing.

The current version is **0.2.0**. The application UI is in **Simplified Chinese**. English documentation does not imply an English interface.

![whence in light mode: sources, excerpts, and drafts in one workspace](docs/images/canvas-light.png)

## What you can do

| Your work | What the canvas supports |
| --- | --- |
| Writing | Collect sources, extract passages, add your own notes, and write drafts with saved versions. |
| Video creation | Organize video and transcripts, extract passages by timestamp, and develop a script. |
| Creative work | Arrange images and notes, connect references, and organize groups into a moodboard. |

Core features include notes, drafts and saved versions, image and video references, source excerpts, connections and groups, and canvas saving and export. Some exports preserve an editable canvas; others deliver written work. See [Saving and exporting](docs/GETTING_STARTED.en.md#saving-and-exporting) for the differences.

The welcome screen offers three example canvases: “我写文章” (I write), “我做视频” (I make videos), and “我做创意” (I do creative work). You can also start with a blank canvas. Example transcripts are demonstration content, not evidence of speech recognition accuracy.

<details>
<summary>View the dark canvas</summary>

![whence in dark mode](docs/images/canvas-dark.png)

</details>

## Run from source

Use **Node.js 24 LTS** with its bundled npm. After obtaining and extracting the source, open a terminal at the repository root, alongside `package.json`, and run these commands in order:

```sh
npm ci
npm run build
npm start
```

Development mode and tests also run from the repository root:

```sh
npm run dev
npm test
```

The application has been run from source and checked on Windows 11. macOS and Linux have not yet been verified. The commands above run the source. `npm run build` itself is not an installer. Unsigned Windows NSIS and macOS dmg packages, and the system prompts on first open, are in [Getting started](docs/GETTING_STARTED.en.md#unsigned-installers).

## Local use and MVP limitations

- Content is stored on your computer. No account is required. Cloud sync and collaboration are not included. English-to-Chinese translation is optional and calls an external API only after the desktop app is given an API key. See the [getting started guide](docs/GETTING_STARTED.en.md#optional-translate-english-into-chinese).
- Local saving is not an independent backup. Check the save status, export your canvas regularly, and verify that the export includes your media.
- Starting the desktop app again returns to the window that is already open. Read-only applies only to a second page from the same origin, such as two browser tabs on one workspace. Portable canvas files have size limits; use the desktop app's “另存完整画布目录” (Save a complete canvas directory) for large videos.
- Video link downloads and automatic speech recognition are optional advanced workflows. They require Python 3.12, `yt-dlp`, `faster-whisper`, FFmpeg, ffprobe, and a local model. Basic canvas use does not require these tools.
- Advanced workflows have not been verified end to end on a fresh machine. Site login requirements, access restrictions, and link availability can prevent downloads. Not every site or link is guaranteed to work.

See [MVP limits](docs/GETTING_STARTED.en.md#mvp-limits) for capacity and workflow details.

## Source layout

```text
package.json       Root commands and dependencies
studio/
  src/             UI and canvas logic
  native/          Local services
  public/          Static assets
  tests/           Tests
  scripts/         Launch, build, and check scripts
electron/          Desktop and media processing support
shared/            Types only
docs/              Guides and screenshots
```

The code retains `field` identifiers and the `.field.json` extension for data compatibility. The product name is 来处 whence.

## License

Project source code is licensed under [MIT](LICENSE). Third-party fonts use the SIL Open Font License (OFL) and retain their own copyright and license notices; distributing them with whence does not relicense them under MIT. Other third-party dependencies retain their respective licenses. See [third-party notices](studio/THIRD_PARTY_NOTICES.txt) and [asset provenance](docs/ASSETS.md).
