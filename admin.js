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
const inquiriesPanel = document.querySelector("#inquiries-panel");
const inquiryList = document.querySelector("#inquiry-list");
const inquiryStatus = document.querySelector("#inquiry-status");
const inquirySearch = document.querySelector("#inquiry-search");
const inquiryPageLabel = document.querySelector("#inquiry-page");
const previousInquiriesButton = document.querySelector("#previous-inquiries");
const nextInquiriesButton = document.querySelector("#next-inquiries");
const publishState = document.querySelector("#publish-state");
const contentSearch = document.querySelector("#content-search");
const searchStatus = document.querySelector("#search-status");
const undoButton = document.querySelector("#undo-button");
const redoButton = document.querySelector("#redo-button");
const publishSummary = document.querySelector("#publish-summary");
const publishSummaryDescription = document.querySelector("#publish-summary-description");
const publishChangeList = document.querySelector("#publish-change-list");
const scheduleDialog = document.querySelector("#schedule-dialog");
const scheduleAt = document.querySelector("#schedule-at");
const scheduleCurrent = document.querySelector("#schedule-current");
const scheduleStatus = document.querySelector("#schedule-status");
const scheduleChangeList = document.querySelector("#schedule-change-list");
const removeScheduleButton = document.querySelector("#remove-schedule");
const mediaDialog = document.querySelector("#media-dialog");
const mediaGrid = document.querySelector("#media-grid");
const mediaStatus = document.querySelector("#media-status");
const correctionDisabledKeys = new Set(["accent", "accentbright", "email", "href", "image", "link", "logo", "url"]);
let draftContent;
let publishedContent;
let savedDraftSnapshot = null;
const undoStack = [];
const redoStack = [];
let undoCaptureSnapshot = null;
let undoCaptureTimer = null;
let mediaTargetInput = null;
let currentSchedule = null;
let currentInquiryPage = 1;
let inquiryPageCount = 1;
let lastPublishedAt = null;
let previewStarted = false;
let previewContent = null;
let autoSaveTimer = null;
let saveInProgress = null;
let isPublishing = false;
let isPreparingPublish = false;
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
  recordUndoState();
  setPathValue(draftContent, path, value);
  updatePublishState();
  scheduleAutoSave();
  previewContent = draftContent;
  updatePreview();
}

function updateUndoRedoButtons() {
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function flushUndoCapture() {
  window.clearTimeout(undoCaptureTimer);
  undoCaptureTimer = null;
  if (undoCaptureSnapshot === null) return;
  if (undoCaptureSnapshot !== JSON.stringify(draftContent)) {
    undoStack.push(undoCaptureSnapshot);
    redoStack.length = 0;
    updateUndoRedoButtons();
  }
  undoCaptureSnapshot = null;
}

function recordUndoState() {
  if (undoCaptureSnapshot === null) undoCaptureSnapshot = JSON.stringify(draftContent);
  window.clearTimeout(undoCaptureTimer);
  undoCaptureTimer = window.setTimeout(flushUndoCapture, 600);
}

function restoreEditorSnapshot(snapshot) {
  draftContent = JSON.parse(snapshot);
  previewContent = draftContent;
  updatePreview();
  updatePublishState();
  scheduleAutoSave();
  renderEditor(draftContent, true);
}

function undoEdit() {
  flushUndoCapture();
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(draftContent));
  restoreEditorSnapshot(undoStack.pop());
  updateUndoRedoButtons();
}

