import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { validateContact } from "./contact.js";
import { normalizeSiteContent, validateSiteContent } from "./site-content.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadsRoot = path.join(root, "uploads");
const adminCookieName = "uiflowlabs_admin";
const adminSessionDuration = 8 * 60 * 60;
const siteContentHistoryLimit = 25;
const inquiryPageSize = 25;
const inquiryExportLimit = 1000;

function parseContent(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function validateStoredSiteContent(value) {
  const validation = validateSiteContent(normalizeSiteContent(parseContent(value)));
  if (validation.error) throw new Error(`Stored website content is invalid: ${validation.error}`);
  return validation.value;
}

function contentUsesImage(value, imagePath) {
  if (value === imagePath) return true;
  if (Array.isArray(value)) return value.some((item) => contentUsesImage(item, imagePath));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => contentUsesImage(item, imagePath));
  }
  return false;
}

function isSupportedImage(filename) {
  return /\.(png|jpe?g|webp)$/i.test(filename);
}

function getInquirySearch(request, response) {
  const search = request.query.q ?? "";
  if (typeof search !== "string" || search.length > 120) {
    response.status(400).json({ error: "Search text must be 120 characters or fewer." });
    return null;
  }
  return search.trim();
}

function inquirySearchClause() {
  return "(? = '' OR LOCATE(LOWER(?), LOWER(CONCAT_WS(' ', name, email, service))) > 0)";
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function safeEqual(candidate, expected) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length
    && timingSafeEqual(candidateBuffer, expectedBuffer);
}

