import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { DEFAULT_SITE_CONTENT } from "../src/site-content.js";

async function withServer(pool, run, adminConfig, options) {
  const server = createApp(pool, adminConfig, options).listen(0);
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
          if (query.startsWith("UPDATE site_content_schedule SET content = NULL")) {
            return [{ affectedRows: 1 }, []];
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

test("admin can schedule, inspect, and cancel a future publish", async () => {
  let schedule = null;
  const pool = {
    async execute(query, values = []) {
      if (query.startsWith("SELECT publish_at_ms FROM site_content_schedule")) {
        return [schedule ? [{ publish_at_ms: schedule.publishAtMs }] : [], []];
      }
      if (query.startsWith("INSERT INTO site_content_schedule")) {
        schedule = { content: JSON.parse(values[0]), publishAtMs: values[1] };
        return [{ affectedRows: 1 }, []];
      }
      if (query.startsWith("UPDATE site_content_schedule SET content = NULL")) {
        schedule = null;
        return [{ affectedRows: 1 }, []];
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
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ username: adminConfig.username, password: adminConfig.password })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Cookie: cookie
    };

    const initial = await fetch(`${baseUrl}/api/admin/schedule`, { headers: { Cookie: cookie } });
    assert.deepEqual((await initial.json()).schedule, null);

    const publishAt = new Date(Date.now() + 2 * 60_000).toISOString();
    const scheduled = await fetch(`${baseUrl}/api/admin/schedule`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: DEFAULT_SITE_CONTENT, publishAt })
    });
    assert.equal(scheduled.status, 200);
    assert.equal((await scheduled.json()).schedule.publishAt, publishAt);

    const invalidSchedule = await fetch(`${baseUrl}/api/admin/schedule`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: DEFAULT_SITE_CONTENT,
        publishAt: new Date(Date.now() + 10_000).toISOString()
      })
    });
    assert.equal(invalidSchedule.status, 400);

    const cancelled = await fetch(`${baseUrl}/api/admin/schedule`, {
      method: "DELETE",
      headers: { Origin: baseUrl, Cookie: cookie }
    });
    assert.equal(cancelled.status, 200);
    const afterCancel = await fetch(`${baseUrl}/api/admin/schedule`, { headers: { Cookie: cookie } });
    assert.deepEqual((await afterCancel.json()).schedule, null);
  }, adminConfig);
});

test("admin media library lists images and refuses to remove an in-use upload", async () => {
  const imagePath = "uploads/11111111-2222-4333-8444-555555555555.png";
  const published = structuredClone(DEFAULT_SITE_CONTENT);
  published.work.items[0].image = imagePath;
  const pool = {
    async execute(query) {
      if (query.startsWith("SELECT published_content, draft_content FROM site_content")) {
        return [[{
          published_content: JSON.stringify(published),
          draft_content: JSON.stringify(published)
        }], []];
      }
      if (query.startsWith("SELECT content FROM site_content_schedule")) return [[], []];
      if (query.startsWith("SELECT content FROM site_content_history")) return [[], []];
      throw new Error(`Unexpected query: ${query}`);
    }
  };
  const adminConfig = {
    username: "site-admin",
    password: "a-strong-password-123",
    sessionSecret: "a-secure-session-secret-that-is-at-least-32-bytes"
  };

  await withServer(pool, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ username: adminConfig.username, password: adminConfig.password })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const library = await fetch(`${baseUrl}/api/admin/media`, {
      headers: { Cookie: cookie }
    });
    assert.equal(library.status, 200);
    const items = (await library.json()).items;
    assert.ok(items.some((item) => item.path === "assets/product-design-dashboard.jpg"));

    const removed = await fetch(`${baseUrl}/api/admin/media/${imagePath.split("/")[1]}`, {
      method: "DELETE",
      headers: { Origin: baseUrl, Cookie: cookie }
    });
    assert.equal(removed.status, 409);
  }, adminConfig);
});