function redoEdit() {
  flushUndoCapture();
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(draftContent));
  restoreEditorSnapshot(redoStack.pop());
  updateUndoRedoButtons();
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
    "careers.areas": { min: 1, max: 12 },
    "layout.homeSectionOrder": { min: 7, max: 7 }
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
  }[path] || (path.startsWith("layout.homeSectionOrder.")
    ? [
      ["home", "Hero"],
      ["stats", "Stats"],
      ["intro", "Intro"],
      ["services", "Services"],
      ["work", "Work"],
      ["about", "About"],
      ["contact", "Contact"]
    ]
    : null);
  if (selectOptions) {
    const select = document.createElement("select");
    for (const [optionValue, label] of selectOptions) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = label;
      select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => {
      if (path.startsWith("layout.homeSectionOrder.")) {
        const order = draftContent.layout.homeSectionOrder;
        const index = Number(path.split(".").at(-1));
        const otherIndex = order.indexOf(select.value);
        if (otherIndex >= 0 && otherIndex !== index) {
          recordUndoState();
          [order[index], order[otherIndex]] = [order[otherIndex], order[index]];
          commitArrayChange();
          return;
        }
      }
      updateEditorValue(field, path, select.value);
    });
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
    const browse = document.createElement("button");
    browse.type = "button";
    browse.className = "admin-media-browse";
    browse.textContent = "Browse media library";
    browse.addEventListener("click", () => {
      void openMediaLibrary(input);
    });
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
    field.append(input, browse, hint, file, preview);
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
  if (typeof value === "boolean") {
    const field = document.createElement("label");
    field.className = "admin-field admin-toggle-field";
    field.dataset.search = `${path} ${value ? "visible enabled on" : "hidden disabled off"}`.toLowerCase();
    const title = document.createElement("span");
    title.textContent = humanize(key);
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = value;
    toggle.addEventListener("change", () => updateEditorValue(field, path, toggle.checked));
    field.append(title, toggle);
    container.append(field);
    return;
  }

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
      legend.textContent = `${humanize(key)} ${index + 1}${item?.visible === false ? " (hidden)" : ""}`;
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
      addControl("Duplicate", () => {
        recordUndoState();
        value.splice(index + 1, 0, structuredClone(value[index]));
        commitArrayChange();
      }, value.length >= max);
      addControl("Move up", () => {
        recordUndoState();
        [value[index - 1], value[index]] = [value[index], value[index - 1]];
        commitArrayChange();
      }, index === 0);
      addControl("Move down", () => {
        recordUndoState();
        [value[index], value[index + 1]] = [value[index + 1], value[index]];
        commitArrayChange();
      }, index === value.length - 1);
      addControl("Remove", () => {
        recordUndoState();
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
      recordUndoState();
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

function formatChangePath(path) {
  return path
    .map((part) => /^\d+$/.test(part) ? `Item ${Number(part) + 1}` : humanize(part))
    .join(" / ");
}

function formatChangeValue(value) {
  if (value === undefined) return "removed";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 140 ? `${text.slice(0, 137)}…` : text || "(empty)";
}

function collectContentChanges(before, after, path = [], changes = []) {
  if (changes.length >= 100 || Object.is(before, after)) return changes;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      collectContentChanges(before[index], after[index], [...path, String(index)], changes);
    }
    return changes;
  }
  if (
    before && after
    && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after)
  ) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      collectContentChanges(before[key], after[key], [...path, key], changes);
    }
    return changes;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    changes.push({ path: formatChangePath(path), before, after });
  }
  return changes;
}

function showPublishSummary(changes) {
  publishChangeList.replaceChildren();
  publishSummaryDescription.textContent = `${changes.length} content change${changes.length === 1 ? "" : "s"} will become public.`;
  renderChangeList(publishChangeList, changes);
}

function renderChangeList(list, changes) {
  list.replaceChildren();
  for (const change of changes.slice(0, 50)) {
    const item = document.createElement("li");
    const path = document.createElement("strong");
    path.textContent = change.path;
    const values = document.createElement("span");
    values.textContent = `${formatChangeValue(change.before)} → ${formatChangeValue(change.after)}`;
    item.append(path, values);
    list.append(item);
  }
  if (changes.length > 50) {
    const remaining = document.createElement("li");
    remaining.textContent = `And ${changes.length - 50} more changes.`;
    list.append(remaining);
  }
}

async function openMediaLibrary(targetInput = null) {
  mediaTargetInput = targetInput;
  mediaDialog.showModal();
  await loadMediaLibrary();
}