function signSession(username, secret) {
  const payload = Buffer.from(JSON.stringify({
    username,
    expiresAt: Date.now() + adminSessionDuration * 1000
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(request, secret) {
  const cookie = (request.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${adminCookieName}=`));
  if (!cookie) return null;

  const token = cookie.slice(adminCookieName.length + 1);
  if (token.length > 2048) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof session.username !== "string" || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function getImageExtension(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function createApp(pool, adminConfig = {}) {
  const app = express();
  const adminIsConfigured = typeof adminConfig.username === "string"
    && adminConfig.username.trim().length > 0
    && typeof adminConfig.password === "string"
    && adminConfig.password.length >= 12
    && typeof adminConfig.sessionSecret === "string"
    && Buffer.byteLength(adminConfig.sessionSecret) >= 32;

  function requireAdmin(request, response, next) {
    if (!adminIsConfigured) {
      response.status(503).json({ error: "Admin access is not configured on this server." });
      return;
    }

    const session = readSession(request, adminConfig.sessionSecret);
    if (!session || session.username !== adminConfig.username) {
      response.status(401).json({ error: "Please sign in to manage website content." });
      return;
    }
    next();
  }

  function requireSameOrigin(request, response, next) {
    const origin = request.get("origin");
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      response.status(403).json({ error: "This request must come from the website." });
      return;
    }
    if (originHost !== request.get("host")) {
      response.status(403).json({ error: "This request must come from the website." });
      return;
    }
    next();
  }

  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"]
      }
    }
  }));

  app.use(["/api/admin/content", "/api/admin/schedule"], express.json({ limit: "100kb" }));
  app.use(express.json({ limit: "10kb" }));
  app.use("/assets", express.static(path.join(root, "assets"), { dotfiles: "deny", index: false }));
  app.use("/uploads", express.static(uploadsRoot, { dotfiles: "deny", index: false }));
  app.get(["/", "/index.html"], (_request, response) => response.sendFile(path.join(root, "index.html")));
  app.get("/careers.html", (_request, response) => response.sendFile(path.join(root, "careers.html")));
  app.get(["/admin", "/admin.html"], (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.sendFile(path.join(root, "admin.html"));
  });
  app.get("/styles.css", (_request, response) => response.sendFile(path.join(root, "styles.css")));
  app.get("/script.js", (_request, response) => response.sendFile(path.join(root, "script.js")));
  app.get("/admin.css", (_request, response) => response.sendFile(path.join(root, "admin.css")));
  app.get("/admin.js", (_request, response) => response.sendFile(path.join(root, "admin.js")));

  const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Please try again later." }
  });

  app.get("/api/admin/session", (request, response) => {
    const session = adminIsConfigured
      ? readSession(request, adminConfig.sessionSecret)
      : null;
    response.set("Cache-Control", "no-store");
    response.json({
      configured: adminIsConfigured,
      authenticated: Boolean(session && session.username === adminConfig.username)
    });
  });

  app.get("/api/site-content", async (_request, response) => {
    const [rows] = await pool.execute(
      "SELECT published_content FROM site_content WHERE id = 1"
    );
    if (!rows.length) {
      response.status(503).json({ error: "Website content is not initialized." });
      return;
    }
    response.set("Cache-Control", "no-store");
    response.json({ content: validateStoredSiteContent(rows[0].published_content) });
  });

  app.post("/api/admin/login", requireSameOrigin, adminLoginLimiter, (request, response) => {
    if (!adminIsConfigured) {
      response.status(503).json({ error: "Admin access is not configured on this server." });
      return;
    }

    const { username, password } = request.body || {};
    if (
      typeof username !== "string"
      || typeof password !== "string"
      || !safeEqual(username, adminConfig.username)
      || !safeEqual(password, adminConfig.password)
    ) {
      response.status(401).json({ error: "The username or password is incorrect." });
      return;
    }

    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.set("Cache-Control", "no-store");
    response.set("Set-Cookie", `${adminCookieName}=${signSession(username, adminConfig.sessionSecret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${adminSessionDuration}${secure}`);
    response.json({ authenticated: true });
  });

  app.post("/api/admin/logout", requireSameOrigin, (_request, response) => {
    response.set("Set-Cookie", `${adminCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    response.status(204).end();
  });

  app.get("/api/admin/content", requireAdmin, async (_request, response) => {
    const [rows] = await pool.execute(
      "SELECT draft_content, published_at, updated_at FROM site_content WHERE id = 1"
    );
    if (!rows.length) {
      response.status(503).json({ error: "Website content is not initialized." });
      return;
    }
    response.set("Cache-Control", "no-store");
    response.json({
      draft: validateStoredSiteContent(rows[0].draft_content),
      publishedAt: rows[0].published_at,
      updatedAt: rows[0].updated_at
    });
  });

  app.get("/api/admin/history", requireAdmin, async (_request, response) => {
    const [rows] = await pool.execute(
      `SELECT id, content, created_at
       FROM site_content_history
       ORDER BY id DESC
       LIMIT ${siteContentHistoryLimit}`
    );
    response.set("Cache-Control", "no-store");
    response.json({
      versions: rows.map((row) => ({
        id: String(row.id),
        publishedAt: row.created_at,
        content: validateStoredSiteContent(row.content)
      }))
    });
  });

  app.get("/api/admin/inquiries/export", requireAdmin, async (request, response) => {
    const search = getInquirySearch(request, response);
    if (search === null) return;
    const searchParams = [search, search];
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM contact_messages WHERE ${inquirySearchClause()}`,
      searchParams
    );
    const total = Number(countRows[0]?.total || 0);
    if (total > inquiryExportLimit) {
      response.status(413).json({
        error: `There are ${total} matching inquiries. Narrow your search to export up to ${inquiryExportLimit} at a time.`
      });
      return;
    }

    const [rows] = await pool.execute(
      `SELECT id, name, email, service, message, created_at
       FROM contact_messages
       WHERE ${inquirySearchClause()}
       ORDER BY id DESC
       LIMIT ${inquiryExportLimit}`,
      searchParams
    );
    const csvRows = [
      ["ID", "Received", "Name", "Email", "Service", "Message"],
      ...rows.map((row) => [
        row.id,
        row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
        row.name,
        row.email,
        row.service,
        row.message
      ])
    ];
    const csv = `\uFEFF${csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    response.set("Cache-Control", "no-store");
    response.type("text/csv; charset=utf-8");
    response.attachment(`uiflowlabs-inquiries-${new Date().toISOString().slice(0, 10)}.csv`);
    response.send(csv);
  });

  app.get("/api/admin/inquiries", requireAdmin, async (request, response) => {
    const search = getInquirySearch(request, response);
    if (search === null) return;
    const requestedPage = request.query.page === undefined ? 1 : Number(request.query.page);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      response.status(400).json({ error: "Choose a valid inbox page." });
      return;
    }

    const searchParams = [search, search];
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM contact_messages WHERE ${inquirySearchClause()}`,
      searchParams
    );
    const total = Number(countRows[0]?.total || 0);
    const pageCount = Math.max(1, Math.ceil(total / inquiryPageSize));
    const page = Math.min(requestedPage, pageCount);
    const offset = (page - 1) * inquiryPageSize;
    const [rows] = await pool.execute(
      `SELECT id, name, email, service, message, created_at
       FROM contact_messages
       WHERE ${inquirySearchClause()}
       ORDER BY id DESC
       LIMIT ${inquiryPageSize} OFFSET ?`,
      [...searchParams, offset]
    );
    response.set("Cache-Control", "no-store");
    response.json({
      inquiries: rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        email: row.email,
        service: row.service,
        message: row.message,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
      })),
      pagination: { page, pageCount, total }
    });
  });

  app.get("/api/admin/media", requireAdmin, async (_request, response) => {
    const [assetFiles, uploadFiles] = await Promise.all([
      readdir(path.join(root, "assets"), { withFileTypes: true }),
      readdir(uploadsRoot, { withFileTypes: true }).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      })
    ]);
    const items = [
      ...assetFiles.filter((file) => file.isFile() && isSupportedImage(file.name))
        .map((file) => ({ filename: file.name, path: `assets/${file.name}`, source: "assets" })),
      ...uploadFiles.filter((file) => file.isFile() && isSupportedImage(file.name))
        .map((file) => ({ filename: file.name, path: `uploads/${file.name}`, source: "uploads" }))
    ].sort((left, right) => left.path.localeCompare(right.path));
    response.set("Cache-Control", "no-store");
    response.json({ items });
  });

  app.delete("/api/admin/media/:filename", requireSameOrigin, requireAdmin, async (request, response) => {
    const { filename } = request.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(filename)) {
      response.status(400).json({ error: "Only uploaded images can be removed." });
      return;
    }

    const imagePath = `uploads/${filename}`;
    const [contentRows] = await pool.execute(
      "SELECT published_content, draft_content FROM site_content WHERE id = 1"
    );
    if (!contentRows.length) {
      response.status(503).json({ error: "Website content is not initialized." });
      return;
    }
    const referenced = contentRows.some((row) =>
      contentUsesImage(parseContent(row.published_content), imagePath)
      || contentUsesImage(parseContent(row.draft_content), imagePath)
    );
    if (referenced) {
      response.status(409).json({ error: "This image is used by the current draft or published site and cannot be removed." });
      return;
    }

    const [scheduledRows] = await pool.execute(
      "SELECT content FROM site_content_schedule WHERE id = 1 AND content IS NOT NULL"
    );
    if (scheduledRows.some((row) => contentUsesImage(parseContent(row.content), imagePath))) {
      response.status(409).json({ error: "This image is used by a scheduled publish and cannot be removed." });
      return;
    }

    const [historyRows] = await pool.execute(
      "SELECT content FROM site_content_history WHERE content LIKE ?",
      [`%${imagePath}%`]
    );
    if (historyRows.some((row) => contentUsesImage(parseContent(row.content), imagePath))) {
      response.status(409).json({ error: "This image is referenced by published history and cannot be removed." });
      return;
    }

    try {
      await unlink(path.join(uploadsRoot, filename));
    } catch (error) {
      if (error.code === "ENOENT") {
        response.status(404).json({ error: "That uploaded image could not be found." });
        return;
      }
      throw error;
    }
    response.json({ removed: true });
  });

  app.get("/api/admin/schedule", requireAdmin, async (_request, response) => {
    const [rows] = await pool.execute(
      "SELECT publish_at_ms FROM site_content_schedule WHERE id = 1 AND content IS NOT NULL"
    );
    const publishAtMs = rows.length ? Number(rows[0].publish_at_ms) : null;
    response.set("Cache-Control", "no-store");
    response.json({
      schedule: Number.isSafeInteger(publishAtMs) && publishAtMs > 0
        ? { publishAt: new Date(publishAtMs).toISOString() }
        : null
    });
  });

  app.post("/api/admin/schedule", requireSameOrigin, requireAdmin, async (request, response) => {
    const validation = validateSiteContent(request.body?.content);
    if (validation.error) {
      response.status(400).json({ error: validation.error });
      return;
    }

    const publishAt = request.body?.publishAt;
    const publishAtMs = typeof publishAt === "string" ? Date.parse(publishAt) : Number.NaN;
    if (
      !Number.isSafeInteger(publishAtMs)
      || new Date(publishAtMs).toISOString() !== publishAt
      || publishAtMs < Date.now() + 60_000
      || publishAtMs > Date.now() + 365 * 24 * 60 * 60 * 1000
    ) {
      response.status(400).json({ error: "Choose a publish time at least one minute from now and within the next year." });
      return;
    }

    await pool.execute(
      `INSERT INTO site_content_schedule (id, content, publish_at_ms)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), publish_at_ms = VALUES(publish_at_ms)`,
      [JSON.stringify(validation.value), publishAtMs]
    );
    response.json({ schedule: { publishAt: new Date(publishAtMs).toISOString() } });
  });

  app.delete("/api/admin/schedule", requireSameOrigin, requireAdmin, async (_request, response) => {
    await pool.execute(
      "UPDATE site_content_schedule SET content = NULL, publish_at_ms = NULL WHERE id = 1"
    );
    response.json({ cancelled: true });
  });

  app.post("/api/admin/history/:versionId/restore", requireSameOrigin, requireAdmin, async (request, response) => {
    const versionId = Number(request.params.versionId);
    if (!Number.isSafeInteger(versionId) || versionId < 1) {
      response.status(400).json({ error: "Choose a valid published version." });
      return;
    }

    const [rows] = await pool.execute(
      "SELECT content FROM site_content_history WHERE id = ?",
      [versionId]
    );
    if (!rows.length) {
      response.status(404).json({ error: "That published version could not be found." });
      return;
    }

    const validation = validateSiteContent(normalizeSiteContent(parseContent(rows[0].content)));
    if (validation.error) {
      response.status(500).json({ error: "That saved version is invalid and cannot be restored." });
      return;
    }

    await pool.execute(
      "UPDATE site_content SET draft_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
      [JSON.stringify(validation.value)]
    );
    response.json({ restored: true });
  });

  app.put("/api/admin/content", requireSameOrigin, requireAdmin, async (request, response) => {
    const validation = validateSiteContent(request.body?.content);
    if (validation.error) {
      response.status(400).json({ error: validation.error });
      return;
    }

    await pool.execute(
      "UPDATE site_content SET draft_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
      [JSON.stringify(validation.value)]
    );
    response.json({ saved: true });
  });

  app.post("/api/admin/publish", requireSameOrigin, requireAdmin, async (_request, response) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const [rows] = await connection.execute(
        "SELECT draft_content FROM site_content WHERE id = 1 FOR UPDATE"
      );
      if (!rows.length) {
        await connection.rollback();
        transactionStarted = false;
        response.status(503).json({ error: "Website content is not initialized." });
        return;
      }

      const publishedContent = JSON.stringify(validateStoredSiteContent(rows[0].draft_content));
      await connection.execute(
        "UPDATE site_content SET published_content = ?, published_at = CURRENT_TIMESTAMP WHERE id = 1",
        [publishedContent]
      );
      await connection.execute(
        "INSERT INTO site_content_history (content) VALUES (?)",
        [publishedContent]
      );
      await connection.execute(
        "UPDATE site_content_schedule SET content = NULL, publish_at_ms = NULL WHERE id = 1"
      );
      await connection.commit();
      transactionStarted = false;
      response.json({ published: true });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("Failed to roll back the publish transaction:", rollbackError);
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  });

  app.post("/api/admin/reset-draft", requireSameOrigin, requireAdmin, async (_request, response) => {
    await pool.execute(
      "UPDATE site_content SET draft_content = published_content, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
    );
    response.json({ reset: true });
  });

  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      callback(null, ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype));
    }
  }).single("image");

  app.post("/api/admin/upload", requireSameOrigin, requireAdmin, (request, response, next) => {
    imageUpload(request, response, (error) => {
      if (error instanceof multer.MulterError) {
        response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
          error: error.code === "LIMIT_FILE_SIZE" ? "Images must be 5 MB or smaller." : "Choose one image at a time."
        });
        return;
      }
      if (error) {
        next(error);
        return;
      }
      next();
    });
  }, async (request, response) => {
    if (!request.file) {
      response.status(400).json({ error: "Choose a PNG, JPEG, or WebP image." });
      return;
    }

    const extension = getImageExtension(request.file.buffer);
    if (!extension) {
      response.status(400).json({ error: "The uploaded file is not a valid PNG, JPEG, or WebP image." });
      return;
    }

    const filename = `${randomUUID()}.${extension}`;
    await mkdir(uploadsRoot, { recursive: true });
    await writeFile(path.join(uploadsRoot, filename), request.file.buffer, { flag: "wx" });
    response.status(201).json({ path: `uploads/${filename}` });
  });

  const contactLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many inquiries from this connection. Please try again later." }
  });

  app.post("/api/contact", contactLimiter, async (request, response, next) => {
    const validation = validateContact(request.body);
    if (validation.error) {
      response.status(400).json({ error: validation.error });
      return;
    }

    try {
      await pool.execute(
        "INSERT INTO contact_messages (name, email, service, message) VALUES (?, ?, ?, ?)",
        [
          validation.value.name,
          validation.value.email,
          validation.value.service,
          validation.value.message
        ]
      );
      response.status(201).json({ message: "Thanks for reaching out. We'll be in touch soon." });
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found." });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof multer.MulterError) {
      response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE" ? "Images must be 5 MB or smaller." : "Invalid image upload."
      });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({ error: "Please submit valid JSON." });
      return;
    }

    if (error.status === 413) {
      response.status(413).json({ error: "Your inquiry is too large. Please shorten it and try again." });
      return;
    }

    console.error("Request failed:", error);
    response.status(500).json({ error: "We couldn't process your request. Please try again later." });
  });

  return app;
}