test("admin inquiry inbox is protected, searchable, paginated, and exports safe CSV", async () => {
  const inquiries = Array.from({ length: 30 }, (_, index) => ({
    id: index + 1,
    name: index === 29 ? "=formula,cmd" : index === 6 ? "Needle client" : `Client ${index + 1}`,
    email: `client${index + 1}@example.com`,
    service: index === 6 ? "Website development" : "Other",
    message: `Project inquiry ${index + 1}`,
    created_at: new Date(`2026-01-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`)
  }));
  const pool = {
    async execute(query, values = []) {
      if (query.includes("WHERE COALESCE(tracking.status, 'new') = 'new'")) {
        return [[{ total: inquiries.length }], []];
      }
      if (query.includes("SELECT COUNT(*) AS total") && query.includes("FROM contact_messages AS inquiry")) {
        const [search, , status] = values;
        const matching = inquiries.filter((item) =>
          `${item.name} ${item.email} ${item.service}`.toLowerCase().includes(search.toLowerCase())
          && (status === "all" || status === "new")
        );
        return [[{ total: matching.length }], []];
      }
      if (query.includes("FROM contact_messages AS inquiry") && query.includes("ORDER BY inquiry.id DESC")) {
        const [search, , status] = values;
        const matching = inquiries.filter((item) =>
          `${item.name} ${item.email} ${item.service}`.toLowerCase().includes(search.toLowerCase())
          && (status === "all" || status === "new")
        ).sort((left, right) => right.id - left.id);
        const offset = query.includes("OFFSET ?") ? Number(values[4]) : 0;
        const limit = query.includes("OFFSET ?") ? 25 : 1000;
        return [matching.slice(offset, offset + limit).map((item) => ({
          ...item,
          status: "new",
          internal_notes: null,
          follow_up_date: null
        })), []];
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
    const unauthorized = await fetch(`${baseUrl}/api/admin/inquiries`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ username: adminConfig.username, password: adminConfig.password })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { Cookie: cookie };

    const firstPage = await fetch(`${baseUrl}/api/admin/inquiries?page=1`, { headers });
    const firstPageData = await firstPage.json();
    assert.equal(firstPageData.pagination.total, 30);
    assert.equal(firstPageData.pagination.newCount, 30);
    assert.equal(firstPageData.inquiries.length, 25);
    assert.equal(firstPageData.inquiries[0].id, "30");
    assert.equal(firstPageData.inquiries[0].status, "new");

    const secondPage = await fetch(`${baseUrl}/api/admin/inquiries?page=2`, { headers });
    const secondPageData = await secondPage.json();
    assert.equal(secondPageData.inquiries.length, 5);
    assert.equal(secondPageData.inquiries[0].id, "5");

    const search = await fetch(`${baseUrl}/api/admin/inquiries?q=needle`, { headers });
    const searchData = await search.json();
    assert.equal(searchData.pagination.total, 1);
    assert.equal(searchData.inquiries[0].service, "Website development");

    const statusFilter = await fetch(`${baseUrl}/api/admin/inquiries?status=contacted`, { headers });
    assert.equal((await statusFilter.json()).pagination.total, 0);

    const exportResponse = await fetch(`${baseUrl}/api/admin/inquiries/export?q=formula&status=new`, { headers });
    assert.equal(exportResponse.status, 200);
    const csv = await exportResponse.text();
    assert.match(csv, /"'\=formula,cmd"/);
    assert.match(csv, /"Status","Internal notes","Follow-up date"/);
    assert.match(exportResponse.headers.get("content-disposition"), /attachment/);
  }, adminConfig);
});

