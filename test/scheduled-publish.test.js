import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SITE_CONTENT } from "../src/site-content.js";
import { publishDueScheduledContent } from "../src/scheduled-publish.js";

function createPool(publishAtMs) {
  const state = {
    published: null,
    history: [],
    schedule: structuredClone(DEFAULT_SITE_CONTENT),
    publishAtMs,
    committed: false,
    released: false
  };
  const pool = {
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {
          state.committed = true;
        },
        async rollback() {},
        release() {
          state.released = true;
        },
        async execute(query, values = []) {
          if (query.startsWith("SELECT id FROM site_content WHERE id = 1 FOR UPDATE")) {
            return [[{ id: 1 }], []];
          }
          if (query.startsWith("SELECT content, publish_at_ms FROM site_content_schedule")) {
            return [[{
              content: JSON.stringify(state.schedule),
              publish_at_ms: state.publishAtMs
            }], []];
          }
          if (query.startsWith("UPDATE site_content SET published_content")) {
            state.published = JSON.parse(values[0]);
            return [{ affectedRows: 1 }, []];
          }
          if (query.startsWith("INSERT INTO site_content_history")) {
            state.history.push(JSON.parse(values[0]));
            return [{ insertId: state.history.length }, []];
          }
          if (query.startsWith("UPDATE site_content_schedule SET content = NULL")) {
            state.schedule = null;
            state.publishAtMs = null;
            return [{ affectedRows: 1 }, []];
          }
          throw new Error(`Unexpected query: ${query}`);
        }
      };
    }
  };
  return { pool, state };
}

test("due scheduled content is published once and recorded in history", async () => {
  const { pool, state } = createPool(1_000);
  const published = await publishDueScheduledContent(pool, 1_000);

  assert.equal(published, true);
  assert.deepEqual(state.published, DEFAULT_SITE_CONTENT);
  assert.deepEqual(state.history, [DEFAULT_SITE_CONTENT]);
  assert.equal(state.schedule, null);
  assert.equal(state.committed, true);
  assert.equal(state.released, true);
});

test("future scheduled content stays queued", async () => {
  const { pool, state } = createPool(2_000);
  const published = await publishDueScheduledContent(pool, 1_000);

  assert.equal(published, false);
  assert.equal(state.published, null);
  assert.deepEqual(state.schedule, DEFAULT_SITE_CONTENT);
  assert.equal(state.committed, true);
  assert.equal(state.released, true);
});