async function loadMediaLibrary() {
  mediaGrid.replaceChildren();
  setStatus(mediaStatus, "Loading images…");
  try {
    const result = await request("/api/admin/media");
    if (!Array.isArray(result.items)) throw new Error("The media library response was invalid.");
    if (!result.items.length) {
      setStatus(mediaStatus, "No images are available yet.");
      return;
    }

    for (const asset of result.items) {
      const card = document.createElement("article");
      card.className = "media-card";
      const image = document.createElement("img");
      image.src = `/${asset.path}`;
      image.alt = "";
      image.loading = "lazy";
      const path = document.createElement("p");
      path.textContent = asset.path;
      const actions = document.createElement("div");
      actions.className = "media-card-actions";
      const useButton = document.createElement("button");
      useButton.type = "button";
      useButton.textContent = mediaTargetInput ? "Use image" : "Choose from an image field";
      useButton.disabled = !mediaTargetInput;
      useButton.addEventListener("click", () => {
        if (!mediaTargetInput) return;
        mediaTargetInput.value = asset.path;
        mediaTargetInput.dispatchEvent(new Event("input", { bubbles: true }));
        mediaDialog.close();
      });
      actions.append(useButton);

      if (asset.source === "uploads") {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Remove upload";
        deleteButton.disabled = mediaTargetInput?.value === asset.path;
        deleteButton.addEventListener("click", async () => {
          if (!window.confirm(`Remove ${asset.path}? Images used by the current draft or published site cannot be removed.`)) return;
          try {
            await request(`/api/admin/media/${encodeURIComponent(asset.filename)}`, { method: "DELETE" });
            await loadMediaLibrary();
          } catch (error) {
            setStatus(mediaStatus, error.message, "error");
          }
        });
        actions.append(deleteButton);
      }

      card.append(image, path, actions);
      mediaGrid.append(card);
    }
    setStatus(mediaStatus, `${result.items.length} image${result.items.length === 1 ? "" : "s"} available.`);
  } catch (error) {
    setStatus(mediaStatus, error.message, "error");
  }
}

function localDateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function renderCurrentSchedule() {
  const scheduledAt = currentSchedule ? new Date(currentSchedule.publishAt) : null;
  scheduleCurrent.textContent = scheduledAt && !Number.isNaN(scheduledAt.getTime())
    ? `Currently scheduled for ${scheduledAt.toLocaleString()}. Scheduling again replaces this time.`
    : "No publish is scheduled.";
  removeScheduleButton.hidden = !currentSchedule;
}

