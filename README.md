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

4. The server creates the configured database, contact table, and initial website content automatically. Open <http://localhost:3000>.

## Website editor

The public pages include a protected content editor at <http://localhost:3000/admin>. To enable it, set all three values in `.env`:

- `ADMIN_USERNAME` — the username used to sign in.
- `ADMIN_PASSWORD` — a unique password with at least 12 characters.
- `ADMIN_SESSION_SECRET` — a random secret with at least 32 bytes. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

Leave all three values empty to keep the editor disabled. The editor can update site copy, branding, homepage links, Intro alignment, contact and Careers email settings, and the Stats, Services, Work, About, and Careers lists. List items can be added, removed, and reordered within their supported limits. Upload PNG/JPEG/WebP images up to 5 MB and adjust accent colors. Changes are saved as drafts and only go live after publishing. Uploaded images are stored in the local `uploads/` folder; back up this folder along with the database.

The editor shows the 25 most recent published versions. You can preview a version and restore it to the draft; restoration does not publish it.

You can also run `schema.sql` manually beforehand if your MySQL user does not have permission to create databases. Set `DB_NAME` in `.env` to the database name created by the script.

The server checks the MySQL connection before it starts. Set `PORT` to change the default port. Use `npm run dev` for automatic restarts during development, and `npm test` to run the validation tests.

## API

- `POST /api/contact` — accepts JSON with `name`, `email`, `message`, and optional `service`; returns `201` when the inquiry is stored.
- Inquiries are limited to five submissions per IP address per 15 minutes.
