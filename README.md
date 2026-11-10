<p align="center">
  <img src="web/mark-clean.png" width="104" alt="Janna logo">
</p>

<h1 align="center">Janna AI</h1>

<p align="center"><strong>A local AI workspace for building things.</strong></p>
<p align="center">Chat, write code, explore a project, and keep the work on your machine.</p>

<p align="center">
  <a href="https://github.com/JepongDevxyz/Janna-AI/releases"><img alt="Latest release" src="https://img.shields.io/badge/release-1.6.0-c48e96"></a>
  <a href="LICENSE"><img alt="Code license: MIT" src="https://img.shields.io/badge/code-MIT-52637a"></a>
  <a href="https://github.com/JepongDevxyz/Janna-AI/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/JepongDevxyz/Janna-AI/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <img alt="Windows x64" src="https://img.shields.io/badge/desktop-Windows_x64-52637a">
</p>

<p align="center">
  <a href="https://github.com/JepongDevxyz/Janna-AI/releases/tag/v1.6.0"><strong>Download Janna AI</strong></a> ·
  <a href="docs/GETTING-STARTED.md">Getting started</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="https://github.com/JepongDevxyz/Janna-AI/issues">Issues</a>
</p>

## Meet Janna AI

Janna AI is an open-source Windows workspace for local AI chat and coding. It brings your model, project files, coding tools and research into a quiet desktop interface, with saved conversations and visible task progress.


**Janna Pro 1.1** is the full local model profile. **Janna Lite 1.1** offers a smaller profile for machines with less memory. **Luna** is Janna's pet companion — a little star cat who lives in the companion panel, reacts to your work, and chats in her own persona.

## What you can do

- **Talk through an idea.** Get clear explanations, keep local notes, and return to saved conversations.
- **Work in a real project.** Use the separately installed OpenCode engine for edits and commands, with live activity, cancellation and saved run history.
- **Check changes with the real build.** Opt-in [Verified build](docs/VIBE-CODING.md) has Janna Pro edit a project, run its own build and tests, and repair from the errors, then labels how far the result was actually checked.
- **Explore source.** Search local symbols and inspect bounded, commit-pinned GitHub excerpts using your existing GitHub CLI login.
- **Investigate engineering problems.** Use optional compiler, shader and binary-analysis tools. Review evidence and test results alongside the answer.
- **Choose your working style.** Change themes, language, model settings and Luna companions. Code blocks and references stay accessible.
- **Connect optional services.** Configure research providers, Figma MCP, a project Discord bot or private phone access when you need them.

![Luna companions](docs/images/luna.jpg)

## Get started

Download the **Windows x64** ZIP from [Releases](https://github.com/JepongDevxyz/Janna-AI/releases/tag/v1.6.0), extract it completely, and open `Janna.exe`. The portable desktop requires **Windows 10/11 x64, Python 3.11+ and Microsoft Edge WebView2**. The .NET runtime is included in the desktop executable.

Use **Set up Janna Pro 1.1** in the app, or `SETUP-JANNA-PRO.cmd`, to configure local inference. Setup downloads the separate inference engine and model when needed. For a smaller model, use `SETUP-JANNA-LITE.cmd`. Coding mode also needs the separately installed OpenCode CLI.

For a source-based installation that installs missing prerequisites and builds the desktop, download the **Source** ZIP and run `REPAIR-Janna.cmd`. Read the [setup guide](docs/GETTING-STARTED.md) for downloads, requirements and troubleshooting.

| Profile | Intended hardware | Base-model download |
| --- | --- | --- |
| Janna Pro 1.1 | 16 GB GPU memory and 32 GB system RAM recommended | About 8.3 GB |
| Janna Lite 1.1 | Smaller-memory systems; intended for 8 GB GPUs | About 3.2 GB |

Actual memory use varies with context and workload. Janna Pro was tested on an RTX 4060 Ti 16 GB; the 8 GB Janna Lite target still needs physical-device qualification. Janna Pro and Janna Lite are application profiles over separately downloaded Bonsai models, not newly trained foundation models.

## Local by default

Conversations, settings and project notes are stored under `~/.janna`. Model inference uses your local Ollama service. Web research, GitHub, optional integrations, dependency downloads and some browser voice services can contact external services. Their own authentication and terms apply. See [privacy and security](SECURITY.md).

Janna is early software. Model answers can be wrong; review edits and run relevant tests. Phone, integration and extended autonomous-run qualification is incomplete. The [release status](docs/RELEASE-STATUS.md) separates tested behavior from remaining work.

## Web edition (Vercel)

Janna AI also runs as a hosted web app, shaped like Fable AI: the same `web/`
UI served as a static site, plus one serverless function (`api/[...slug].js`)
that answers the chat protocol (`POST /api/run`, canonical SSE) from cloud
models. Conversations and settings stay in the visitor's browser
(`web/web-adapter.js`, guest mode); project files, coding tools, local model
setup and other PC features remain desktop-only and say so honestly in the UI.

Deploy: import this repository in Vercel — no build command, output
directory `web` (preset in `vercel.json`). The default model (Janna Cloud)
works with no keys. Optional provider key pools (comma-separated, rotated
per request, Fable-style) via environment variables: `GROQ_API_KEYS`,
`GEMINI_API_KEYS`, `OPENROUTER_API_KEYS`, `MISTRAL_API_KEYS`,
`COHERE_API_KEYS`. Setting a pool adds its model to the picker.

## Build and contribute

The backend uses the Python standard library; the UI uses plain HTML, CSS and JavaScript. The Windows host uses .NET 10, WinForms and WebView2.

```sh
git clone https://github.com/JepongDevxyz/Janna-AI.git
cd Janna-AI
python -m janna --no-browser --port 8765
```

Open `http://127.0.0.1:8765` for the browser UI. On Windows with the .NET 10 SDK, build the native app with `scripts/Build-Windows-EXE.ps1`. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and project structure.

## Documentation

- [Getting started and troubleshooting](docs/GETTING-STARTED.md)
- [Release status and known limitations](docs/RELEASE-STATUS.md)
- [Engineering tools](docs/ENGINEERING-TOOLS.md)
- [Verified build](docs/VIBE-CODING.md)
- [Janna Pro setup](docs/SETUP-JANNA-PRO.md) and [engineering guide](docs/JANNA PRO-ENGINEERING.md)
- [Private iPhone access](docs/REMOTE-IPHONE.md)
- [Changelog](CHANGELOG.md)

## License

Janna AI application code is available under the [MIT License](LICENSE). The logo and character artwork have separate [branding terms](BRANDING.md). Third-party components and model profiles retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md). No model weights, AI engine executables, credentials or game content are bundled.
