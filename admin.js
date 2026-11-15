const loginPanel = document.querySelector("#login-panel");
const editorPanel = document.querySelector("#editor-panel");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const editorStatus = document.querySelector("#editor-status");
const contentFields = document.querySelector("#content-fields");
const logoutButton = document.querySelector("#logout-button");
const previewPanel = document.querySelector("#preview-panel");
const previewFrame = document.querySelector("#preview-frame");
const previewViewport = document.querySelector("#preview-viewport");
const historyPanel = document.querySelector("#history-panel");
const historyStatus = document.querySelector("#history-status");
const historyList = document.querySelector("#history-list");
const publishState = document.querySelector("#publish-state");
const contentSearch = document.querySelector("#content-search");
const searchStatus = document.querySelector("#search-status");
const correctionDisabledKeys = new Set(["accent", "accentbright", "email", "href", "image", "link", "logo", "url"]);
let draftContent;
let savedDraftSnapshot = null;
let lastPublishedAt = null;
let previewStarted = false;
let previewContent = null;
let autoSaveTimer = null;
let saveInProgress = null;
let isPublishing = false;
let isDiscarding = false;

function getPathValue(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPathValue(object, path, value) {
  const keys = path.split(".");
  const finalKey = keys.pop();
  const parent = keys.reduce((current, key) => current[key], object);
  parent[finalKey] = value;
}

function humanize(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function setStatus(element, message, state = "") {
  element.textContent = message;
  element.dataset.state = state;
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(result?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function updatePreview() {
  if (previewStarted && previewFrame.contentWindow) {
    previewFrame.contentWindow.postMessage({
      type: "site-content-preview",
      content: previewContent || draftContent
    }, window.location.origin);
  }
}

function openPreview(content = draftContent) {
  previewContent = content;
  previewPanel.hidden = false;
  if (!previewStarted) {
    previewStarted = true;
    previewFrame.addEventListener("load", updatePreview);
    previewFrame.src = "/";
  } else {
    updatePreview();
  }
}

function updateEditorValue(field, path, value) {
  setPathValue(draftContent, path, value);
  updatePublishState();
  scheduleAutoSave();
  previewContent = draftContent;
  updatePreview();
}

function isDraftDirty() {
  return draftContent && savedDraftSnapshot !== JSON.stringify(draftContent);
}

function updatePublishState() {
  const dirty = isDraftDirty();
  publishState.textContent = dirty
    ? "Unsaved changes"
    : lastPublishedAt
      ? `Last published ${new Date(lastPublishedAt).toLocaleString()}`
      : "Not published yet";
  publishState.dataset.state = dirty ? "unsaved" : "";
  return dirty;
}

function scheduleAutoSave() {
  if (isPublishing || isDiscarding) return;
  if (!isDraftDirty()) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    setStatus(editorStatus, "Draft matches the last saved version.", "success");
    return;
  }

  window.clearTimeout(autoSaveTimer);
  setStatus(editorStatus, "Unsaved changes will auto-save after you pause editing.");
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null;
    void saveDraft(true);
  }, 1200);
}

async function saveDraft(automatic = false) {
  if (isDiscarding) return false;
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = null;

  if (saveInProgress) {
    const previousSaveSucceeded = await saveInProgress;
    if (automatic) return previousSaveSucceeded;
  }

  const snapshot = JSON.stringify(draftContent);
  if (snapshot === savedDraftSnapshot) {
    updatePublishState();
    return true;
  }

  setStatus(editorStatus, automatic ? "Auto-saving draft…" : "Saving draft…");
  let succeeded = false;
  let saveRequest;
  saveRequest = (async () => {
    try {
      await request("/api/admin/content", {
        method: "PUT",
        body: JSON.stringify({ content: JSON.parse(snapshot) })
      });
      savedDraftSnapshot = snapshot;
      const hasNewerEdits = updatePublishState();
      setStatus(
        editorStatus,
        hasNewerEdits
          ? "Draft saved. Newer edits are still unsaved."
          : automatic
            ? "Draft auto-saved. It remains private until published."
            : "Draft saved. It is not public until you publish.",
        "success"
      );
      succeeded = true;
      return true;
    } catch (error) {
      setStatus(editorStatus, automatic ? `Auto-save failed: ${error.message}` : error.message, "error");
      return false;
    } finally {
      if (saveInProgress === saveRequest) saveInProgress = null;
      if (succeeded && isDraftDirty()) scheduleAutoSave();
    }
  })();
  saveInProgress = saveRequest;
  return saveRequest;
}

function applyEditorSearch() {
  const query = contentSearch.value.trim().toLowerCase();
  const fields = [...contentFields.querySelectorAll(".admin-field")];

  fields.forEach((field) => {
    field.hidden = Boolean(query && !field.dataset.search.includes(query));
  });

  contentFields.querySelectorAll(".admin-item").forEach((item) => {
    item.hidden = Boolean(query && !item.querySelector(".admin-field:not([hidden])"));
  });

  contentFields.querySelectorAll(".admin-group").forEach((group) => {
    const hasMatch = Boolean(group.querySelector(".admin-field:not([hidden])"));
    group.hidden = Boolean(query && !hasMatch);
    if (query && hasMatch) group.open = true;
  });

  const visibleCount = fields.filter((field) => !field.hidden).length;
  searchStatus.textContent = query
    ? visibleCount
      ? `Showing ${visibleCount} matching field${visibleCount === 1 ? "" : "s"}.`
      : "No matching fields."
    : `${fields.length} editable fields.`;
}

function updateImagePreview(input, preview) {
  preview.src = input.value;
}

function configureTextCorrection(input, key) {
  const enabled = !correctionDisabledKeys.has(key.toLowerCase());
  input.spellcheck = enabled;
  input.setAttribute("autocorrect", enabled ? "on" : "off");
  input.setAttribute("autocapitalize", enabled ? "sentences" : "off");
}

function getArrayLimits(path) {
  const limits = {
    "stats": { min: 1, max: 6 },
    "services.items": { min: 1, max: 12 },
    "work.items": { min: 1, max: 24 },
    "about.paragraphs": { min: 1, max: 8 },
    "careers.areas": { min: 1, max: 12 }
  };
  return limits[path] || { min: 1, max: 20 };
}

function createEmptyItem(example) {
  if (typeof example === "string") return "";
  return Object.fromEntries(Object.keys(example).map((key) => [key, ""]));
}

function commitArrayChange() {
  updatePublishState();
  scheduleAutoSave();
  previewContent = draftContent;
  updatePreview();
  renderEditor(draftContent, true);
}

function createField(path, value) {
  const key = path.split(".").at(-1);
  const field = document.createElement("label");
  field.className = "admin-field";
  field.dataset.search = `${path} ${value}`.toLowerCase();
  field.addEventListener("focusout", (event) => {
    if (field.contains(event.relatedTarget)) return;
    field.dataset.search = `${path} ${getPathValue(draftContent, path)}`.toLowerCase();
    applyEditorSearch();
  });
  const title = document.createElement("span");
  title.textContent = humanize(key);
  field.append(title);

  const selectOptions = {
    "intro.alignment": [
      ["left", "Left"],
      ["center", "Center"]
    ],
    "home.primaryCtaHref": [
      ["#work", "Work"],
      ["#services", "Services"],
      ["#contact", "Contact"]
    ],
    "home.secondaryCtaHref": [
      ["#work", "Work"],
      ["#services", "Services"],
      ["#contact", "Contact"]
    ]
  }[path];
  if (selectOptions) {
    const select = document.createElement("select");
    for (const [optionValue, label] of selectOptions) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = label;
      select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => updateEditorValue(field, path, select.value));
    field.append(select);
    return field;
  }

  const isImage = key === "image" || key === "logo";
  if (isImage) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.maxLength = 220;
    input.autocomplete = "off";
    configureTextCorrection(input, key);
    const hint = document.createElement("span");
    hint.className = "admin-field-hint";
    hint.textContent = "Choose an image in assets or upload a PNG, JPEG, or WebP (up to 5 MB).";
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp";
    const preview = document.createElement("img");
    preview.className = "admin-image-preview";
    preview.alt = `${humanize(key)} preview`;
    updateImagePreview(input, preview);

    input.addEventListener("input", () => {
      updateEditorValue(field, path, input.value);
      updateImagePreview(input, preview);
    });
    file.addEventListener("change", async () => {
      const selectedFile = file.files?.[0];
      if (!selectedFile) return;
      setStatus(editorStatus, "Uploading image…");
      try {
        const formData = new FormData();
        formData.append("image", selectedFile);
        const result = await request("/api/admin/upload", { method: "POST", body: formData });
        input.value = result.path;
        updateEditorValue(field, path, result.path);
        updateImagePreview(input, preview);
        setStatus(editorStatus, "Image uploaded. It will save to your private draft automatically.", "success");
      } catch (error) {
        setStatus(editorStatus, error.message, "error");
      } finally {
        file.value = "";
      }
    });
    field.append(input, hint, file, preview);
    return field;
  }

  if (key === "accent" || key === "accentBright") {
    const wrapper = document.createElement("span");
    wrapper.className = "admin-color-field";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = value;
    const text = document.createElement("input");
    text.type = "text";
    text.value = value;
    text.maxLength = 7;
    configureTextCorrection(text, key);

    const updateColor = (color) => {
      text.value = color;
      updateEditorValue(field, path, color);
    };
    picker.addEventListener("input", () => updateColor(picker.value));
    text.addEventListener("input", () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) {
        picker.value = text.value;
        updateEditorValue(field, path, text.value);
      }
    });
    wrapper.append(picker, text);
    field.append(wrapper);
    return field;
  }

  const useTextarea = value.length > 90 || ["description", "summary", "paragraph", "locations"].some((part) => key.toLowerCase().includes(part));
  const input = document.createElement(useTextarea ? "textarea" : "input");
  if (input instanceof HTMLInputElement) input.type = key.toLowerCase().includes("email") ? "email" : "text";
  input.value = value;
  input.maxLength = path.endsWith(".alt") ? 300 : 1500;
  configureTextCorrection(input, key);
  input.addEventListener("input", () => {
    updateEditorValue(field, path, input.value);
  });
  field.append(input);
  return field;
}

