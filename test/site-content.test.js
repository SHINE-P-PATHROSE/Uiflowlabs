import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SITE_CONTENT, normalizeSiteContent, validateSiteContent } from "../src/site-content.js";

test("default site content passes validation", () => {
  assert.deepEqual(validateSiteContent(DEFAULT_SITE_CONTENT), {
    value: DEFAULT_SITE_CONTENT
  });
});

test("content validation rejects unsafe image paths, invalid colors, and unsupported fields", () => {
  const invalidImage = structuredClone(DEFAULT_SITE_CONTENT);
  invalidImage.work.items[0].image = "../../private.png";
  assert.match(validateSiteContent(invalidImage).error, /image/i);

  const invalidColor = structuredClone(DEFAULT_SITE_CONTENT);
  invalidColor.branding.accent = "red";
  assert.match(validateSiteContent(invalidColor).error, /hex color/i);

  const extraField = { ...structuredClone(DEFAULT_SITE_CONTENT), script: "alert(1)" };
  assert.match(validateSiteContent(extraField).error, /unsupported fields/i);
});

test("contact email and copy lengths are validated", () => {
  const invalidEmail = structuredClone(DEFAULT_SITE_CONTENT);
  invalidEmail.contact.email = "not-an-email";
  assert.match(validateSiteContent(invalidEmail).error, /email/i);

  const oversizedCopy = structuredClone(DEFAULT_SITE_CONTENT);
  oversizedCopy.careers.description = "x".repeat(1501);
  assert.match(validateSiteContent(oversizedCopy).error, /characters or fewer/i);
});

test("editable lists enforce their allowed size limits", () => {
  const tooFewStats = structuredClone(DEFAULT_SITE_CONTENT);
  tooFewStats.stats = [];
  assert.match(validateSiteContent(tooFewStats).error, /between 1 and 6 items/i);

  const maximumStats = structuredClone(DEFAULT_SITE_CONTENT);
  maximumStats.stats = Array.from({ length: 6 }, () => ({ value: "1+", label: "Projects" }));
  assert.deepEqual(validateSiteContent(maximumStats).value.stats, maximumStats.stats);

  const tooManyServices = structuredClone(DEFAULT_SITE_CONTENT);
  tooManyServices.services.items.push(structuredClone(tooManyServices.services.items[0]));
  tooManyServices.services.items.push(structuredClone(tooManyServices.services.items[0]));
  tooManyServices.services.items.push(structuredClone(tooManyServices.services.items[0]));
  tooManyServices.services.items.push(structuredClone(tooManyServices.services.items[0]));
  assert.match(validateSiteContent(tooManyServices).error, /between 1 and 12 items/i);
});

test("section controls accept only supported CTA targets, alignment, and career email", () => {
  const invalidTarget = structuredClone(DEFAULT_SITE_CONTENT);
  invalidTarget.home.primaryCtaHref = "javascript:alert(1)";
  assert.match(validateSiteContent(invalidTarget).error, /supported homepage section/i);

  const invalidAlignment = structuredClone(DEFAULT_SITE_CONTENT);
  invalidAlignment.intro.alignment = "right";
  assert.match(validateSiteContent(invalidAlignment).error, /left or center/i);

  const invalidCareerEmail = structuredClone(DEFAULT_SITE_CONTENT);
  invalidCareerEmail.careers.applyEmail = "not-an-email";
  assert.match(validateSiteContent(invalidCareerEmail).error, /email/i);
});

test("legacy saved content receives defaults for fields added by newer editor versions", () => {
  const legacyContent = structuredClone(DEFAULT_SITE_CONTENT);
  delete legacyContent.branding.brandNameFirst;
  delete legacyContent.home.primaryCtaHref;
  delete legacyContent.intro.alignment;
  delete legacyContent.careers.applyEmail;
  delete legacyContent.contact.emailSubject;

  const normalized = normalizeSiteContent(legacyContent);
  assert.equal(normalized.branding.brandNameFirst, DEFAULT_SITE_CONTENT.branding.brandNameFirst);
  assert.equal(normalized.home.primaryCtaHref, DEFAULT_SITE_CONTENT.home.primaryCtaHref);
  assert.equal(normalized.intro.alignment, DEFAULT_SITE_CONTENT.intro.alignment);
  assert.equal(normalized.careers.applyEmail, DEFAULT_SITE_CONTENT.careers.applyEmail);
  assert.equal(normalized.contact.emailSubject, DEFAULT_SITE_CONTENT.contact.emailSubject);
  assert.deepEqual(validateSiteContent(normalized).value, normalized);
});
