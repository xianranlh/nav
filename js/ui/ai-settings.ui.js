/* Provider and persona settings. */
window.createAISettingsUI = function (ctx) {
    const { $, $$, toast, uid, escapeHtml, Store, render, Bg, UIAI } = ctx;
  // ===================== AI 设置 UI =====================
  const dlgAI = $("#dialog-ai");
  const dlgProvider = $("#dialog-provider");
  const dlgPersona = $("#dialog-persona");

  function openAISettings() {
    renderAIProviders();
    renderAIPersonas();
    $("#ai-signature").value = AI.AIStore.data.customSignature || "";
    $("#ai-auto-apply").checked = !!AI.AIStore.data.autoApply;
    const sm = $("#ai-smart-mode"); if (sm) sm.checked = !!AI.AIStore.data.smartMode;
    Dlg.open(dlgAI);
  }

  $("#ai-signature").addEventListener("change", (e) => {
    AI.AIStore.data.customSignature = e.target.value;
    AI.AIStore.save();
  });
  $("#ai-auto-apply").addEventListener("change", (e) => {
    AI.AIStore.data.autoApply = e.target.checked;
    AI.AIStore.save();
  });
  $("#ai-smart-mode")?.addEventListener("change", (e) => {
    AI.AIStore.data.smartMode = e.target.checked;
    AI.AIStore.save();
    toast(e.target.checked
      ? "已开启智能模式：发送前会自动绕开冷却模型"
      : "已关闭智能模式");
  });

  function renderAIProviders() {
    const list = $("#ai-providers-list");
    const curId = AI.AIStore.data.currentProviderId;
    list.innerHTML = AI.AIStore.data.providers.map((p) => `
      <div class="ai-provider-item ${p.id === curId ? "active" : ""}" data-id="${p.id}">
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="meta">${escapeHtml(p.baseUrl)}${p.models?.length ? ` · ${p.models.length} 模型` : ""}</span>
        <div class="actions">
          <button data-act="use">${p.id === curId ? "当前" : "选用"}</button>
          <button data-act="fetch">刷新模型</button>
          <button data-act="edit">编辑</button>
          <button data-act="del">删除</button>
        </div>
      </div>
    `).join("") || `<div class="hint">暂无供应商，点击下方"添加"。</div>`;
  }

  $("#ai-providers-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const item = btn.closest(".ai-provider-item");
    const id = item?.dataset.id;
    const p = AI.AIStore.data.providers.find((x) => x.id === id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === "use") {
      AI.AIStore.data.currentProviderId = id;
      AI.AIStore.data.currentModel = p.defaultModel || (p.models || [])[0] || "";
      AI.AIStore.save();
      renderAIProviders();
      UIAI.refreshModelOptions();
    } else if (act === "fetch") {
      btn.textContent = "…";
      try {
        const ms = await AI.fetchModels(p);
        p.models = ms;
        AI.AIStore.save();
        toast(`已加载 ${ms.length} 个模型`);
        renderAIProviders();
        UIAI.refreshModelOptions();
      } catch (err) {
        toast("拉取失败：" + err.message.slice(0, 80), 3500);
      }
      btn.textContent = "刷新模型";
    } else if (act === "edit") {
      openProviderDialog(p);
    } else if (act === "del") {
      if (!confirm(`删除供应商 "${p.name}"？`)) return;
      AI.AIStore.data.providers = AI.AIStore.data.providers.filter((x) => x.id !== id);
      if (AI.AIStore.data.currentProviderId === id) AI.AIStore.data.currentProviderId = (AI.AIStore.data.providers[0] || {}).id || "";
      AI.AIStore.save();
      renderAIProviders();
      UIAI.refreshModelOptions();
    }
  });

  $("#ai-add-provider").addEventListener("click", () => openProviderDialog(null));
  const presets = {
    openai:   { name: "OpenAI",   baseUrl: "https://api.openai.com/v1",           defaultModel: "gpt-4o-mini" },
    deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1",         defaultModel: "deepseek-chat" },
    kimi:     { name: "Kimi",     baseUrl: "https://api.moonshot.cn/v1",          defaultModel: "moonshot-v1-8k" },
    ollama:   { name: "Ollama 本地", baseUrl: "http://localhost:11434/v1",         defaultModel: "llama3" },
  };
  Object.keys(presets).forEach((k) => {
    $("#ai-add-preset-" + k).addEventListener("click", () => openProviderDialog(null, presets[k]));
  });

  function populateProviderModelsDatalist(models) {
    const dl = $("#provider-models-dl");
    if (!dl) return;
    dl.innerHTML = (models || []).map((m) => `<option value="${escapeHtml(m)}"></option>`).join("");
  }

  function openProviderDialog(existing, preset) {
    const f = $("#form-provider");
    $("#provider-title").textContent = existing ? "🔌 编辑 AI 供应商" : "🔌 添加 AI 供应商";
    f.reset();
    const msg = $("#provider-fetch-msg");
    if (msg) { msg.textContent = ""; msg.classList.remove("err", "ok"); }
    if (existing) {
      f.name.value = existing.name;
      f.baseUrl.value = existing.baseUrl;
      f.apiKey.value = existing.apiKey || "";
      // 反代默认开启；只在 useProxy === false（用户显式禁用）时勾选"禁用本机反代"复选框
      if (f.disableProxy) f.disableProxy.checked = existing.useProxy === false;
      f.defaultModel.value = existing.defaultModel || "";
      populateProviderModelsDatalist(existing.models || []);
      f.dataset.fetchedModels = JSON.stringify(existing.models || []);
    } else if (preset) {
      f.name.value = preset.name;
      f.baseUrl.value = preset.baseUrl;
      f.defaultModel.value = preset.defaultModel;
      populateProviderModelsDatalist([]);
      f.dataset.fetchedModels = "[]";
    } else {
      populateProviderModelsDatalist([]);
      f.dataset.fetchedModels = "[]";
    }
    f.dataset.editId = existing ? existing.id : "";
    Dlg.open(dlgProvider);
  }

  $("#provider-fetch-models")?.addEventListener("click", async () => {
    const f = $("#form-provider");
    const btn = $("#provider-fetch-models");
    const msg = $("#provider-fetch-msg");
    const baseUrl = (f.baseUrl.value || "").trim();
    const apiKey = (f.apiKey.value || "").trim();
    // disableProxy 勾选 → useProxy=false 强制直连；否则 undefined 走自动判定
    const disableProxy = !!(f.disableProxy && f.disableProxy.checked);
    const useProxy = disableProxy ? false : undefined;
    if (!baseUrl) {
      if (msg) { msg.textContent = "请先填写 Base URL"; msg.classList.add("err"); }
      return;
    }
    if (msg) { msg.textContent = "正在拉取模型列表…"; msg.classList.remove("err", "ok"); }
    btn.disabled = true;
    try {
      const models = await AI.fetchModels({ baseUrl, apiKey, useProxy });
      populateProviderModelsDatalist(models);
      f.dataset.fetchedModels = JSON.stringify(models);
      if (!f.defaultModel.value && models[0]) f.defaultModel.value = models[0];
      if (msg) { msg.textContent = `已加载 ${models.length} 个模型，点击输入框可下拉选择`; msg.classList.remove("err"); msg.classList.add("ok"); }
    } catch (e) {
      if (msg) { msg.textContent = "拉取失败：" + String(e.message || e).slice(0, 200); msg.classList.add("err"); }
    } finally {
      btn.disabled = false;
    }
  });

  $("#form-provider").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    delete data.disableProxy; // 这是 UI 字段，不直接落库
    // 反代决策：勾上"禁用本机反代"= useProxy=false；不勾就把字段干掉走自动判定（buildFetchTarget 会按 proxyAvailable 决定）
    if (f.disableProxy && f.disableProxy.checked) {
      data.useProxy = false;
    } else {
      delete data.useProxy;
    }
    let fetched = [];
    try { fetched = JSON.parse(f.dataset.fetchedModels || "[]"); } catch (_) {}
    const editId = f.dataset.editId;
    if (editId) {
      const p = AI.AIStore.data.providers.find((x) => x.id === editId);
      if (p) {
        const oldDefault = p.defaultModel;
        Object.assign(p, data);
        // Object.assign 不删字段：useProxy 不在 data 里时也要把旧的 false 清掉，让自动判定接管
        if (!("useProxy" in data)) delete p.useProxy;
        if (fetched.length) p.models = fetched;
        // 如果改的是当前正在用的供应商，且默认模型变了，把对话页正在用的当前模型也跟过去；
        // 否则用户在设置里改完默认模型后，对话页头部仍显示旧模型，迷惑性极强。
        if (p.id === AI.AIStore.data.currentProviderId
            && p.defaultModel
            && p.defaultModel !== oldDefault) {
          AI.AIStore.data.currentModel = p.defaultModel;
        }
        // 进一步兜底：当前模型不在新模型列表里就强制切到默认模型（或第一个）
        const models = p.models || [];
        if (p.id === AI.AIStore.data.currentProviderId
            && AI.AIStore.data.currentModel
            && models.length
            && !models.includes(AI.AIStore.data.currentModel)) {
          AI.AIStore.data.currentModel = p.defaultModel || models[0];
        }
      }
    } else {
      const newP = Object.assign({ id: AI.uid(), models: fetched }, data);
      AI.AIStore.data.providers.push(newP);
      if (!AI.AIStore.data.currentProviderId) {
        AI.AIStore.data.currentProviderId = newP.id;
        AI.AIStore.data.currentModel = newP.defaultModel || (newP.models || [])[0] || "";
      }
    }
    AI.AIStore.save();
    Dlg.close(dlgProvider);
    renderAIProviders();
    UIAI.refreshModelOptions();
  });

  // ---- Personas ----
  function renderAIPersonas() {
    const list = $("#ai-personas-list");
    const curId = AI.AIStore.data.currentPersonaId;
    list.innerHTML = AI.AIStore.data.personas.map((p) => `
      <div class="ai-persona-item ${p.id === curId ? "active" : ""}" data-id="${p.id}">
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="meta">${escapeHtml((p.prompt || "").slice(0, 60))}${p.prompt?.length > 60 ? "..." : ""}</span>
        <div class="actions">
          <button data-act="use">${p.id === curId ? "当前" : "选用"}</button>
          <button data-act="edit">编辑</button>
          <button data-act="del">删除</button>
        </div>
      </div>
    `).join("");
  }

  $("#ai-personas-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.closest(".ai-persona-item").dataset.id;
    const p = AI.AIStore.data.personas.find((x) => x.id === id);
    const act = btn.dataset.act;
    if (act === "use") {
      AI.AIStore.data.currentPersonaId = id;
      AI.AIStore.save();
      renderAIPersonas();
      UIAI.refreshPersonaOptions();
    } else if (act === "edit") openPersonaDialog(p);
    else if (act === "del") {
      if (!confirm(`删除角色 "${p.name}"？`)) return;
      AI.AIStore.data.personas = AI.AIStore.data.personas.filter((x) => x.id !== id);
      if (AI.AIStore.data.currentPersonaId === id) AI.AIStore.data.currentPersonaId = (AI.AIStore.data.personas[0] || {}).id || "";
      AI.AIStore.save();
      renderAIPersonas();
      UIAI.refreshPersonaOptions();
    }
  });

  $("#ai-add-persona").addEventListener("click", () => openPersonaDialog(null));

  function openPersonaDialog(existing) {
    const f = $("#form-persona");
    $("#persona-title").textContent = existing ? "🎭 编辑角色" : "🎭 添加角色";
    f.reset();
    if (existing) { f.name.value = existing.name; f.prompt.value = existing.prompt; f.dataset.editId = existing.id; }
    else f.dataset.editId = "";
    Dlg.open(dlgPersona);
  }

  $("#form-persona").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    const editId = f.dataset.editId;
    if (editId) {
      const p = AI.AIStore.data.personas.find((x) => x.id === editId);
      if (p) Object.assign(p, data);
    } else {
      AI.AIStore.data.personas.push({ id: AI.uid(), name: data.name, prompt: data.prompt });
    }
    AI.AIStore.save();
    Dlg.close(dlgPersona);
    renderAIPersonas();
    UIAI.refreshPersonaOptions();
  });


  return { openAISettings };
};
