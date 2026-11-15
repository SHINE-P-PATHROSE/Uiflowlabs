import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { DEFAULT_SITE_CONTENT } from "../src/site-content.js";

async function withServer(pool, run, adminConfig) {
  const server = createApp(pool, adminConfig).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("careers page is served", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/careers.html`);

    assert.equal(response.status, 200);
    assert.match(await response.text(), /Careers at UIFlow Labs/);
  });
});

test("saved content from older editor versions is normalized for public pages and the editor", async () => {
  const legacyContent = structuredClone(DEFAULT_SITE_CONTENT);
  delete legacyContent.branding.brandNameFirst;
  delete legacyContent.home.primaryCtaHref;
  delete legacyContent.intro.alignment;
  delete legacyContent.careers.applyEmail;
  delete legacyContent.contact.emailSubject;

  const pool = {
    async execute(query) {
      if (query.startsWith("SELECT published_content")) {
        return [[{ published_content: JSON.stringify(legacyContent) }], []];
      }
      if (query.startsWith("SELECT draft_content")) {
        return [[{
          draft_content: JSON.stringify(legacyContent),
          published_at: null,
          updated_at: null
        }], []];
      }
      throw new Error(`Unexpected query: ${query}`);
    }
  };
  const adminConfig = {
    username: "site-admin",
    password: "a-strong-password-123",
    sessionSecret: "a-secure-session-secret-that-is-at-least-32-bytes"
  };

  await withServer(pool, async (baseUrl) => {
    const publicResponse = await fetch(`${baseUrl}/api/site-content`);
    const publicContent = (await publicResponse.json()).content;
    assert.equal(publicContent.home.primaryCtaHref, DEFAULT_SITE_CONTENT.home.primaryCtaHref);
    assert.equal(publicContent.contact.emailSubject, DEFAULT_SITE_CONTENT.contact.emailSubject);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ username: adminConfig.username, password: adminConfig.password })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const editorResponse = await fetch(`${baseUrl}/api/admin/content`, {
      headers: { Cookie: cookie }
    });
    const editorContent = (await editorResponse.json()).draft;
    assert.equal(editorContent.branding.brandNameFirst, DEFAULT_SITE_CONTENT.branding.brandNameFirst);
    assert.equal(editorContent.careers.applyEmail, DEFAULT_SITE_CONTENT.careers.applyEmail);
  }, adminConfig);
});

test("admin content requires sign-in and keeps drafts unpublished until publish", async () => {
  let published = structuredClone(DEFAULT_SITE_CONTENT);
  let draft = structuredClone(DEFAULT_SITE_CONTENT);
  let history = [];
  let nextVersionId = 1;
  const pool = {
    async execute(query, values = []) {
      if (query.startsWith("SELECT published_content")) {
        return [[{ published_content: JSON.stringify(published) }], []];
      }
      if (query.trimStart().startsWith("SELECT id, content, created_at")) {
        return [history.slice(0, 25), []];
      }
      if (query.startsWith("SELECT content FROM site_content_history WHERE id = ?")) {
        const version = history.find((item) => item.id === Number(values[0]));
        return [version ? [{ content: JSON.stringify(version.content) }] : [], []];
      }
      if (query.startsWith("SELECT draft_content")) {
        return [[{
          draft_content: JSON.stringify(draft),
          published_at: null,
          updated_at: null
        }], []];
      }
      if (query.startsWith("UPDATE site_content SET draft_content = ?")) {
        draft = JSON.parse(values[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (query.startsWith("UPDATE site_content SET draft_content = published_content")) {
        draft = structuredClone(published);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${query}`);
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(query, values = []) {
          if (query.startsWith("SELECT draft_content FROM site_content WHERE id = 1 FOR UPDATE")) {
            return [[{ draft_content: JSON.stringify(draft) }], []];
          }
          if (query.startsWith("UPDATE site_content SET published_content = ?")) {
            published = JSON.parse(values[0]);
            return [{ affectedRows: 1 }, []];
          }
          if (query.startsWith("INSERT INTO site_content_history (content) VALUES (?)")) {
            history.unshift({
              id: nextVersionId++,
              content: JSON.parse(values[0]),
              created_at: new Date("2026-01-01T00:00:00.000Z")
            });
            return [{ insertId: history[0].id }, []];
          }
          throw new Error(`Unexpected transaction query: ${query}`);
        }
      };
    }
  };
  const adminConfig = {
    username: "site-admin",
    password: "a-strong-password-123",
    sessionSecret: "a-secure-session-secret-that-is-at-least-32-bytes"
  };

  await withServer(pool, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/admin/content`);
    assert.equal(unauthorized.status, 401);
    const unauthorizedHistory = await fetch(`${baseUrl}/api/admin/history`);
    assert.equal(unauthorizedHistory.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ username: adminConfig.username, password: adminConfig.password })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];

    const changedContent = structuredClone(DEFAULT_SITE_CONTENT);
    changedContent.home.desktopTitleFirst = "A new headline";
    const save = await fetch(`${baseUrl}/api/admin/content`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        Cookie: cookie
      },
      body: JSON.stringify({ content: changedContent })
    });
    assert.equal(save.status, 200);

    const publicContentBeforePublish = await fetch(`${baseUrl}/api/site-content`);
    assert.equal((await publicContentBeforePublish.json()).content.home.desktopTitleFirst, "Ideas Into Digital");

    const invalidContent = structuredClone(changedContent);
    invalidContent.work.items[0].image = "../../outside.png";
    const rejectedSave = await fetch(`${baseUrl}/api/admin/content`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        Cookie: cookie
      },
      body: JSON.stringify({ content: invalidContent })
    });
    assert.equal(rejectedSave.status, 400);

    const publish = await fetch(`${baseUrl}/api/admin/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
      body: "{}"
    });
    assert.equal(publish.status, 200);
    const publicContentAfterPublish = await fetch(`${baseUrl}/api/site-content`);
    assert.equal((await publicContentAfterPublish.json()).content.home.desktopTitleFirst, "A new headline");

    const firstHistoryResponse = await fetch(`${baseUrl}/api/admin/history`, {
      headers: { Cookie: cookie }
    });
    const firstHistory = await firstHistoryResponse.json();
    assert.equal(firstHistoryResponse.status, 200);
    assert.equal(firstHistory.versions.length, 1);
    assert.equal(firstHistory.versions[0].content.home.desktopTitleFirst, "A new headline");

    const secondContent = structuredClone(changedContent);
    secondContent.home.desktopTitleFirst = "A later headline";
    await fetch(`${baseUrl}/api/admin/content`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        Cookie: cookie
      },
      body: JSON.stringify({ content: secondContent })
    });
    await fetch(`${baseUrl}/api/admin/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
      body: "{}"
    });

    const restore = await fetch(`${baseUrl}/api/admin/history/${firstHistory.versions[0].id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
      body: "{}"
    });
    assert.equal(restore.status, 200);
    const restoredDraft = await fetch(`${baseUrl}/api/admin/content`, {
      headers: { Cookie: cookie }
    });
    assert.equal((await restoredDraft.json()).draft.home.desktopTitleFirst, "A new headline");
    const stillPublished = await fetch(`${baseUrl}/api/site-content`);
    assert.equal((await stillPublished.json()).content.home.desktopTitleFirst, "A later headline");

    const missingVersion = await fetch(`${baseUrl}/api/admin/history/999/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
      body: "{}"
    });
    assert.equal(missingVersion.status, 404);
  }, adminConfig);
});

test("admin content endpoints stay disabled without server credentials", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/content`);
    assert.equal(response.status, 503);
  });
});

test("contact endpoint stores validated fields and returns success", async () => {
  let inserted;
  const pool = {
    async execute(query, values) {
      inserted = { query, values };
      return [{ insertId: 1 }];
    }
  };

  await withServer(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alex Doe",
        email: "alex@example.com",
        service: "Website development",
        message: "I need a new site."
      })
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      message: "Thanks for reaching out. We'll be in touch soon."
    });
  });

  assert.equal(inserted.query, "INSERT INTO contact_messages (name, email, service, message) VALUES (?, ?, ?, ?)");
  assert.deepEqual(inserted.values, ["Alex Doe", "alex@example.com", "Website development", "I need a new site."]);
});

test("contact endpoint rejects invalid input without writing to the database", async () => {
  let wasWritten = false;
  const pool = { async execute() { wasWritten = true; } };

  await withServer(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alex", email: "invalid", message: "Hello" })
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /email/i);
  });

  assert.equal(wasWritten, false);
});
