const menuToggle = document.querySelector(".menu-toggle");
const primaryNav = document.querySelector(".primary-nav");
const themeToggle = document.querySelector(".theme-toggle");
const themeColor = document.querySelector('meta[name="theme-color"]');

function getContentValue(content, path) {
  return path.split(".").reduce((value, key) => value?.[key], content);
}

function renderContentLists(content) {
  for (const list of document.querySelectorAll("[data-content-list]")) {
    const items = getContentValue(content, list.dataset.contentList);
    const template = list.querySelector(":scope > template");
    const prototype = template?.content.firstElementChild;
    if (!Array.isArray(items) || !template || !prototype) continue;

    const renderedItems = document.createDocumentFragment();
    items.forEach((item, index) => {
      const element = prototype.cloneNode(true);
      if (list.dataset.contentList === "work.items") {
        element.classList.toggle("work-card-large", index === 0 || index === 4);
      }

      const fields = [element, ...element.querySelectorAll("[data-list-text], [data-list-value], [data-list-image], [data-list-href], [data-list-number], [data-list-aria-label]")];
      for (const field of fields) {
        if (field.hasAttribute("data-list-text") && typeof item?.[field.dataset.listText] === "string") {
          field.textContent = item[field.dataset.listText];
        }
        if (field.hasAttribute("data-list-value") && typeof item === "string") {
          field.textContent = item;
        }
        if (field.hasAttribute("data-list-image")) {
          const image = item?.[field.dataset.listImage];
          if (typeof image === "string" && image.trim()) field.src = image;
          else field.removeAttribute("src");
          field.alt = typeof item?.[field.dataset.listAlt] === "string" ? item[field.dataset.listAlt] : "";
        }
        if (field.hasAttribute("data-list-href")) {
          const href = item?.[field.dataset.listHref];
          if (typeof href === "string" && href.trim()) field.href = href;
          else field.removeAttribute("href");
        }
        if (field.hasAttribute("data-list-aria-label") && typeof item?.[field.dataset.listAriaLabel] === "string") {
          field.setAttribute("aria-label", `View project image: ${item[field.dataset.listAriaLabel]}`);
        }
        if (field.hasAttribute("data-list-number")) {
          field.textContent = String(index + 1).padStart(2, "0");
        }
      }
      renderedItems.append(element);
    });

    list.replaceChildren(template, renderedItems);
  }
}

function applySiteContent(content) {
  renderContentLists(content);

  for (const element of document.querySelectorAll("[data-content]")) {
    const value = getContentValue(content, element.dataset.content);
    if (typeof value === "string") element.textContent = value;
  }

  for (const image of document.querySelectorAll("[data-content-image]")) {
    const value = getContentValue(content, image.dataset.contentImage);
    if (typeof value !== "string") continue;
    image.src = value;
    if (image.dataset.contentAlt) {
      image.alt = getContentValue(content, image.dataset.contentAlt) ?? "";
    }
  }

  for (const link of document.querySelectorAll("[data-content-href]")) {
    const value = getContentValue(content, link.dataset.contentHref);
    if (typeof value === "string") link.href = value;
  }

  for (const link of document.querySelectorAll("[data-content-mailto]")) {
    const value = getContentValue(content, link.dataset.contentMailto);
    if (typeof value === "string") {
      const currentUrl = new URL(link.href);
      const subject = link.dataset.contentMailtoSubject
        ? getContentValue(content, link.dataset.contentMailtoSubject)
        : currentUrl.searchParams.get("subject");
      link.href = `mailto:${value}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
    }
  }

  for (const element of document.querySelectorAll("[data-content-align]")) {
    const value = getContentValue(content, element.dataset.contentAlign);
    if (value === "left" || value === "center") element.dataset.alignment = value;
  }

  for (const element of document.querySelectorAll("[data-content-aria-label]")) {
    const value = getContentValue(content, element.dataset.contentAriaLabel);
    if (typeof value === "string") element.setAttribute("aria-label", value);
  }

  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = content.branding.logo;
  document.documentElement.style.setProperty("--accent", content.branding.accent);
  document.documentElement.style.setProperty("--accent-bright", content.branding.accentBright);
}

let isPreviewingContent = false;
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  if (event.data?.type !== "site-content-preview" || !event.data.content) return;
  isPreviewingContent = true;
  applySiteContent(event.data.content);
});

async function loadPublishedContent() {
  try {
    const response = await fetch("/api/site-content");
    if (!response.ok) throw new Error(`Content request failed (${response.status}).`);
    const { content } = await response.json();
    if (!isPreviewingContent) applySiteContent(content);
  } catch (error) {
    console.error("Unable to load published website content.", error);
  }
}

if (document.body.hasAttribute("data-site-content") && window.location.protocol !== "file:") {
  loadPublishedContent();
}

if (menuToggle && primaryNav) {
  menuToggle.addEventListener("click", () => {
    const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isExpanded));
    menuToggle.setAttribute("aria-label", isExpanded ? "Open navigation" : "Close navigation");
    primaryNav.classList.toggle("is-open", !isExpanded);
  });

  function closeMenu() {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    primaryNav.classList.remove("is-open");
  }

  primaryNav.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

const themeStorageKey = "uiflowlabs-theme";

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle?.setAttribute("aria-pressed", String(isDark));
  themeToggle?.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  themeColor?.setAttribute("content", isDark ? "#111213" : "#ffffff");
}

let savedTheme = "light";
try {
  savedTheme = localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
} catch (error) {
  console.warn("Unable to read the saved theme preference.", error);
}
applyTheme(savedTheme);

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    try {
      localStorage.setItem(themeStorageKey, nextTheme);
    } catch (error) {
      console.warn("Unable to save the theme preference.", error);
    }
  });
}

const year = document.querySelector("#current-year");
if (year) year.textContent = String(new Date().getFullYear());

const sectionLinks = [...document.querySelectorAll('.primary-nav a[href^="#"]')];
const sections = sectionLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter((section) => section instanceof HTMLElement);

if (sections.length) {
  const sectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of sectionLinks) {
        const isCurrent = link.hash === `#${entry.target.id}`;
        link.classList.toggle("is-current", isCurrent);
        if (isCurrent) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
    }
  }, { rootMargin: "-30% 0px -60% 0px" });

  sections.forEach((section) => sectionObserver.observe(section));
}

