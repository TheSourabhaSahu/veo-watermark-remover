# Veo Watermark Remover

I am trying to create a Veo watermark remover tool that actually works, but there are still some issues with edges and overall perfection. This tool is still not perfect, but I want to make it work, so I need the help of developers to improve it.

I got this inspiration from the **Reverse Alpha Blending** technique by AllenK's repo: [GeminiWatermarkTool](https://github.com/allenk/GeminiWatermarkTool)

You can also check out the Gemini Watermark Remover on [geminiwatermarkremove.net](https://geminiwatermarkremove.net/).

---

## About the Tool

A standalone, client-side tool for removing Veo watermarks from videos and image frames using high-performance reverse alpha blending.

> **100% browser-based** — no server, no uploads, no dependencies. All processing happens locally on your machine.

## How It Works

The Veo watermark is a semi-transparent white logo composited onto every frame at a fixed position. Reverse alpha blending inverts the compositing equation to recover the original background pixel:

```
C_bg = (C_out - α · C_logo) / (1 - α)
```

Where:
- `C_out` = the watermarked pixel you see
- `C_logo` = watermark colour (white = 255)
- `α` = per-pixel watermark opacity (extracted via calibration)
- `C_bg` = the recovered original background pixel

## Features

- **Video Processing**: Frame-by-frame watermark removal with high-quality MP4/WebM export.
- **Image Frame Batching**: Process sequences of PNG/JPG frames.
- **Pre-calibrated Overlay**: Uses the standard Veo alpha map for instant results.
- **Edge Cleanup**: Adjustable radius and strength parameters to smooth the recovered area.

## Quick Start

1. Open `index.html` in any modern browser (use a local server like `npx serve` for best results).
2. Upload your video file or individual frames.
3. Adjust the **Edge Cleanup** settings if needed.
4. Click **Process & Export** and download the results.

## File Structure

```
Veo Remover/
├── index.html       # Simplified UI
├── style.css        # Design system
├── engine.js        # Reverse alpha blending engine
├── app.js           # UI & Video Processing controller
├── veo-bg-alpha.png # Default alpha map
└── README.md
```

## Privacy

All processing happens 100% in your browser. No images or videos are ever uploaded, transmitted, or stored on any server.

## License

MIT