async function openScheduleDialog() {
  scheduleStatus.textContent = "";
  scheduleChangeList.replaceChildren();
  scheduleAt.min = localDateTimeValue(new Date(Date.now() + 60_000));
  scheduleAt.max = localDateTimeValue(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
  try {
    const result = await request("/api/admin/schedule");
    currentSchedule = result.schedule || null;
    renderCurrentSchedule();
    scheduleAt.value = currentSchedule
      ? localDateTimeValue(new Date(currentSchedule.publishAt))
      : "";
    renderChangeList(scheduleChangeList, collectContentChanges(publishedContent, draftContent));
    scheduleDialog.showModal();
  } catch (error) {
    setStatus(editorStatus, error.message, "error");
  }
}

async function schedulePublish() {
  const publishDate = new Date(scheduleAt.value);
  if (!scheduleAt.value || Number.isNaN(publishDate.getTime())) {
    setStatus(scheduleStatus, "Choose a valid date and time.", "error");
    return;
  }
  if (publishDate.getTime() < Date.now() + 60_000 || publishDate.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
    setStatus(scheduleStatus, "Choose a time at least one minute from now and within the next year.", "error");
    return;
  }

  const changes = collectContentChanges(publishedContent, draftContent);
  if (!changes.length) {
    setStatus(scheduleStatus, "There are no content changes to schedule.", "error");
    return;
  }

  const button = document.querySelector("#confirm-schedule");
  button.disabled = true;
  setStatus(scheduleStatus, "Saving the scheduled version…");
  try {
    const saved = await saveDraft();
    if (!saved) return;
    if (isDraftDirty()) {
      setStatus(scheduleStatus, "Newer edits are still saving. Wait a moment and try scheduling again.", "error");
      return;
    }
    const result = await request("/api/admin/schedule", {
      method: "POST",
      body: JSON.stringify({ publishAt: publishDate.toISOString(), content: draftContent })
    });
    currentSchedule = result.schedule;
    renderCurrentSchedule();
    setStatus(scheduleStatus, `Publish scheduled for ${new Date(result.schedule.publishAt).toLocaleString()}.`, "success");
    setStatus(editorStatus, "A version is scheduled to publish automatically.", "success");
  } catch (error) {
    setStatus(scheduleStatus, error.message, "error");
  } finally {
    button.disabled = false;
  }
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

function renderInquiries(inquiries) {
  inquiryList.replaceChildren();
  for (const inquiry of inquiries) {
    const card = document.createElement("article");
    card.className = "inquiry-card";
    const header = document.createElement("div");
    header.className = "inquiry-card-header";
    const name = document.createElement("h3");
    name.textContent = inquiry.name;
    const received = document.createElement("time");
    const date = new Date(inquiry.createdAt);
    received.textContent = Number.isNaN(date.getTime()) ? inquiry.createdAt : date.toLocaleString();
    if (!Number.isNaN(date.getTime())) received.dateTime = date.toISOString();
    header.append(name, received);

    const contact = document.createElement("div");
    contact.className = "inquiry-contact";
    const email = document.createElement("a");
    email.href = `mailto:${encodeURIComponent(inquiry.email).replaceAll("%40", "@")}`;
    email.textContent = inquiry.email;
    contact.append(email);
    if (inquiry.service) {
      const service = document.createElement("span");
      service.textContent = inquiry.service;
      contact.append(service);
    }

    const message = document.createElement("p");
    message.className = "inquiry-message";
    message.textContent = inquiry.message;
    card.append(header, contact, message);
    inquiryList.append(card);
  }
}

async function loadInquiries(page = 1) {
  inquiryList.replaceChildren();
  setStatus(inquiryStatus, "Loading inquiries…");
  try {
    const params = new URLSearchParams({
      page: String(page),
      q: inquirySearch.value.trim()
    });
    const result = await request(`/api/admin/inquiries?${params}`);
    if (
      !Array.isArray(result.inquiries)
      || !Number.isSafeInteger(result.pagination?.page)
      || !Number.isSafeInteger(result.pagination?.pageCount)
      || !Number.isSafeInteger(result.pagination?.total)
    ) {
      throw new Error("The inquiry inbox response was invalid.");
    }
    currentInquiryPage = result.pagination.page;
    inquiryPageCount = result.pagination.pageCount;
    renderInquiries(result.inquiries);
    inquiryPageLabel.textContent = `Page ${currentInquiryPage} of ${inquiryPageCount} · ${result.pagination.total} total`;
    previousInquiriesButton.disabled = currentInquiryPage <= 1;
    nextInquiriesButton.disabled = currentInquiryPage >= inquiryPageCount;
    setStatus(
      inquiryStatus,
      result.inquiries.length
        ? `Showing ${result.inquiries.length} ${result.inquiries.length === 1 ? "inquiry" : "inquiries"} on this page.`
        : "No inquiries match this search."
    );
  } catch (error) {
    setStatus(inquiryStatus, error.message, "error");
  }
}

async function exportInquiries() {
  const params = new URLSearchParams({ q: inquirySearch.value.trim() });
  setStatus(inquiryStatus, "Preparing CSV export…");
  try {
    const response = await fetch(`/api/admin/inquiries/export?${params}`, {
      credentials: "same-origin"
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result?.error || `Export failed (${response.status}).`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const download = document.createElement("a");
    download.href = objectUrl;
    download.download = "uiflowlabs-inquiries.csv";
    download.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setStatus(inquiryStatus, "Inquiry CSV downloaded.", "success");
  } catch (error) {
    setStatus(inquiryStatus, error.message, "error");
  }
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
document.querySelector("#inquiries-button").addEventListener("click", () => {
  inquiriesPanel.hidden = false;
  void loadInquiries(1);
});
document.querySelector("#close-inquiries").addEventListener("click", () => {
  inquiriesPanel.hidden = true;
});
document.querySelector("#inquiry-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void loadInquiries(1);
});
document.querySelector("#export-inquiries").addEventListener("click", () => {
  void exportInquiries();
});
previousInquiriesButton.addEventListener("click", () => {
  if (currentInquiryPage > 1) void loadInquiries(currentInquiryPage - 1);
});
nextInquiriesButton.addEventListener("click", () => {
  if (currentInquiryPage < inquiryPageCount) void loadInquiries(currentInquiryPage + 1);
});
document.querySelector("#close-history").addEventListener("click", () => {
  historyPanel.hidden = true;
});
document.querySelector("#media-button").addEventListener("click", () => {
  void openMediaLibrary();
});
document.querySelector("#close-media").addEventListener("click", () => {
  mediaDialog.close();
});
document.querySelector("#schedule-button").addEventListener("click", () => {
  void openScheduleDialog();
});
document.querySelector("#cancel-schedule").addEventListener("click", () => {
  scheduleDialog.close();
});
document.querySelector("#confirm-schedule").addEventListener("click", () => {
  void schedulePublish();
});
removeScheduleButton.addEventListener("click", async () => {
  removeScheduleButton.disabled = true;
  try {
    await request("/api/admin/schedule", { method: "DELETE" });
    currentSchedule = null;
    renderCurrentSchedule();
    setStatus(scheduleStatus, "Scheduled publish cancelled.", "success");
  } catch (error) {
    setStatus(scheduleStatus, error.message, "error");
  } finally {
    removeScheduleButton.disabled = false;
  }
});

async function loadEditor() {
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  window.clearTimeout(undoCaptureTimer);
  undoCaptureTimer = null;
  undoCaptureSnapshot = null;
  const [result, publishedResult] = await Promise.all([
    request("/api/admin/content"),
    request("/api/site-content")
  ]);
  draftContent = result.draft;
  publishedContent = publishedResult.content;
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoRedoButtons();
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

async function publishChanges() {
  if (isPublishing) return;
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
    const publishedSnapshot = JSON.stringify(draftContent);
    await request("/api/admin/publish", { method: "POST", body: "{}" });
    publishedContent = JSON.parse(publishedSnapshot);
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
}

document.querySelector("#publish-button").addEventListener("click", async () => {
  const button = document.querySelector("#publish-button");
  if (isPreparingPublish || isPublishing || publishSummary.open) return;
  isPreparingPublish = true;
  button.disabled = true;
  try {
    const saved = await saveDraft();
    if (!saved) return;
    if (isDraftDirty()) {
      setStatus(editorStatus, "Edits made while saving are still pending. Wait for them to save, then review publishing again.");
      return;
    }
    const changes = collectContentChanges(publishedContent, draftContent);
    if (!changes.length) {
      setStatus(editorStatus, "There are no changes to publish.", "success");
      return;
    }
    showPublishSummary(changes);
    publishSummary.showModal();
  } finally {
    isPreparingPublish = false;
    button.disabled = false;
  }
});

document.querySelector("#cancel-publish").addEventListener("click", () => {
  publishSummary.close();
});

document.querySelector("#confirm-publish").addEventListener("click", () => {
  publishSummary.close();
  void publishChanges();
});

undoButton.addEventListener("click", undoEdit);
redoButton.addEventListener("click", redoEdit);

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
    return;
  }
  const activeElement = document.activeElement;
  const editingText = activeElement instanceof HTMLElement
    && (activeElement.matches("input, textarea, select") || activeElement.isContentEditable);
  if (editingText || editorPanel.hidden || !(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "z" && event.shiftKey) {
    event.preventDefault();
    redoEdit();
  } else if (event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoEdit();
  } else if (event.key.toLowerCase() === "y") {
    event.preventDefault();
    redoEdit();
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
