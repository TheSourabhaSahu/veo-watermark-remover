/**
 * app.js — UI controller for Veo Remover (Simplified)
 */

"use strict";

(() => {

  /* ── State ───────────────────────────────────────────────── */

  const state = {
    def: { 
      targetFiles: [], 
      videoFile: null, 
      videoUrl: null,
      alpha: null, 
      geometry: { size: { width: 94, height: 42 }, margins: { right: 28, bottom: 30 } } 
    }
  };

  /* ── DOM Refs ────────────────────────────────────────────── */

  const $ = (id) => document.getElementById(id);

  // Default Overlay Components
  const defVideoDrop    = $("def-video-drop");
  const defVideoInput   = $("def-video-input");
  const defTargetsDrop  = $("def-targets-drop");
  const defTargetsInput = $("def-targets-input");
  const defProcessBtn   = $("def-process-btn");
  const defStatus       = $("def-status");
  const defResults      = $("def-results");
  const defResultsGrid  = $("def-results-grid");
  const defVideoPreviewContainer = $("def-video-preview-container");
  const defVideoElement = $("def-video-element");
  const defVideoCanvas  = $("def-video-canvas");
  const defCleanedVideoElement = $("def-cleaned-video-element");
  const defVideoDownloadArea = $("def-video-download-area");
  const defVideoDownloadBtn  = $("def-video-download-btn");

  /* ── Utilities ───────────────────────────────────────────── */

  function setStatus(el, text, type = "") {
    el.className = "status-bar" + (type ? ` ${type}` : "");
    const statusText = el.querySelector(".status-text");
    const progressBar = el.querySelector(".progress-bar");

    if (statusText) statusText.textContent = text;
    if (type !== "processing" && progressBar) progressBar.remove();
  }

  function addProgressBar(el) {
    let bar = el.querySelector(".progress-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "progress-bar";
      bar.innerHTML = '<div class="progress-fill"></div>';
      el.appendChild(bar);
    }
    return bar.querySelector(".progress-fill");
  }

  function setupDropZone(dropEl, inputEl, onFiles, multiple = false) {
    dropEl.addEventListener("click", () => inputEl.click());

    inputEl.addEventListener("change", () => {
      if (inputEl.files.length > 0) onFiles(Array.from(inputEl.files));
    });

    dropEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropEl.classList.add("drag-over");
    });
    dropEl.addEventListener("dragleave", () => dropEl.classList.remove("drag-over"));
    dropEl.addEventListener("drop", (e) => {
      e.preventDefault();
      dropEl.classList.remove("drag-over");
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
      if (files.length > 0) onFiles(files);
    });
  }

  function markUploaded(dropEl, count, label) {
    dropEl.classList.add("has-files");
    const labelEl = dropEl.querySelector(".upload-label");
    if (labelEl) labelEl.innerHTML = `<strong>${count}</strong> ${label} loaded ✓`;
  }

  function createResultCard(canvas, filename) {
    const card = document.createElement("div");
    card.className = "result-card";

    const displayCanvas = document.createElement("canvas");
    displayCanvas.width = canvas.width;
    displayCanvas.height = canvas.height;
    displayCanvas.getContext("2d").drawImage(canvas, 0, 0);
    card.appendChild(displayCanvas);

    const footer = document.createElement("div");
    footer.className = "result-card-footer";

    const nameEl = document.createElement("span");
    nameEl.className = "result-filename";
    nameEl.textContent = filename;

    const dlBtn = document.createElement("button");
    dlBtn.className = "btn-download";
    dlBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download`;
    dlBtn.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `cleaned-${filename}.png`;
      a.click();
    });

    footer.appendChild(nameEl);
    footer.appendChild(dlBtn);
    card.appendChild(footer);
    return card;
  }

  function getDefSettings() {
    return {
      edge: {
        radius:   parseInt($("def-edge-radius").value,   10) || 3,
        strength: parseFloat($("def-edge-strength").value)   || 0.68,
      },
    };
  }

  /* ── Upload Handlers ─────────────────────────────────────── */

  setupDropZone(defVideoDrop, defVideoInput, (files) => {
    state.def.videoFile = files[0];
    state.def.targetFiles = [];
    markUploaded(defVideoDrop, 1, "video file");
    defProcessBtn.disabled = false;
    
    if (state.def.videoUrl) URL.revokeObjectURL(state.def.videoUrl);
    const url = URL.createObjectURL(files[0]);
    state.def.videoUrl = url;
    defVideoElement.src = url;
    defVideoElement.hidden = false;
    defVideoCanvas.hidden = false;
    defCleanedVideoElement.hidden = true;
    defCleanedVideoElement.removeAttribute("src");
    defVideoPreviewContainer.hidden = false;
    defVideoDownloadArea.hidden = true;
    
    defVideoElement.onloadedmetadata = () => {
      defVideoCanvas.width = defVideoElement.videoWidth;
      defVideoCanvas.height = defVideoElement.videoHeight;
    };
    
    setStatus(defStatus, "Video loaded — click Process to begin");
  });

  setupDropZone(defTargetsDrop, defTargetsInput, (files) => {
    state.def.targetFiles = files;
    state.def.videoFile = null;
    markUploaded(defTargetsDrop, files.length, `target frame${files.length > 1 ? "s" : ""}`);
    defProcessBtn.disabled = false;
    defVideoPreviewContainer.hidden = true;
    setStatus(defStatus, `${files.length} target frame(s) ready`);
  }, true);

  /* ── Process Logic ───────────────────────────────────────── */

  defProcessBtn.addEventListener("click", async () => {
    const settings = getDefSettings();
    defProcessBtn.disabled = true;
    defResultsGrid.innerHTML = "";
    defResults.hidden = true;

    const progressFill = addProgressBar(defStatus);
    setStatus(defStatus, "Loading overlay…", "processing");

    try {
      if (!state.def.alpha) {
        const response = await fetch("veo-bg-alpha.png");
        const blob = await response.blob();
        const alphaImg = await VeoEngine.loadImageData(blob);
        const alpha = new Float32Array(alphaImg.width * alphaImg.height);
        for (let i = 0; i < alpha.length; i++) {
          alpha[i] = alphaImg.data[i * 4] / 255;
        }
        state.def.alpha = alpha;
      }

      if (state.def.videoFile) {
        await processVideo(state.def.videoFile, state.def.alpha, state.def.geometry, settings.edge, progressFill);
      } else {
        await processImageFrames(state.def.targetFiles, state.def.alpha, state.def.geometry, settings.edge, progressFill);
      }
    } catch (err) {
      setStatus(defStatus, `Error: ${err.message}`, "error");
    } finally {
      defProcessBtn.disabled = false;
    }
  });

  async function processImageFrames(files, alpha, geometry, edge, progressFill) {
    const total = files.length;
    for (let i = 0; i < total; i++) {
      progressFill.style.width = `${((i + 1) / total) * 100}%`;
      setStatus(defStatus, `Processing frame ${i + 1} of ${total}…`, "processing");
      const frameImg = await VeoEngine.loadImageData(files[i]);
      const result = VeoEngine.processFrame(frameImg, alpha, geometry, edge);
      const canvas = VeoEngine.renderToCanvas(result);
      defResultsGrid.appendChild(createResultCard(canvas, files[i].name));
      await new Promise((r) => setTimeout(r, 0));
    }
    defResults.hidden = false;
    setStatus(defStatus, "Frames processed ✓", "done");
  }

  async function processVideo(file, alpha, geometry, edge, progressFill) {
    setStatus(defStatus, "Preparing video…", "processing");
    
    return new Promise((resolve, reject) => {
      const video = defVideoElement;
      const cleanedVideo = defCleanedVideoElement;
      const canvas = defVideoCanvas;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const originalSrc = state.def.videoUrl;
      let isStopped = false;
      let lastProcessTime = Date.now();
      let processedFrames = 0;
      let hasStarted = false;

      if (originalSrc && video.src !== originalSrc) {
        video.src = originalSrc;
        video.load();
      }

      const startLogic = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.hidden = false;
        cleanedVideo.hidden = true;
        
        const stream = canvas.captureStream(30);
        const types = [
          'video/mp4;codecs=avc1',
          'video/mp4',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm'
        ];
        const mimeType = types.find(type => MediaRecorder.isTypeSupported(type)) || '';
        const recorder = new MediaRecorder(stream, { 
          mimeType,
          videoBitsPerSecond: 12000000 
        });
        const chunks = [];

        const processCurrentFrame = () => {
          if (video.readyState < 2 || canvas.width === 0 || canvas.height === 0) return false;

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frameImg = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = VeoEngine.processFrame(frameImg, alpha, geometry, edge);
          ctx.putImageData(result, 0, 0);
          processedFrames++;
          lastProcessTime = Date.now();
          return true;
        };
        
        const stopProcessing = (msg = "Video complete ✓") => {
          if (isStopped) return;
          isStopped = true;
          processCurrentFrame();
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          setStatus(defStatus, msg, msg.includes('✓') ? "done" : "error");
        };

        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
          const blob = new Blob(chunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          video.pause();
          video.hidden = false;
          cleanedVideo.src = url;
          cleanedVideo.muted = false;
          cleanedVideo.controls = true;
          cleanedVideo.hidden = false;
          canvas.hidden = true;
          defVideoDownloadBtn.href = url;
          defVideoDownloadBtn.textContent = `Download Cleaned Video (.${ext})`;
          defVideoDownloadBtn.download = `cleaned-${file.name.split('.')[0]}.${ext}`;
          defVideoDownloadArea.hidden = false;
          progressFill.style.width = '100%';
          if (processedFrames === 0) {
            cleanedVideo.hidden = true;
            canvas.hidden = false;
          }
          resolve();
        };

        video.currentTime = 0;
        video.muted = true;
        video.onended = () => stopProcessing();

        const beginRecording = () => {
          if (hasStarted) return;
          hasStarted = true;
          processCurrentFrame();
          recorder.start();

          video.play().catch(err => {
            stopProcessing("Error: Playback failed.");
            reject(err);
          });

          const step = () => {
            if (isStopped) return;

            if (video.ended) {
              stopProcessing();
              return;
            }

            if (video.paused || (Date.now() - lastProcessTime > 1500)) {
              video.play().catch(() => {});
            }

            if (processCurrentFrame()) {
              const progress = Math.min(99, (video.currentTime / video.duration) * 100);
              progressFill.style.width = `${progress}%`;
              setStatus(defStatus, `Cleaning: ${Math.round(progress)}%…`, "processing");
            }

            if (video.requestVideoFrameCallback) {
              video.requestVideoFrameCallback(step);
            } else {
              setTimeout(step, 16); 
            }
          };
          step();
        };

        const seekToStart = () => {
          if (video.currentTime === 0 && video.readyState >= 2) beginRecording();
          else {
            video.onseeked = beginRecording;
            video.currentTime = 0;
          }
        };

        if (video.readyState >= 2) seekToStart();
        else video.oncanplay = seekToStart;
      };

      if (video.readyState >= 1) startLogic();
      else { 
        video.onloadedmetadata = startLogic; 
        video.onerror = () => reject(new Error("Load failed")); 
      }
    });
  }

})();
