/* 樱 · 图像编辑器
 *
 * 借鉴 Image-Studio (github.com/RoseKhlifa/Image-Studio) 的编辑能力，
 * 重写为零依赖 vanilla JS + 原生 <canvas>，融入 nav 现有风格。
 *
 * 公开 API：
 *   window.ImageEditor.open(record, onSave)
 *     - record: 一条 Archive.Gallery 记录（含 id / dataUrl / serverUrl / prompt 等）
 *     - onSave({ dataUrl, ...metaPatch }): 保存按钮被点时回调；不传则用 Gallery.add 兜底
 *
 * 功能矩阵（对比 Image-Studio）：
 *   ✓ 裁剪 (rect 选区 → 拍平)
 *   ✓ 旋转 90° CW / CCW + 镜像翻转 H / V
 *   ✓ 画笔 / 橡皮（蒙版层，可选颜色/不透明度/大小）
 *   ✓ 撤销 / 重做（栈存 ImageData 快照，上限 30）
 *   ✓ 缩放（鼠标滚轮 + 适应窗口）
 *   ✓ 原图对比（按住 V 显示原图，松开恢复）
 *   ✓ 另存为图库新条目（不覆盖原图）
 *   ✗ 文本 / 箭头 / 任意标注（Image-Studio 有，nav 暂不需要）
 */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  // 内部状态 ------------------------------------------------------------------
  const state = {
    open: false,
    dialog: null,
    canvasBase: null,    // 底层图像（被 transform 操作）
    ctxBase: null,
    canvasMask: null,    // 蒙版层（覆盖在图上的画笔效果）
    ctxMask: null,
    canvasView: null,    // 实际显示的合成画布（base + mask）
    ctxView: null,
    container: null,
    record: null,
    onSave: null,
    tool: "brush",       // brush | erase | crop
    brushSize: 24,
    brushColor: "#ffffff",
    brushOpacity: 1.0,
    zoom: 1.0,
    panX: 0,
    panY: 0,
    drawing: false,
    lastX: 0,
    lastY: 0,
    cropStart: null,     // {x, y} 在 base 坐标系
    cropRect: null,      // {x, y, w, h} 当前 marquee
    history: [],         // [{base: ImageData, mask: ImageData}] 撤销栈
    future: [],          // 重做栈
    showOriginal: false, // V 键临时显示原图
    origImage: null,     // HTMLImageElement，原图
    originalDataUrl: "",
  };

  const HISTORY_MAX = 30;

  // 工具函数 ------------------------------------------------------------------
  function snapshot() {
    if (!state.ctxBase || !state.ctxMask) return null;
    return {
      base: state.ctxBase.getImageData(0, 0, state.canvasBase.width, state.canvasBase.height),
      mask: state.ctxMask.getImageData(0, 0, state.canvasMask.width, state.canvasMask.height),
    };
  }

  function pushHistory() {
    const snap = snapshot();
    if (!snap) return;
    state.history.push(snap);
    if (state.history.length > HISTORY_MAX) state.history.shift();
    state.future.length = 0;
    syncUndoRedoBtns();
  }

  function restore(snap) {
    if (!snap) return;
    // 如果尺寸变了（裁剪 / 旋转），重设 canvas 尺寸
    if (state.canvasBase.width !== snap.base.width || state.canvasBase.height !== snap.base.height) {
      state.canvasBase.width = snap.base.width;
      state.canvasBase.height = snap.base.height;
      state.canvasMask.width = snap.mask.width;
      state.canvasMask.height = snap.mask.height;
      fitToContainer();
    }
    state.ctxBase.putImageData(snap.base, 0, 0);
    state.ctxMask.putImageData(snap.mask, 0, 0);
    composite();
  }

  function undo() {
    if (!state.history.length) return;
    const cur = snapshot();
    if (cur) state.future.push(cur);
    const prev = state.history.pop();
    restore(prev);
    syncUndoRedoBtns();
  }
  function redo() {
    if (!state.future.length) return;
    const cur = snapshot();
    if (cur) state.history.push(cur);
    const next = state.future.pop();
    restore(next);
    syncUndoRedoBtns();
  }

  function syncUndoRedoBtns() {
    const u = $("#editor-undo");
    const r = $("#editor-redo");
    if (u) u.disabled = !state.history.length;
    if (r) r.disabled = !state.future.length;
  }

  // 把 base + mask 合到 view 上显示 -----------------------------------------
  function composite() {
    if (!state.ctxView) return;
    const cv = state.canvasView;
    state.ctxView.save();
    state.ctxView.setTransform(1, 0, 0, 1, 0, 0);
    state.ctxView.clearRect(0, 0, cv.width, cv.height);
    state.ctxView.restore();
    state.ctxView.save();
    // pan + zoom
    state.ctxView.translate(state.panX, state.panY);
    state.ctxView.scale(state.zoom, state.zoom);
    // 按住 V 键时只显示原图（不应用任何编辑）
    if (state.showOriginal && state.origImage) {
      state.ctxView.drawImage(state.origImage, 0, 0);
    } else {
      state.ctxView.drawImage(state.canvasBase, 0, 0);
      state.ctxView.drawImage(state.canvasMask, 0, 0);
    }
    state.ctxView.restore();
    // crop marquee
    if (state.tool === "crop" && state.cropRect) {
      drawCropMarquee();
    }
  }

  function drawCropMarquee() {
    const c = state.ctxView;
    const r = state.cropRect;
    const sx = state.panX + r.x * state.zoom;
    const sy = state.panY + r.y * state.zoom;
    const sw = r.w * state.zoom;
    const sh = r.h * state.zoom;
    c.save();
    // 半透明遮罩
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.beginPath();
    c.rect(0, 0, state.canvasView.width, state.canvasView.height);
    c.rect(sx, sy, sw, sh);
    c.fill("evenodd");
    // 边框
    c.strokeStyle = "rgba(255, 143, 171, 1)";
    c.lineWidth = 2;
    c.setLineDash([6, 4]);
    c.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
    // 提示文字
    c.fillStyle = "rgba(255,255,255,0.95)";
    c.font = "12px ui-sans-serif, system-ui";
    c.setLineDash([]);
    c.fillText(`${Math.round(r.w)} × ${Math.round(r.h)} · 双击应用`, sx + 6, sy + 16);
    c.restore();
  }

  // 适配 view canvas 到容器 -------------------------------------------------
  function fitToContainer() {
    if (!state.container || !state.canvasBase) return;
    const rect = state.container.getBoundingClientRect();
    const W = Math.max(200, rect.width);
    const H = Math.max(200, rect.height - 4);
    state.canvasView.width = W;
    state.canvasView.height = H;
    // 居中 + 适合尺寸
    const z = Math.min(W / state.canvasBase.width, H / state.canvasBase.height, 1) * 0.96;
    state.zoom = z;
    state.panX = (W - state.canvasBase.width * z) / 2;
    state.panY = (H - state.canvasBase.height * z) / 2;
    composite();
  }

  // 坐标转换：view → base 坐标系 --------------------------------------------
  function viewToBase(vx, vy) {
    return {
      x: (vx - state.panX) / state.zoom,
      y: (vy - state.panY) / state.zoom,
    };
  }

  // 画笔事件 ----------------------------------------------------------------
  function pointerDown(e) {
    e.preventDefault();
    const rect = state.canvasView.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const p = viewToBase(x, y);

    if (state.tool === "crop") {
      state.cropStart = p;
      state.cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
      composite();
      return;
    }

    pushHistory();
    state.drawing = true;
    state.lastX = p.x;
    state.lastY = p.y;
    drawStroke(p.x, p.y, p.x, p.y);
  }
  function pointerMove(e) {
    const rect = state.canvasView.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const p = viewToBase(x, y);

    if (state.tool === "crop" && state.cropStart) {
      const a = state.cropStart;
      state.cropRect = {
        x: Math.min(a.x, p.x),
        y: Math.min(a.y, p.y),
        w: Math.abs(p.x - a.x),
        h: Math.abs(p.y - a.y),
      };
      composite();
      return;
    }
    if (!state.drawing) return;
    drawStroke(state.lastX, state.lastY, p.x, p.y);
    state.lastX = p.x;
    state.lastY = p.y;
  }
  function pointerUp() {
    if (state.tool === "crop") {
      state.cropStart = null;
      return;
    }
    state.drawing = false;
  }

  function drawStroke(x1, y1, x2, y2) {
    const c = state.ctxMask;
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = state.brushSize;
    c.globalAlpha = state.brushOpacity;
    if (state.tool === "erase") {
      c.globalCompositeOperation = "destination-out";
      c.strokeStyle = "rgba(0,0,0,1)";
    } else {
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = state.brushColor;
    }
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    c.restore();
    composite();
  }

  // 应用 crop（双击 / 按 Enter） --------------------------------------------
  function applyCrop() {
    if (!state.cropRect || state.cropRect.w < 5 || state.cropRect.h < 5) return;
    pushHistory();
    const r = state.cropRect;
    // 把 base + mask 各自截出一块新画布
    const W = Math.round(r.w);
    const H = Math.round(r.h);
    const newBase = document.createElement("canvas");
    newBase.width = W; newBase.height = H;
    newBase.getContext("2d").drawImage(state.canvasBase, -r.x, -r.y);
    const newMask = document.createElement("canvas");
    newMask.width = W; newMask.height = H;
    newMask.getContext("2d").drawImage(state.canvasMask, -r.x, -r.y);

    state.canvasBase.width = W;
    state.canvasBase.height = H;
    state.ctxBase.drawImage(newBase, 0, 0);
    state.canvasMask.width = W;
    state.canvasMask.height = H;
    state.ctxMask.drawImage(newMask, 0, 0);
    state.cropRect = null;
    state.cropStart = null;
    fitToContainer();
  }

  // 旋转 / 翻转 --------------------------------------------------------------
  function rotate(deg) {
    pushHistory();
    const W = state.canvasBase.width;
    const H = state.canvasBase.height;
    const newW = deg % 180 === 0 ? W : H;
    const newH = deg % 180 === 0 ? H : W;

    function rotateOne(srcCanvas) {
      const dst = document.createElement("canvas");
      dst.width = newW; dst.height = newH;
      const c = dst.getContext("2d");
      c.translate(newW / 2, newH / 2);
      c.rotate((deg * Math.PI) / 180);
      c.drawImage(srcCanvas, -W / 2, -H / 2);
      return dst;
    }
    const newBase = rotateOne(state.canvasBase);
    const newMask = rotateOne(state.canvasMask);
    state.canvasBase.width = newW;
    state.canvasBase.height = newH;
    state.ctxBase.drawImage(newBase, 0, 0);
    state.canvasMask.width = newW;
    state.canvasMask.height = newH;
    state.ctxMask.drawImage(newMask, 0, 0);
    fitToContainer();
  }
  function flip(axis) {
    pushHistory();
    function flipOne(src) {
      const dst = document.createElement("canvas");
      dst.width = src.width; dst.height = src.height;
      const c = dst.getContext("2d");
      if (axis === "h") { c.translate(src.width, 0); c.scale(-1, 1); }
      else              { c.translate(0, src.height); c.scale(1, -1); }
      c.drawImage(src, 0, 0);
      return dst;
    }
    const nb = flipOne(state.canvasBase);
    const nm = flipOne(state.canvasMask);
    state.ctxBase.clearRect(0, 0, state.canvasBase.width, state.canvasBase.height);
    state.ctxBase.drawImage(nb, 0, 0);
    state.ctxMask.clearRect(0, 0, state.canvasMask.width, state.canvasMask.height);
    state.ctxMask.drawImage(nm, 0, 0);
    composite();
  }

  // 清空蒙版 ----------------------------------------------------------------
  function clearMask() {
    pushHistory();
    state.ctxMask.clearRect(0, 0, state.canvasMask.width, state.canvasMask.height);
    composite();
  }

  // 工具切换 + UI 同步 ------------------------------------------------------
  function setTool(t) {
    state.tool = t;
    document.querySelectorAll("[data-editor-tool]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.editorTool === t);
    });
    state.canvasView.style.cursor = t === "crop" ? "crosshair"
      : t === "erase" ? "cell"
      : t === "brush" ? "crosshair" : "default";
    // 切到非 crop 时清掉残留 marquee
    if (t !== "crop") { state.cropRect = null; state.cropStart = null; composite(); }
  }

  // 导出当前编辑结果为 dataUrl ----------------------------------------------
  function exportToDataUrl() {
    // 把 base + mask 合成到一张离屏 canvas
    const out = document.createElement("canvas");
    out.width = state.canvasBase.width;
    out.height = state.canvasBase.height;
    const c = out.getContext("2d");
    c.drawImage(state.canvasBase, 0, 0);
    c.drawImage(state.canvasMask, 0, 0);
    return out.toDataURL("image/png");
  }

  // 加载图像到编辑器 --------------------------------------------------------
  async function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        state.origImage = img;
        state.canvasBase.width = img.naturalWidth;
        state.canvasBase.height = img.naturalHeight;
        state.canvasMask.width = img.naturalWidth;
        state.canvasMask.height = img.naturalHeight;
        state.ctxBase.clearRect(0, 0, img.naturalWidth, img.naturalHeight);
        state.ctxBase.drawImage(img, 0, 0);
        state.ctxMask.clearRect(0, 0, img.naturalWidth, img.naturalHeight);
        state.history = []; state.future = [];
        syncUndoRedoBtns();
        fitToContainer();
        resolve();
      };
      img.onerror = (e) => reject(new Error("无法加载图像"));
      img.src = dataUrl;
    });
  }

  // 键盘快捷键 ---------------------------------------------------------------
  function onKey(e) {
    if (!state.open) return;
    const isMac = /Mac/.test(navigator.platform);
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault(); redo(); return;
    }
    if (e.key === "1") setTool("brush");
    if (e.key === "2") setTool("erase");
    if (e.key === "3") setTool("crop");
    if (e.key === "Enter" && state.tool === "crop") applyCrop();
    if (e.key.toLowerCase() === "v") {
      if (!state.showOriginal) { state.showOriginal = true; composite(); }
    }
  }
  function onKeyUp(e) {
    if (e.key.toLowerCase() === "v" && state.showOriginal) {
      state.showOriginal = false;
      composite();
    }
  }

  // 滚轮缩放 ----------------------------------------------------------------
  function onWheel(e) {
    if (!state.open) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect = state.canvasView.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // 以光标位置为锚点缩放
    state.panX = x - (x - state.panX) * factor;
    state.panY = y - (y - state.panY) * factor;
    state.zoom *= factor;
    state.zoom = Math.max(0.05, Math.min(8, state.zoom));
    composite();
  }

  // 打开编辑器 ---------------------------------------------------------------
  async function open(record, onSave) {
    if (!record || (!record.dataUrl && !record.serverUrl)) {
      throw new Error("ImageEditor.open: 缺少 record.dataUrl");
    }
    state.record = record;
    state.onSave = onSave || null;
    state.dialog = $("#dialog-image-editor");
    if (!state.dialog) throw new Error("ImageEditor: 找不到 #dialog-image-editor 元素");

    state.container = $("#editor-canvas-wrap");
    state.canvasView = $("#editor-canvas");
    state.ctxView = state.canvasView.getContext("2d");
    state.canvasBase = document.createElement("canvas");
    state.ctxBase = state.canvasBase.getContext("2d");
    state.canvasMask = document.createElement("canvas");
    state.ctxMask = state.canvasMask.getContext("2d");

    // 初始化 toolbar 显示 -------------------------------------------------
    const sizeInput = $("#editor-brush-size");
    if (sizeInput) {
      sizeInput.value = state.brushSize;
      sizeInput.oninput = () => { state.brushSize = +sizeInput.value || 24; $("#editor-brush-size-val").textContent = state.brushSize; };
      $("#editor-brush-size-val").textContent = state.brushSize;
    }
    const colorInput = $("#editor-brush-color");
    if (colorInput) {
      colorInput.value = state.brushColor;
      colorInput.oninput = () => { state.brushColor = colorInput.value; };
    }
    const opacityInput = $("#editor-brush-opacity");
    if (opacityInput) {
      opacityInput.value = state.brushOpacity;
      opacityInput.oninput = () => {
        state.brushOpacity = +opacityInput.value || 1;
        $("#editor-brush-opacity-val").textContent = state.brushOpacity.toFixed(2);
      };
      $("#editor-brush-opacity-val").textContent = state.brushOpacity.toFixed(2);
    }

    setTool("brush");

    // 事件绑定（每次 open 重绑，close 时移除）
    state.canvasView.addEventListener("pointerdown", pointerDown);
    state.canvasView.addEventListener("pointermove", pointerMove);
    state.canvasView.addEventListener("pointerup", pointerUp);
    state.canvasView.addEventListener("pointerleave", pointerUp);
    state.canvasView.addEventListener("dblclick", () => { if (state.tool === "crop") applyCrop(); });
    state.canvasView.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);

    // 工具按钮
    document.querySelectorAll("[data-editor-tool]").forEach((b) => {
      b.addEventListener("click", () => setTool(b.dataset.editorTool));
    });
    document.querySelectorAll("[data-editor-act]").forEach((b) => {
      b.addEventListener("click", () => {
        const act = b.dataset.editorAct;
        if (act === "undo") undo();
        else if (act === "redo") redo();
        else if (act === "rot-cw")  rotate(90);
        else if (act === "rot-ccw") rotate(-90);
        else if (act === "flip-h")  flip("h");
        else if (act === "flip-v")  flip("v");
        else if (act === "clear-mask") clearMask();
        else if (act === "fit") fitToContainer();
        else if (act === "apply-crop") applyCrop();
        else if (act === "save") doSave();
        else if (act === "cancel") close();
      });
    });

    // 显示 + 加载
    state.originalDataUrl = record.dataUrl || record.serverUrl;
    if (typeof state.dialog.showModal === "function" && !state.dialog.open) state.dialog.showModal();
    else state.dialog.setAttribute("open", "");
    state.open = true;
    // 等 dialog 打开 + layout 后再 fit
    await new Promise((r) => requestAnimationFrame(r));
    try {
      await loadImage(state.originalDataUrl);
    } catch (e) {
      alert("无法加载图像：" + e.message);
      close();
      return;
    }
    // 窗口尺寸变化时自适应
    state._resizeHandler = () => fitToContainer();
    window.addEventListener("resize", state._resizeHandler);
  }

  function close() {
    state.open = false;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("keyup", onKeyUp);
    if (state._resizeHandler) window.removeEventListener("resize", state._resizeHandler);
    if (state.dialog && state.dialog.open) state.dialog.close();
    state.history = []; state.future = [];
    state.record = null;
  }

  async function doSave() {
    const dataUrl = exportToDataUrl();
    if (state.onSave) {
      try { await state.onSave({ dataUrl, prompt: state.record?.prompt || "", model: state.record?.model || "" }); }
      catch (e) { console.warn("[ImageEditor] onSave 抛错:", e); }
    } else if (window.Archive?.Gallery) {
      // 兜底：直接当作新条目入 Gallery
      await window.Archive.Gallery.add({
        source: "uploaded",
        dataUrl,
        prompt: state.record?.prompt ? state.record.prompt + " (edited)" : "(edited)",
        name: "edited.png",
        mime: "image/png",
      });
    }
    close();
  }

  // 公开 API -----------------------------------------------------------------
  window.ImageEditor = {
    open,
    close,
    /** 仅用于 UI 显示工具状态（外部不该直接读写 state） */
    getState() { return { ...state }; },
  };
})();
