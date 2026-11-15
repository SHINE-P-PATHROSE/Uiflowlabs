export const DEFAULT_SITE_CONTENT = {
  branding: {
    brandNameFirst: "UI FLOW",
    brandNameSecond: "LABS",
    logo: "assets/uiflowlabs-mark.png",
    accent: "#393da6",
    accentBright: "#585cf0"
  },
  home: {
    desktopTitleFirst: "Ideas Into Digital",
    desktopTitleSecond: "Impact",
    mobileTitleFirst: "Ideas Into",
    mobileTitleSecond: "Digital Impact",
    ctaText: "Explore Our Work",
    primaryCtaHref: "#work",
    secondaryCtaText: "What We Do",
    secondaryCtaHref: "#services"
  },
  stats: [
    { value: "250+", label: "Project Completed" },
    { value: "100+", label: "Happy Clients" },
    { value: "1+", label: "Years Of Experience" }
  ],
  intro: {
    kicker: "SMALL DETAILS. BIGGER PICTURE.",
    startText: "Good ideas deserve",
    highlightText: "great execution.",
    alignment: "left"
  },
  services: {
    eyebrow: "From first sketch to what's next",
    titleFirst: "All the right pieces.",
    titleSecond: "One creative team.",
    summary: "A creative technology agency for the whole journey: strategy, design, development, and everything that helps your business grow.",
    items: [
      { title: "UI/UX & product design", description: "Clear, considered experiences built around the people who use them." },
      { title: "Website development", description: "Fast, responsive websites that make a great first impression and keep working." },
      { title: "Mobile app development", description: "Useful mobile experiences, designed for the way people really live." },
      { title: "Graphic design & branding", description: "Distinctive identities and visual systems that help your brand feel like you." },
      { title: "Motion & video", description: "Bring your message to life with motion, animation, and video production." },
      { title: "Digital marketing", description: "Thoughtful digital campaigns to reach the right people and grow your presence." },
      { title: "AI & automation", description: "Practical, purposeful automation that helps make everyday work flow better." },
      { title: "Custom software", description: "Software solutions shaped around your business, your people, and your goals." },
      { title: "Creative & advertising", description: "Fresh creative, made to give your ideas a voice and a place in the world." }
    ]
  },
  work: {
    eyebrow: "A few things we've made",
    titleFirst: "Ideas, out in",
    titleSecond: "the world.",
    summary: "A glimpse of the visual worlds, digital products, and brand ideas our team loves bringing to life.",
    items: [
      { category: "PRODUCT DESIGN", title: "Interfaces with intention.", image: "assets/product-design-dashboard.jpg", alt: "Interface and product design dashboard concept" },
      { category: "MOBILE APP DESIGN", title: "A brighter everyday.", image: "assets/mobile-app.jpg", alt: "Colorful mobile app and product design concept" },
      { category: "WEB DEVELOPMENT", title: "Websites built to move.", image: "assets/web-development.jpg", alt: "Website concept presented on a desktop screen" },
      { category: "GRAPHIC DESIGN", title: "Made to make a mark.", image: "assets/campaign-design.jpg", alt: "Bold black and green graphic design campaign" },
      { category: "CREATIVE & MOTION", title: "A little more feeling.", image: "assets/creative-motion.jpg", alt: "Vibrant orange creative direction and motion concept" },
      { category: "DIGITAL EXPERIENCES", title: "Built around people.", image: "assets/product-trust.jpg", alt: "Digital trust and product experience concept" }
    ]
  },
  about: {
    eyebrow: "A little about us",
    titleFirst: "Creativity at the table.",
    titleSecond: "Technology in the toolkit.",
    paragraphs: [
      "UIFlow Labs is a creative technology agency dedicated to turning ideas into meaningful digital experiences. We bring design, development, and strategic thinking together to help businesses build a stronger digital presence.",
      "From shaping memorable brand identities to building useful digital products, we care about quality, functionality, and the experience people have along the way. Every business has its own vision. Our job is to help bring it to life."
    ]
  },
  careers: {
    eyebrow: "Careers at UIFlow Labs",
    titleFirst: "Make good ideas",
    titleSecond: "happen.",
    description: "Bring your perspective to a team working across design, technology, and creative problem-solving. Tell us about the work you care about and how you could contribute.",
    focusEyebrow: "Ways to contribute",
    focusTitleFirst: "Good work takes",
    focusTitleSecond: "different perspectives.",
    focusSummary: "Our projects bring together people with different strengths. Here are some of the areas our work spans.",
    ctaEyebrow: "Interested in working together?",
    ctaTitleFirst: "Tell us what",
    ctaTitleSecond: "you bring.",
    applyDescription: "Share your CV and portfolio, and tell us a little about the kind of work you want to do.",
    applyButtonText: "Send your CV",
    applyEmail: "info.uiflowlabs@gmail.com",
    emailSubject: "Careers at UIFlow Labs",
    areas: [
      { title: "Design & product", description: "Shape clear, thoughtful interfaces, digital products, and brand experiences." },
      { title: "Engineering & technology", description: "Build websites, mobile apps, custom software, and practical automation." },
      { title: "Creative & growth", description: "Bring ideas to life through visual storytelling, motion, campaigns, and marketing." }
    ]
  },
  contact: {
    eyebrow: "Have a good one in mind?",
    titleFirst: "Let's make it",
    titleSecond: "happen.",
    ctaText: "Start a conversation",
    description: "Have an idea, a challenge, or a project in mind? We'd love to hear what you're working on.",
    email: "info.uiflowlabs@gmail.com",
    emailSubject: "Let's work together",
    locationsLabel: "WORKING ACROSS",
    locations: "UAE · Qatar · India"
  }
};