function renderValue(key, value, path, container) {
  if (typeof value === "string") {
    container.append(createField(path, value));
    return;
  }

  if (Array.isArray(value)) {
    const { min, max } = getArrayLimits(path);
    const array = document.createElement("section");
    array.className = "admin-array";
    array.setAttribute("aria-label", `${humanize(key)} items`);

    value.forEach((item, index) => {
      const itemFieldset = document.createElement("fieldset");
      itemFieldset.className = "admin-item";
      const legend = document.createElement("legend");
      legend.textContent = `${humanize(key)} ${index + 1}`;
      itemFieldset.append(legend);

      const controls = document.createElement("div");
      controls.className = "admin-item-controls";
      const addControl = (label, action, disabled = false) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = disabled;
        button.addEventListener("click", action);
        controls.append(button);
      };
      addControl("Move up", () => {
        [value[index - 1], value[index]] = [value[index], value[index - 1]];
        commitArrayChange();
      }, index === 0);
      addControl("Move down", () => {
        [value[index], value[index + 1]] = [value[index + 1], value[index]];
        commitArrayChange();
      }, index === value.length - 1);
      addControl("Remove", () => {
        value.splice(index, 1);
        commitArrayChange();
      }, value.length <= min);
      itemFieldset.append(controls);

      if (item && typeof item === "object") {
        for (const [childKey, childValue] of Object.entries(item)) {
          renderValue(childKey, childValue, `${path}.${index}.${childKey}`, itemFieldset);
        }
      } else {
        itemFieldset.append(createField(`${path}.${index}`, item));
      }
      array.append(itemFieldset);
    });

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "admin-array-add";
    addButton.textContent = `Add ${humanize(key).replace(/s$/, "")}`;
    addButton.disabled = value.length >= max;
    addButton.addEventListener("click", () => {
      value.push(createEmptyItem(value[0]));
      commitArrayChange();
    });
    array.append(addButton);
    const hint = document.createElement("p");
    hint.className = "admin-field-hint";
    hint.textContent = `Add, remove, or reorder items (${min}–${max} allowed).`;
    array.append(hint);
    container.append(array);
    return;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    renderValue(childKey, childValue, `${path}.${childKey}`, container);
  }
}

