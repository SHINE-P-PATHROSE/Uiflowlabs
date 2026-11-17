# UIFlow Labs

The website is served by a small Express API. Project inquiries submitted through the contact form are validated and saved in MySQL.

## Requirements

- Node.js 20 or newer
- MySQL 8 or newer

## Setup

1. Install and start MySQL Server.
2. Copy `.env.example` to `.env` and set your MySQL host, username, password, and database name. Keep `.env` private. The configured user needs permission to create the database and table on first startup.
3. Install dependencies and start the server:

   ```sh
   npm install
   npm start
   ```

4. The server creates the configured database, contact and inquiry-tracking tables, and initial website content automatically. Open <http://localhost:3000>.

To email each new inquiry to `info.uiflowlabs@gmail.com` as well as save it in MySQL, set `SMTP_USER=info.uiflowlabs@gmail.com` and `SMTP_PASSWORD` to a Google App Password in `.env`. Gmail requires 2-Step Verification for App Passwords; do not use your regular Gmail password. The default SMTP server is `smtp.gmail.com` on port `465` with a secure connection, and the example environment file lists all settings. Restart the server after configuring them. If SMTP is not configured or email delivery fails, the inquiry is still saved in the database and the form reports that email notification was unavailable.

## Website editor

The public pages include a protected content editor at <http://localhost:3000/admin>. To enable it, set all three values in `.env`:

- `ADMIN_USERNAME` — the username used to sign in.
- `ADMIN_PASSWORD` — a unique password with at least 12 characters.
- `ADMIN_SESSION_SECRET` — a random secret with at least 32 bytes. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

Leave all three values empty to keep the editor disabled. The editor can update site copy, branding, homepage links, Intro alignment, SEO metadata, and the Stats, Services, Work, About, and Careers lists. Add, duplicate, remove, reorder, or hide list items; hide sections or rearrange homepage sections. Undo or redo recent edits, browse and reuse media, preview drafts, and review a change summary before publishing. You can also schedule or cancel a future publish. The protected inquiry inbox lets administrators search, page through, and export contact submissions as CSV. Upload PNG/JPEG/WebP images up to 5 MB and adjust accent colors. Changes are saved as drafts and only go live after publishing or a scheduled publish time. Uploaded images are stored in the local `uploads/` folder; back up this folder along with the database.

The editor shows the 25 most recent published versions. You can preview a version and restore it to the draft; restoration does not publish it. In the Inquiry inbox, administrators can track each lead as New, Contacted, In progress, or Closed, add private notes and follow-up dates, filter by status, and export the filtered inbox with its tracking details. New inquiries remain marked New until an administrator changes their status.

You can also run `schema.sql` manually beforehand if your MySQL user does not have permission to create databases. Set `DB_NAME` in `.env` to the database name created by the script.

The server checks the MySQL connection before it starts. Set `PORT` to change the default port. Use `npm run dev` for automatic restarts during development, and `npm test` to run the validation tests.

## API

- `POST /api/contact` — accepts JSON with `name`, `email`, `message`, and optional `service`; returns `201` when the inquiry is stored. If SMTP is configured, it also emails the inquiry to `INQUIRY_TO_EMAIL` (defaults to `info.uiflowlabs@gmail.com`).
- Inquiries are limited to five submissions per IP address per 15 minutes.
