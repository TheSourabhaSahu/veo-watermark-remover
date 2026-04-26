# Veo Watermark Remover

A standalone, client-side tool for removing Veo watermarks from video frames using **reverse alpha blending**.

> **100% browser-based** — no server, no uploads, no dependencies. Just open `index.html`.

## How It Works

The Veo watermark is a semi-transparent white logo composited onto every frame at a fixed position (bottom-right). Reverse alpha blending inverts the compositing equation to recover the original pixel:

```
C_bg = (C_out - α · C_logo) / (1 - α)
```

Where:
- `C_out` = the watermarked pixel you see
- `C_logo` = watermark colour (white = 255)
- `α` = per-pixel watermark opacity (extracted via calibration)
- `C_bg` = the recovered original background pixel

## Two Processing Modes

### 1. All Frames (Single-Frame Calibration)

Upload **one dark/black calibration frame** where the watermark is clearly visible against the dark background. The tool extracts the per-pixel alpha map from this single frame, then applies reverse alpha blending to every target frame you upload.

**Best for:** Videos where you have at least one near-black frame.

### 2. Veo Fixed Overlay (Paired Calibration)

Upload matched **clean + watermarked frame pairs** (same frame, with and without the watermark). The tool computes a precise per-pixel alpha map by comparing them, then uses that overlay to remove the watermark from any frame.

**Best for:** Maximum accuracy, works on any background colour.

## Quick Start

1. Open `index.html` in any modern browser
2. Choose a processing mode (All Frames or Fixed Overlay)
3. Upload your calibration material and target frames
4. Click "Process" and download the cleaned results

## File Structure

```
Veo Remover/
├── index.html    # Main page
├── style.css     # Design system
├── engine.js     # Reverse alpha blending engine (pure JS, zero deps)
├── app.js        # UI controller
├── .gitignore
├── LICENSE
└── README.md
```

## Default Watermark Geometry

| Parameter     | Default | Description                           |
|---------------|---------|---------------------------------------|
| Logo Width    | 94 px   | Width of the Veo watermark region     |
| Logo Height   | 40 px   | Height of the Veo watermark region    |
| Right Margin  | 28 px   | Distance from the right edge          |
| Bottom Margin | 31 px   | Distance from the bottom edge         |
| Edge Radius   | 3 px    | Neighbourhood radius for edge cleanup |
| Edge Strength | 0.68    | Blending weight for edge smoothing    |

These can be adjusted in the tool's settings panel.

## Technology

- **Pure HTML/CSS/JS** — no build step, no Node.js, no npm
- **Canvas 2D API** — pixel-level manipulation via `ImageData`
- **Float32Array** — efficient alpha mask computation
- **Integral images** — fast summed-area table for auto-detection (Fixed Overlay mode)

## Privacy

All processing happens 100% in your browser. No images are uploaded, transmitted, or stored anywhere. The tool works completely offline after the initial page load.

## License

MIT — See [LICENSE](./LICENSE)