function renderEditor(content, preserveState = false) {
  const openGroups = new Set(
    [...contentFields.querySelectorAll(".admin-group[open]")].map((group) => group.dataset.group)
  );
  contentFields.replaceChildren();
  for (const [key, value] of Object.entries(content)) {
    const group = document.createElement("details");
    group.className = "admin-group";
    group.dataset.group = key;
    group.open = preserveState ? openGroups.has(key) : ["branding", "home", "stats"].includes(key);
    const summary = document.createElement("summary");
    summary.textContent = humanize(key);
    const body = document.createElement("div");
    body.className = "admin-group-body";
    renderValue(key, value, key, body);
    group.append(summary, body);
    contentFields.append(group);
  }
  applyEditorSearch();
}

function renderHistory(versions) {
  historyList.replaceChildren();
  versions.forEach((version, index) => {
    const item = document.createElement("article");
    item.className = "history-version";

    const details = document.createElement("div");
    const time = document.createElement("time");
    const publishedDate = new Date(version.publishedAt);
    time.textContent = Number.isNaN(publishedDate.getTime())
      ? String(version.publishedAt)
      : publishedDate.toLocaleString();
    if (!Number.isNaN(publishedDate.getTime())) {
      time.dateTime = publishedDate.toISOString();
    }

    const note = document.createElement("p");
    note.textContent = index === 0 ? "Current published version" : `Published version ${version.id}`;
    details.append(time, note);

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.textContent = "Preview";
    previewButton.addEventListener("click", () => openPreview(version.content));
    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.textContent = "Restore to draft";
    restoreButton.addEventListener("click", () => {
      void restoreHistoryVersion(version.id);
    });
    actions.append(previewButton, restoreButton);
    item.append(details, actions);
    historyList.append(item);
  });
}

