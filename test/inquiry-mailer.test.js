import test from "node:test";
import assert from "node:assert/strict";
import { createInquiryEmailMessage } from "../src/inquiry-mailer.js";

test("inquiry notification is addressed to the team and replies to the client", () => {
  const mail = createInquiryEmailMessage({
    name: "Alex Doe",
    email: "alex@example.com",
    service: "Website development",
    message: "I need a new site."
  }, "info.uiflowlabs@gmail.com", "info.uiflowlabs@gmail.com");

  assert.equal(mail.from.address, "info.uiflowlabs@gmail.com");
  assert.equal(mail.to, "info.uiflowlabs@gmail.com");
  assert.equal(mail.replyTo, "alex@example.com");
  assert.match(mail.subject, /inquiry/i);
  assert.match(mail.text, /Alex Doe/);
  assert.match(mail.text, /Website development/);
  assert.match(mail.text, /I need a new site\./);
  assert.match(mail.html, /<h1[^>]*>New project inquiry<\/h1>/);
  assert.match(mail.html, /href="mailto:alex@example\.com\?subject=Re%3A/);
});

test("inquiry notification escapes client-provided HTML", () => {
  const mail = createInquiryEmailMessage({
    name: "<img src=x onerror=alert(1)>",
    email: "alex@example.com",
    service: "Other",
    message: "<script>alert('hello')</script>"
  }, "info.uiflowlabs@gmail.com", "info.uiflowlabs@gmail.com");

  assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(mail.html, /&lt;script&gt;alert\(&#39;hello&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(mail.html, /<script>/);
});
