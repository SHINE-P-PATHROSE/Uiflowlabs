import test from "node:test";
import assert from "node:assert/strict";
import { validateContact } from "../src/contact.js";

test("valid inquiry is trimmed and normalized", () => {
  assert.deepEqual(validateContact({
    name: "  Alex Doe ",
    email: " alex@example.com ",
    service: "Website development",
    message: "  I need a new site. "
  }), {
    value: {
      name: "Alex Doe",
      email: "alex@example.com",
      service: "Website development",
      message: "I need a new site."
    }
  });
});

test("empty optional service is stored as null", () => {
  assert.equal(validateContact({
    name: "Alex",
    email: "alex@example.com",
    service: "",
    message: "Hello"
  }).value.service, null);
});

test("invalid and oversized fields are rejected", () => {
  const valid = { name: "Alex", email: "alex@example.com", message: "Hello" };

  assert.ok(validateContact(null).error);
  assert.match(validateContact({ ...valid, email: "not-an-email" }).error, /email/i);
  assert.match(validateContact({ ...valid, name: " " }).error, /name/i);
  assert.match(validateContact({ ...valid, message: " " }).error, /message/i);
  assert.match(validateContact({ ...valid, message: "x".repeat(5001) }).error, /message/i);
  assert.match(validateContact({ ...valid, service: "Unsupported" }).error, /service/i);
  assert.match(validateContact({ ...valid, service: {} }).error, /service/i);
});