async function loadHistory() {
  historyPanel.hidden = false;
  historyList.replaceChildren();
  setStatus(historyStatus, "Loading published versions…");
  try {
    const result = await request("/api/admin/history");
    if (!Array.isArray(result.versions)) {
      throw new Error("The published version list was invalid.");
    }
    if (!result.versions.length) {
      setStatus(historyStatus, "No published versions are available yet.");
      return;
    }
    renderHistory(result.versions);
    setStatus(historyStatus, `Showing the ${result.versions.length} most recent published version${result.versions.length === 1 ? "" : "s"}.`);
  } catch (error) {
    setStatus(historyStatus, error.message, "error");
  }
}

async function restoreHistoryVersion(versionId) {
  if (!window.confirm("Restore this published version to your draft? This replaces the current draft but does not publish it.")) return;
  isDiscarding = true;
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  setStatus(historyStatus, "Restoring version to draft…");
  try {
    if (saveInProgress) await saveInProgress;
    await request(`/api/admin/history/${encodeURIComponent(versionId)}/restore`, {
      method: "POST",
      body: "{}"
    });
    await loadEditor();
    setStatus(editorStatus, "Version restored to draft. Preview it and publish when ready.", "success");
    setStatus(historyStatus, "Version restored to your draft.");
  } catch (error) {
    setStatus(historyStatus, error.message, "error");
  } finally {
    isDiscarding = false;
    if (isDraftDirty()) scheduleAutoSave();
  }
}

