import "dotenv/config";
import mysql from "mysql2/promise";
import { createApp } from "./src/app.js";
import { createInquiryMailer } from "./src/inquiry-mailer.js";
import { DEFAULT_SITE_CONTENT } from "./src/site-content.js";
import { publishDueScheduledContent } from "./src/scheduled-publish.js";

const port = Number(process.env.PORT || 3000);
const requiredDatabaseSettings = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const missingSettings = requiredDatabaseSettings.filter((setting) => process.env[setting] === undefined);
const adminSettings = ["ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"];
const configuredAdminSettings = adminSettings.filter((setting) => process.env[setting]);
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPassword = process.env.SMTP_PASSWORD;
const smtpPort = Number(process.env.SMTP_PORT || 465);

if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
  throw new Error("SMTP_PORT must be a valid TCP port.");
}
if (process.env.SMTP_SECURE !== undefined && !["true", "false"].includes(process.env.SMTP_SECURE)) {
  throw new Error("SMTP_SECURE must be either true or false.");
}

if (configuredAdminSettings.length > 0 && configuredAdminSettings.length < adminSettings.length) {
  throw new Error("Set ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET together, or leave all three empty to disable the editor.");
}

if (
  process.env.ADMIN_PASSWORD
  && process.env.ADMIN_PASSWORD.length < 12
) {
  throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
}

if (
  process.env.ADMIN_SESSION_SECRET
  && Buffer.byteLength(process.env.ADMIN_SESSION_SECRET) < 32
) {
  throw new Error("ADMIN_SESSION_SECRET must be at least 32 bytes.");
}

if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
  throw new Error("Set both SMTP_USER and SMTP_PASSWORD to enable inquiry email notifications.");
}

if (missingSettings.length) {
  throw new Error(`Missing database configuration: ${missingSettings.join(", ")}. Copy .env.example to .env and configure it.`);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

const connectionOptions = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
};

const setupConnection = await mysql.createConnection(connectionOptions);
try {
  await setupConnection.query(
    `CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(process.env.DB_NAME)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
} finally {
  await setupConnection.end();
}

const pool = mysql.createPool({
  ...connectionOptions,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const sendInquiryEmail = smtpUser
  ? createInquiryMailer({
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port: smtpPort,
    secure: process.env.SMTP_SECURE === undefined ? smtpPort === 465 : process.env.SMTP_SECURE === "true",
    user: smtpUser,
    password: smtpPassword,
    recipient: process.env.INQUIRY_TO_EMAIL?.trim() || "info.uiflowlabs@gmail.com"
  })
  : null;

const app = createApp(pool, {
  username: process.env.ADMIN_USERNAME,
  password: process.env.ADMIN_PASSWORD,
  sessionSecret: process.env.ADMIN_SESSION_SECRET
}, { sendInquiryEmail });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(254) NOT NULL,
      service VARCHAR(100) NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_contact_messages_created_at (created_at)
    ) ENGINE=InnoDB
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_message_tracking (
      message_id BIGINT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'new',
      internal_notes TEXT NOT NULL,
      follow_up_date DATE NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id),
      CONSTRAINT chk_contact_message_tracking_status
        CHECK (status IN ('new', 'contacted', 'in_progress', 'closed'))
    ) ENGINE=InnoDB
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_content (
      id TINYINT UNSIGNED NOT NULL,
      published_content JSON NOT NULL,
      draft_content JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      CONSTRAINT chk_site_content_singleton CHECK (id = 1)
    ) ENGINE=InnoDB
  `);
  const defaultContent = JSON.stringify(DEFAULT_SITE_CONTENT);
  await pool.execute(
    "INSERT IGNORE INTO site_content (id, published_content, draft_content) VALUES (1, ?, ?)",
    [defaultContent, defaultContent]
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_content_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      content JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_site_content_history_created_at (created_at)
    ) ENGINE=InnoDB
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_content_schedule (
      id TINYINT UNSIGNED NOT NULL,
      content JSON NULL,
      publish_at_ms BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      CONSTRAINT chk_site_content_schedule_singleton CHECK (id = 1)
    ) ENGINE=InnoDB
  `);
  await pool.execute(`
    INSERT INTO site_content_history (content)
    SELECT published_content FROM site_content
    WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM site_content_history)
  `);
  if (!configuredAdminSettings.length) {
    console.warn("Admin editor disabled. Set its credentials in .env to enable /admin.");
  }
  if (!sendInquiryEmail) {
    console.warn("Inquiry email notifications disabled. Set SMTP_USER and SMTP_PASSWORD in .env to enable them.");
  }
  const runScheduledPublishing = async () => {
    try {
      const published = await publishDueScheduledContent(pool);
      if (published) console.log("Scheduled website content was published.");
    } catch (error) {
      console.error("Scheduled website publishing failed:", error);
    }
  };
  void runScheduledPublishing();
  const scheduledPublishTimer = setInterval(() => {
    void runScheduledPublishing();
  }, 5000);
  scheduledPublishTimer.unref();
  app.listen(port, () => {
    console.log(`UIFlow Labs server is running at http://localhost:${port}`);
  });
} catch (error) {
  await pool.end();
  throw new Error("Unable to initialize the MySQL database. Check your .env settings, MySQL status, and database permissions.", { cause: error });
}