const contactForm = document.querySelector("#contact-form");
if (contactForm instanceof HTMLFormElement) {
  const contactStatus = document.querySelector("#contact-status");
  const contactSubmit = contactForm.querySelector('button[type="submit"]');

  if (!contactStatus || !contactSubmit) {
    throw new Error("The contact form requires a status element and submit button.");
  }

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    contactSubmit.disabled = true;
    contactStatus.textContent = "Sending your inquiry…";

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(contactForm)))
      });
      const result = await response.json();

      if (!response.ok) {
        contactStatus.textContent = result.error || "We couldn't send your inquiry. Please try again.";
        return;
      }

      contactForm.reset();
      contactStatus.textContent = result.message;
    } catch {
      contactStatus.textContent = "Unable to reach the server. Please try again shortly.";
    } finally {
      contactSubmit.disabled = false;
    }
  });
}

const workViewer = document.querySelector("#work-viewer");
if (workViewer instanceof HTMLDialogElement) {
  const workSection = document.querySelector("#work");
  const viewerImage = document.querySelector("#work-viewer-image");
  const viewerCategory = document.querySelector("#work-viewer-category");
  const viewerTitle = document.querySelector("#work-viewer-title");
  const viewerCount = document.querySelector("#work-viewer-count");
  const previousWork = document.querySelector("#previous-work");
  const nextWork = document.querySelector("#next-work");
  const closeWorkViewer = document.querySelector("#close-work-viewer");
  let activeWorkIndex = 0;
  let lastWorkTrigger;

  function showWork(index) {
    const workCards = [...document.querySelectorAll(".work-card")];
    if (!workCards.length) return;
    activeWorkIndex = (index + workCards.length) % workCards.length;
    const card = workCards[activeWorkIndex];
    const image = card.querySelector(".work-image img");
    viewerImage.src = image.currentSrc || image.src;
    viewerImage.alt = image.alt;
    viewerCategory.textContent = card.querySelector(".work-meta")?.textContent.trim() || "";
    viewerTitle.textContent = card.querySelector("h3")?.textContent.trim() || "";
    viewerCount.textContent = `${activeWorkIndex + 1} of ${workCards.length}`;
  }

  function openWork(index, trigger) {
    if (workViewer.open) return;
    lastWorkTrigger = trigger;
    showWork(index);
    workViewer.showModal();
  }

  workSection?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest(".work-image, .work-view-button");
    if (!trigger || !workSection.contains(trigger)) return;
    const cards = [...workSection.querySelectorAll(".work-card")];
    const index = cards.indexOf(trigger.closest(".work-card"));
    if (index < 0) return;

    if (trigger.matches(".work-image")) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
    }
    openWork(index, trigger);
  });

  previousWork.addEventListener("click", () => showWork(activeWorkIndex - 1));
  nextWork.addEventListener("click", () => showWork(activeWorkIndex + 1));
  closeWorkViewer.addEventListener("click", () => workViewer.close());
  workViewer.addEventListener("click", (event) => {
    if (event.target === workViewer) workViewer.close();
  });
  workViewer.addEventListener("close", () => {
    lastWorkTrigger?.focus();
    lastWorkTrigger = null;
  });
  workViewer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      workViewer.close();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      showWork(activeWorkIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      showWork(activeWorkIndex + 1);
    }
  });
}
