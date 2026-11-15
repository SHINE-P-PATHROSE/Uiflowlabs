const services = new Set([
  "UI/UX & product design",
  "Website development",
  "Mobile app development",
  "Graphic design & branding",
  "Motion & video",
  "Digital marketing",
  "AI & automation",
  "Custom software",
  "Creative & advertising",
  "Other"
]);

export function validateContact(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Please submit a valid inquiry." };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const service = typeof body.service === "string" ? body.service.trim() : "";

  if (!name || name.length > 100) {
    return { error: "Please enter your name (up to 100 characters)." };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter a valid email address." };
  }
  if (!message || message.length > 5000) {
    return { error: "Please enter a message (up to 5,000 characters)." };
  }
  if (body.service !== undefined && typeof body.service !== "string") {
    return { error: "Please select a valid service." };
  }
  if (service && (service.length > 100 || !services.has(service))) {
    return { error: "Please select a valid service." };
  }

  return {
    value: {
      name,
      email,
      service: service || null,
      message
    }
  };
}
