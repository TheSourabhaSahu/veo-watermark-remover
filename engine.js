/**
 * engine.js — Reverse Alpha Blending Engine (pure browser, no dependencies)
 *
 * Implements two modes:
 *   1. All Frames:     Extract alpha from a single dark calibration frame
 *   2. Fixed Overlay:  Derive alpha from clean/watermarked pairs
 *
 * Both then apply reverse alpha blending + edge cleanup to recover the
 * original background beneath the Veo watermark.
 *
 * Math:  C_bg = (C_out - α · C_logo) / (1 - α)
 */

"use strict";

const VeoEngine = (() => {

  /* ── Helpers ──────────────────────────────────────────────── */

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const clampByte = (v) => Math.min(255, Math.max(0, Math.round(v)));
  const idx = (x, y, w) => (y * w + x) * 4;

  /**
   * Load an image File/Blob into raw RGBA pixel data via an offscreen canvas.
   * Returns { data: Uint8ClampedArray, width, height }
   */
  function loadImageData(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ data: imageData.data, width: c.width, height: c.height });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
      img.src = url;
    });
  }

  /**
   * Compute the crop rect for the watermark region given the image dimensions
   * and known geometry (bottom-right anchor).
   */
  function cropRect(imgW, imgH, logoW, logoH, marginRight, marginBottom) {
    return {
      x: imgW - marginRight - logoW,
      y: imgH - marginBottom - logoH,
      w: logoW,
      h: logoH,
    };
  }

  /* ── All Frames Mode ─────────────────────────────────────── */

  /**
   * Extract the per-pixel alpha map from a single dark/black calibration frame.
   * Assumes the watermark is white text on a near-black background.
   */
  function extractAlphaFromCalibration(frameData, frameW, frameH, rect) {
    const { x: x0, y: y0, w: logoW, h: logoH } = rect;

    // Estimate background brightness from a ring around the watermark
    const ring = 14;
    let bgSum = 0, bgCount = 0;
    const yStart = Math.max(0, y0 - ring);
    const yEnd   = Math.min(frameH, y0 + logoH + ring);
    const xStart = Math.max(0, x0 - ring);
    const xEnd   = Math.min(frameW, x0 + logoW + ring);

    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) {
        if (x >= x0 && x < x0 + logoW && y >= y0 && y < y0 + logoH) continue;
        const i = idx(x, y, frameW);
        const brightness = Math.max(frameData[i], frameData[i + 1], frameData[i + 2]) / 255;
        bgSum += brightness;
        bgCount++;
      }
    }
    const background = bgCount > 0 ? bgSum / bgCount : 0;
    const noiseFloor = 0.01;

    const alpha = new Float32Array(logoW * logoH);
    for (let ly = 0; ly < logoH; ly++) {
      for (let lx = 0; lx < logoW; lx++) {
        const si = idx(x0 + lx, y0 + ly, frameW);
        const brightness = Math.max(frameData[si], frameData[si + 1], frameData[si + 2]) / 255;
        const normalized = (brightness - background) / Math.max(0.001, 1 - background);
        alpha[ly * logoW + lx] = clamp01(normalized - noiseFloor);
      }
    }
    return alpha;
  }

  /* ── Fixed Overlay Mode ──────────────────────────────────── */

  function estimateMasksFromPair(clean, watermarked, rect) {
    const { x: x0, y: y0, w, h } = rect;
    const alpha  = new Float32Array(w * h);

    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const si = idx(x0 + lx, y0 + ly, clean.width);
        const cR = clean.data[si],   cG = clean.data[si + 1], cB = clean.data[si + 2];
        const wR = watermarked.data[si], wG = watermarked.data[si + 1], wB = watermarked.data[si + 2];

        const cleanMax = Math.max(cR, cG, cB) / 255;
        const dR = (wR - cR) / 255;
        const dG = (wG - cG) / 255;
        const dB = (wB - cB) / 255;
        const brightDelta = Math.max(dR, dG, dB);

        const oi = ly * w + lx;
        alpha[oi]  = clamp01(brightDelta / Math.max(0.04, 1 - cleanMax));
      }
    }
    return { alpha };
  }

  /**
   * Auto-detect the best watermark rectangle in the bottom-right search area
   * by building a summed-area table of pixel-difference energy.
   */
  function detectBestRect(clean, watermarked, settings) {
    const imgW = clean.width, imgH = clean.height;
    const searchW = Math.min(settings.searchWidth  || 320, imgW);
    const searchH = Math.min(settings.searchHeight || 220, imgH);
    const searchX = imgW - searchW;
    const searchY = imgH - searchH;
    const pad = 2;
    const minConfidence = settings.minConfidence || 0.42;

    // Build integral image of squared diff energy
    const integral = new Float64Array((searchW + 1) * (searchH + 1));
    let totalEnergy = 0, changedPixels = 0;

    for (let y = 0; y < searchH; y++) {
      let rowSum = 0;
      for (let x = 0; x < searchW; x++) {
        const ix = searchX + x, iy = searchY + y;
        const si = idx(ix, iy, imgW);
        const diff = Math.max(
          Math.abs(watermarked.data[si]     - clean.data[si]),
          Math.abs(watermarked.data[si + 1] - clean.data[si + 1]),
          Math.abs(watermarked.data[si + 2] - clean.data[si + 2])
        ) / 255;
        const energy = diff < 0.018 ? 0 : diff * diff;
        if (energy > 0) changedPixels++;
        rowSum += energy;
        totalEnergy += energy;
        integral[(y + 1) * (searchW + 1) + (x + 1)] =
          integral[y * (searchW + 1) + (x + 1)] + rowSum;
      }
    }

    if (changedPixels < 80 || totalEnergy <= 0) return null;

    const iSum = (x, y, w, h) => {
      const stride = searchW + 1;
      const x1 = Math.max(0, Math.min(searchW, x));
      const y1 = Math.max(0, Math.min(searchH, y));
      const x2 = Math.max(0, Math.min(searchW, x + w));
      const y2 = Math.max(0, Math.min(searchH, y + h));
      return integral[y2 * stride + x2] - integral[y1 * stride + x2]
           - integral[y2 * stride + x1] + integral[y1 * stride + x1];
    };

    let best = null;
    // Search over plausible sizes and positions
    for (let w = 78; w <= 140; w += 4) {
      for (let h = 34; h <= 90; h += 4) {
        for (let mr = 0; mr <= 42; mr += 2) {
          for (let mb = 0; mb <= 42; mb += 2) {
            const rect = cropRect(imgW, imgH, w, h, mr, mb);
            const lx = rect.x - searchX, ly = rect.y - searchY;
            if (lx < 0 || ly < 0) continue;

            const inside = iSum(lx, ly, w, h);
            const padded = iSum(lx - pad, ly - pad, w + pad * 2, h + pad * 2);
            const capture = inside / Math.max(1e-9, totalEnergy);
            const localCapture = inside / Math.max(1e-9, padded);
            const expectedArea = 94 * 40;
            const areaPenalty = Math.sqrt(expectedArea / Math.max(expectedArea, w * h));
            const confidence = capture * 0.72 + localCapture * 0.2 + areaPenalty * 0.08;

            if (!best || confidence > best.confidence) {
              best = { rect, margins: { right: mr, bottom: mb }, confidence, capture, localCapture };
            }
          }
        }
      }
    }

    if (!best || best.confidence < minConfidence) return null;
    return best;
  }

  /**
   * Given multiple clean/watermarked pairs, generate the averaged alpha and
   * alpha map using auto-detected geometry + consensus filtering.
   */
  function generateOverlayFromPairs(pairs, settings, onProgress) {
    // pairs = [ { clean: ImageData, watermarked: ImageData }, ... ]
    const candidates = [];

    for (let i = 0; i < pairs.length; i++) {
      const { clean, watermarked } = pairs[i];
      if (clean.width !== watermarked.width || clean.height !== watermarked.height) continue;

      const detection = detectBestRect(clean, watermarked, settings);
      if (!detection) continue;
      candidates.push({ clean, watermarked, ...detection });
      if (onProgress) onProgress(`Analyzed pair ${i + 1}/${pairs.length}`);
    }

    if (candidates.length === 0) throw new Error("No valid pairs detected");

    // Consensus — find the most common quantised geometry
    const quantize = (v, s) => Math.round(v / s) * s;
    const groups = new Map();
    for (const c of candidates) {
      const key = [
        quantize(c.rect.w, 4), quantize(c.rect.h, 4),
        quantize(c.margins.right, 4), quantize(c.margins.bottom, 4),
      ].join("x");
      const g = groups.get(key) || [];
      g.push(c);
      groups.set(key, g);
    }
    let bestGroup = null;
    for (const [, group] of groups) {
      const score = group.length * 10 + group.reduce((s, c) => s + c.confidence, 0) / group.length;
      if (!bestGroup || score > bestGroup.score) bestGroup = { group, score };
    }
    const consensus = bestGroup.group;

    // Median geometry
    const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const finalW = median(consensus.map((c) => c.rect.w));
    const finalH = median(consensus.map((c) => c.rect.h));
    const finalR = median(consensus.map((c) => c.margins.right));
    const finalB = median(consensus.map((c) => c.margins.bottom));

    // Accumulate alpha
    const alphaSum  = new Float32Array(finalW * finalH);
    let count = 0;

    for (const c of consensus) {
      const rect = cropRect(c.clean.width, c.clean.height, finalW, finalH, finalR, finalB);
      if (rect.x < 0 || rect.y < 0 ||
          rect.x + rect.w > c.clean.width || rect.y + rect.h > c.clean.height) continue;

      const masks = estimateMasksFromPair(c.clean, c.watermarked, rect);
      for (let i = 0; i < alphaSum.length; i++) {
        alphaSum[i]  += masks.alpha[i];
      }
      count++;
    }

    if (count === 0) throw new Error("No pairs remained after geometry alignment");

    const alpha  = new Float32Array(alphaSum.length);
    for (let i = 0; i < alpha.length; i++) {
      alpha[i]  = clamp01(alphaSum[i] / count);
    }

    return {
      alpha,
      size:    { width: finalW, height: finalH },
      margins: { right: finalR, bottom: finalB },
      pairs: count,
      confidence: consensus.reduce((s, c) => s + c.confidence, 0) / consensus.length,
    };
  }

  /* ── Reverse Alpha Blending (shared) ─────────────────────── */

  /**
   * Apply reverse alpha blending to remove the watermark from a frame.
   *
   * @param {Uint8ClampedArray} frameData — raw RGBA pixels of the frame
   * @param {number} frameW — frame width
   * @param {number} frameH — frame height
   * @param {Float32Array} alpha — per-pixel alpha map of the watermark
   * @param {number} logoW — watermark region width
   * @param {number} logoH — watermark region height
   * @param {number} x0 — left edge of the watermark region
   * @param {number} y0 — top edge of the watermark region
   * @param {{r:number,g:number,b:number}} color — watermark colour (default white)
   * @returns {Uint8ClampedArray}
   */
  function reverseAlpha(frameData, frameW, frameH, alpha, logoW, logoH, x0, y0, color = { r: 255, g: 255, b: 255 }) {
    const out = new Uint8ClampedArray(frameData);

    for (let ly = 0; ly < logoH; ly++) {
      for (let lx = 0; lx < logoW; lx++) {
        const a = Math.min(0.99, alpha[ly * logoW + lx]);
        if (a <= 0.002) continue;

        const offset = idx(x0 + lx, y0 + ly, frameW);
        const inv = 1 - a;
        out[offset]     = clampByte((frameData[offset]     - color.r * a) / inv);
        out[offset + 1] = clampByte((frameData[offset + 1] - color.g * a) / inv);
        out[offset + 2] = clampByte((frameData[offset + 2] - color.b * a) / inv);
      }
    }

    return out;
  }

  /**
   * Edge cleanup pass — blend edge pixels with clean neighbours to remove
   * halo artifacts around the watermark boundary.
   */
  function finishEdges(buffer, frameW, frameH, alpha, logoW, logoH, x0, y0, radius = 3, strength = 0.68) {
    const out = new Uint8ClampedArray(buffer);
    const minAlpha = 0.025, maxAlpha = 0.9;

    const alphaAt = (lx, ly) => {
      if (lx < 0 || ly < 0 || lx >= logoW || ly >= logoH) return 0;
      return alpha[ly * logoW + lx];
    };

    // Identify edge pixels
    const edgeMask = new Uint8Array(logoW * logoH);
    for (let ly = 0; ly < logoH; ly++) {
      for (let lx = 0; lx < logoW; lx++) {
        const a = alphaAt(lx, ly);
        if (a < minAlpha) continue;
        const grad = Math.abs(alphaAt(lx + 1, ly) - alphaAt(lx - 1, ly)) +
                     Math.abs(alphaAt(lx, ly + 1) - alphaAt(lx, ly - 1));
        if ((a > minAlpha && a < maxAlpha) || grad > 0.08) {
          edgeMask[ly * logoW + lx] = 1;
        }
      }
    }

    // Blend edge pixels with non-watermark neighbours
    for (let ly = 0; ly < logoH; ly++) {
      for (let lx = 0; lx < logoW; lx++) {
        if (!edgeMask[ly * logoW + lx]) continue;

        const fx = x0 + lx, fy = y0 + ly;
        let r = 0, g = 0, b = 0, cnt = 0;

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const sx = lx + dx, sy = ly + dy;
            const px = fx + dx, py = fy + dy;
            if (px < 0 || py < 0 || px >= frameW || py >= frameH) continue;
            if (alphaAt(sx, sy) > minAlpha) continue;

            const si = idx(px, py, frameW);
            r += buffer[si]; g += buffer[si + 1]; b += buffer[si + 2];
            cnt++;
          }
        }

        if (cnt === 0) continue;
        const offset = idx(fx, fy, frameW);
        out[offset]     = clampByte(buffer[offset]     * (1 - strength) + (r / cnt) * strength);
        out[offset + 1] = clampByte(buffer[offset + 1] * (1 - strength) + (g / cnt) * strength);
        out[offset + 2] = clampByte(buffer[offset + 2] * (1 - strength) + (b / cnt) * strength);
      }
    }

    return out;
  }

  /* ── High-Level Pipeline ─────────────────────────────────── */

  /**
   * Process a single frame: reverse alpha → edge cleanup → ImageData
   */
  function processFrame(frameImg, alpha, geometry, edgeSettings = {}) {
    const { width: logoW, height: logoH } = geometry.size;
    const rect = cropRect(frameImg.width, frameImg.height, logoW, logoH,
                          geometry.margins.right, geometry.margins.bottom);

    const reversed = reverseAlpha(
      frameImg.data, frameImg.width, frameImg.height,
      alpha, logoW, logoH, rect.x, rect.y
    );

    const cleaned = finishEdges(
      reversed, frameImg.width, frameImg.height,
      alpha, logoW, logoH, rect.x, rect.y,
      edgeSettings.radius ?? 3,
      edgeSettings.strength ?? 0.68
    );

    return new ImageData(cleaned, frameImg.width, frameImg.height);
  }

  /**
   * Render an alpha mask to a visible canvas for preview.
   */
  function renderMaskToCanvas(canvas, mask, w, h) {
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
      const v = clampByte(mask[i] * 255);
      const o = i * 4;
      imgData.data[o] = v;
      imgData.data[o + 1] = v;
      imgData.data[o + 2] = v;
      imgData.data[o + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /**
   * Render ImageData onto a canvas and return the canvas.
   */
  function renderToCanvas(imageData) {
    const c = document.createElement("canvas");
    c.width = imageData.width;
    c.height = imageData.height;
    c.getContext("2d").putImageData(imageData, 0, 0);
    return c;
  }

  /* ── Public API ──────────────────────────────────────────── */

  return {
    loadImageData,
    cropRect,
    extractAlphaFromCalibration,
    estimateMasksFromPair,
    detectBestRect,
    generateOverlayFromPairs,
    reverseAlpha,
    finishEdges,
    processFrame,
    renderMaskToCanvas,
    renderToCanvas,
  };

})();