contentSearch.addEventListener("input", applyEditorSearch);
document.querySelector("#history-button").addEventListener("click", () => {
  void loadHistory();
});
document.querySelector("#close-history").addEventListener("click", () => {
  historyPanel.hidden = true;
});

async function loadEditor() {
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  const result = await request("/api/admin/content");
  draftContent = result.draft;
  previewContent = draftContent;
  updatePreview();
  savedDraftSnapshot = JSON.stringify(draftContent);
  lastPublishedAt = result.publishedAt;
  renderEditor(draftContent);
  loginPanel.hidden = true;
  editorPanel.hidden = false;
  logoutButton.hidden = false;
  updatePublishState();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  setStatus(loginStatus, "Signing in…");
  try {
    await request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password")
      })
    });
    await loadEditor();
  } catch (error) {
    setStatus(loginStatus, error.message, "error");
  }
});

document.querySelector("#save-button").addEventListener("click", () => {
  void saveDraft();
});

document.querySelector("#publish-button").addEventListener("click", async () => {
  isPublishing = true;
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  setStatus(editorStatus, "Publishing changes…");
  try {
    const saved = await saveDraft();
    if (!saved) return;
    if (isDraftDirty()) {
      setStatus(editorStatus, "Edits made while saving are still pending. Wait for them to save, then publish again.");
      return;
    }
    await request("/api/admin/publish", { method: "POST", body: "{}" });
    lastPublishedAt = new Date().toISOString();
    const hasNewerEdits = updatePublishState();
    setStatus(
      editorStatus,
      hasNewerEdits
        ? "Changes published. Edits made while publishing are still unsaved."
        : "Changes published to the website.",
      "success"
    );
  } catch (error) {
    setStatus(editorStatus, error.message, "error");
  } finally {
    isPublishing = false;
    if (isDraftDirty()) scheduleAutoSave();
  }
});

document.querySelector("#discard-button").addEventListener("click", async () => {
  if (!window.confirm("Discard the saved draft and restore the currently published content?")) return;
  isDiscarding = true;
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  setStatus(editorStatus, "Restoring published content…");
  try {
    if (saveInProgress) await saveInProgress;
    await request("/api/admin/reset-draft", { method: "POST", body: "{}" });
    await loadEditor();
    setStatus(editorStatus, "Draft restored from the published website.", "success");
  } catch (error) {
    setStatus(editorStatus, error.message, "error");
  } finally {
    isDiscarding = false;
    if (isDraftDirty()) scheduleAutoSave();
  }
});

document.querySelector("#preview-button").addEventListener("click", () => {
  openPreview(draftContent);
});

document.querySelector("#close-preview").addEventListener("click", () => {
  previewPanel.hidden = true;
});

document.querySelectorAll("[data-preview-size]").forEach((button) => {
  button.addEventListener("click", () => {
    const size = button.dataset.previewSize;
    previewViewport.dataset.size = size;
    document.querySelectorAll("[data-preview-size]").forEach((sizeButton) => {
      sizeButton.setAttribute("aria-pressed", String(sizeButton === button));
    });
  });
});

logoutButton.addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", { method: "POST", body: "{}" });
    window.location.reload();
  } catch (error) {
    setStatus(editorStatus, error.message, "error");
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && !editorPanel.hidden) {
    event.preventDefault();
    void saveDraft();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!isDraftDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

async function initializeEditor() {
  try {
    const session = await request("/api/admin/session");
    if (!session.configured) {
      setStatus(loginStatus, "The editor is disabled. Configure the admin credentials in .env to enable it.", "error");
      return;
    }
    if (session.authenticated) await loadEditor();
  } catch (error) {
    setStatus(loginStatus, error.message, "error");
  }
}

initializeEditor();