const arrayLimits = {
  "content.stats": { min: 1, max: 6 },
  "content.services.items": { min: 1, max: 12 },
  "content.work.items": { min: 1, max: 24 },
  "content.about.paragraphs": { min: 1, max: 8 },
  "content.careers.areas": { min: 1, max: 12 }
};

const homeCtaTargets = new Set(["#work", "#services", "#contact"]);

export function normalizeSiteContent(value, shape = DEFAULT_SITE_CONTENT) {
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return value;
    return value.map((item) => normalizeSiteContent(item, shape[0]));
  }

  if (shape && typeof shape === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const normalized = { ...value };
    for (const [key, defaultValue] of Object.entries(shape)) {
      normalized[key] = Object.hasOwn(value, key)
        ? normalizeSiteContent(value[key], defaultValue)
        : structuredClone(defaultValue);
    }
    return normalized;
  }

  return value;
}

function validateValue(value, shape, path) {
  if (typeof shape === "string") {
    if (typeof value !== "string") return { error: `${path} must be text.` };
    const trimmed = value.trim();
    const maxLength = path.endsWith(".alt") ? 300 : path.endsWith("emailSubject") ? 120 : 1500;
    if (trimmed.length > maxLength) return { error: `${path} must be ${maxLength} characters or fewer.` };
    if (!trimmed && !path.endsWith(".alt")) return { error: `${path} cannot be empty.` };

    if (path.endsWith(".accent") || path.endsWith(".accentBright")) {
      if (!/^#[0-9a-f]{6}$/i.test(trimmed)) return { error: `${path} must be a six-digit hex color.` };
    }

    if (path.endsWith(".logo") || path.endsWith(".image")) {
      const pathParts = trimmed.split("/");
      if (!/^(assets|uploads)\/[a-z0-9][a-z0-9._/-]*$/i.test(trimmed) || pathParts.includes("..")) {
        return { error: `${path} must point to an image in assets or uploads.` };
      }
    }

    if (
      ["content.contact.email", "content.careers.applyEmail"].includes(path)
      && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    ) {
      return { error: `${path} must be a valid email address.` };
    }

    if (path === "content.intro.alignment" && !["left", "center"].includes(trimmed)) {
      return { error: `${path} must be left or center.` };
    }

    if (
      ["content.home.primaryCtaHref", "content.home.secondaryCtaHref"].includes(path)
      && !homeCtaTargets.has(trimmed)
    ) {
      return { error: `${path} must point to a supported homepage section.` };
    }

    return { value: trimmed };
  }

  if (Array.isArray(shape)) {
    const limits = arrayLimits[path];
    const minItems = limits?.min ?? shape.length;
    const maxItems = limits?.max ?? shape.length;
    if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
      return { error: `${path} must contain between ${minItems} and ${maxItems} items.` };
    }

    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = validateValue(value[index], shape[0], `${path}.${index}`);
      if (item.error) return item;
      result.push(item.value);
    }
    return { value: result };
  }

  if (shape && typeof shape === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: `${path} must be an object.` };
    }

    const expectedKeys = Object.keys(shape);
    const receivedKeys = Object.keys(value);
    if (expectedKeys.length !== receivedKeys.length || expectedKeys.some((key) => !Object.hasOwn(value, key))) {
      return { error: `${path} has missing or unsupported fields.` };
    }

    const result = {};
    for (const key of expectedKeys) {
      const item = validateValue(value[key], shape[key], path ? `${path}.${key}` : key);
      if (item.error) return item;
      result[key] = item.value;
    }
    return { value: result };
  }

  return { error: `${path} has an unsupported value.` };
}

export function validateSiteContent(value) {
  return validateValue(value, DEFAULT_SITE_CONTENT, "content");
}
