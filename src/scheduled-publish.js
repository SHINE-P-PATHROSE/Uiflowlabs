import { normalizeSiteContent, validateSiteContent } from "./site-content.js";

function parseContent(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

export async function publishDueScheduledContent(pool, now = Date.now()) {
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.execute(
      "SELECT id FROM site_content WHERE id = 1 FOR UPDATE"
    );
    const [rows] = await connection.execute(
      "SELECT content, publish_at_ms FROM site_content_schedule WHERE id = 1 FOR UPDATE"
    );
    if (!rows.length || !rows[0].content || Number(rows[0].publish_at_ms) > now) {
      await connection.commit();
      transactionStarted = false;
      return false;
    }

    const validation = validateSiteContent(normalizeSiteContent(parseContent(rows[0].content)));
    if (validation.error) throw new Error(`Scheduled website content is invalid: ${validation.error}`);
    const content = JSON.stringify(validation.value);
    await connection.execute(
      "UPDATE site_content SET published_content = ?, published_at = CURRENT_TIMESTAMP WHERE id = 1",
      [content]
    );
    await connection.execute(
      "INSERT INTO site_content_history (content) VALUES (?)",
      [content]
    );
    await connection.execute(
      "UPDATE site_content_schedule SET content = NULL, publish_at_ms = NULL WHERE id = 1"
    );
    await connection.commit();
    transactionStarted = false;
    return true;
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Failed to roll back scheduled publishing:", rollbackError);
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}