test("admin can update private inquiry status, notes, and follow-up date", async () => {
  let tracking = null;
  const inquiry = {
    id: 1,
    name: "Alex Doe",
    email: "alex@example.com",
    service: "Website development",
    message: "I need a site.",
    created_at: new Date("2026-01-01T12:00:00.000Z")
  };
  const pool = {
    async execute(query, values = []) {
      if (query.startsWith("SELECT id FROM contact_messages WHERE id = ?")) {
        return [Number(values[0]) === inquiry.id ? [{ id: inquiry.id }] : [], []];
      }
      if (query.startsWith("INSERT INTO contact_message_tracking")) {
        tracking = {
          status: values[1],
          internal_notes: values[2],
          follow_up_date: values[3]
        };
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes("WHERE COALESCE(tracking.status, 'new') = 'new'")) {
        return [[{ total: tracking?.status === "new" || !tracking ? 1 : 0 }], []];
      }
      if (query.includes("SELECT COUNT(*) AS total") && query.includes("FROM contact_messages AS inquiry")) {
        const status = values[2];
        return [[{ total: status === "all" || status === (tracking?.status || "new") ? 1 : 0 }], []];
      }
      if (query.includes("FROM contact_messages AS inquiry") && query.includes("ORDER BY inquiry.id DESC")) {
        const status = values[2];
        if (status !== "all" && status !== (tracking?.status || "new")) return [[], []];
        return [[{
          ...inquiry,
          status: tracking?.status || "new",
          internal_notes: tracking?.internal_notes || null,
          follow_up_date: tracking?.follow_up_date || null
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
    const unauthorized = await fetch(`${baseUrl}/api/admin/inquiries/1/tracking`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ status: "contacted", notes: "", followUpDate: null })
    });
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ username: adminConfig.username, password: adminConfig.password })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie };

    const invalidStatus = await fetch(`${baseUrl}/api/admin/inquiries/1/tracking`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ status: "waiting", notes: "", followUpDate: null })
    });
    assert.equal(invalidStatus.status, 400);

    const invalidDate = await fetch(`${baseUrl}/api/admin/inquiries/1/tracking`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ status: "contacted", notes: "", followUpDate: "2026-02-30" })
    });
    assert.equal(invalidDate.status, 400);

    const updated = await fetch(`${baseUrl}/api/admin/inquiries/1/tracking`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        status: "in_progress",
        notes: "Sent the proposal; follow up next week.",
        followUpDate: "2026-02-20"
      })
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), {
      tracking: {
        status: "in_progress",
        notes: "Sent the proposal; follow up next week.",
        followUpDate: "2026-02-20"
      },
      newCount: 0
    });

    const filtered = await fetch(`${baseUrl}/api/admin/inquiries?status=in_progress`, {
      headers: { Cookie: cookie }
    });
    const result = await filtered.json();
    assert.equal(result.pagination.total, 1);
    assert.equal(result.inquiries[0].notes, "Sent the proposal; follow up next week.");
    assert.equal(result.inquiries[0].followUpDate, "2026-02-20");

    const unknownInquiry = await fetch(`${baseUrl}/api/admin/inquiries/999/tracking`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ status: "closed", notes: "", followUpDate: null })
    });
    assert.equal(unknownInquiry.status, 404);
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
  let emailed;
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
      emailSent: true,
      message: "Thanks for reaching out. Your inquiry was saved and sent to our team."
    });
  }, undefined, {
    sendInquiryEmail: async (inquiry) => { emailed = inquiry; }
  });

  assert.equal(inserted.query, "INSERT INTO contact_messages (name, email, service, message) VALUES (?, ?, ?, ?)");
  assert.deepEqual(inserted.values, ["Alex Doe", "alex@example.com", "Website development", "I need a new site."]);
  assert.deepEqual(emailed, {
    name: "Alex Doe",
    email: "alex@example.com",
    service: "Website development",
    message: "I need a new site."
  });
});

test("contact endpoint keeps the inquiry when email delivery fails", async () => {
  let wasWritten = false;
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => loggedErrors.push(args);
  try {
    await withServer({
      async execute() { wasWritten = true; }
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alex Doe",
          email: "alex@example.com",
          message: "I need a new site."
        })
      });

      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), {
        emailSent: false,
        message: "Thanks for reaching out. Your inquiry was saved, but email notification is unavailable. You can also reach us at info.uiflowlabs@gmail.com."
      });
    }, undefined, {
      async sendInquiryEmail() { throw new Error("SMTP unavailable"); }
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(wasWritten, true);
  assert.equal(loggedErrors.length, 1);
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
