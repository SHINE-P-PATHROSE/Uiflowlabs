import nodemailer from "nodemailer";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

export function createInquiryEmailMessage({ name, email, service, message }, sender, recipient) {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeService = escapeHtml(service || "Not specified");
  const safeMessage = escapeHtml(message);
  const replyAddress = encodeURIComponent(email).replaceAll("%40", "@");

  return {
    from: { name: "UIFlow Labs", address: sender },
    to: recipient,
    replyTo: email,
    subject: "New project inquiry | UIFlow Labs",
    text: [
      "NEW PROJECT INQUIRY",
      "A new inquiry was submitted through the UIFlow Labs website.",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Service: ${service || "Not specified"}`,
      "",
      "Project details:",
      message,
      "",
      "Reply directly to this email to contact the client."
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px 12px;background:#f3f4f8;color:#20212a;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border-collapse:collapse;background:#ffffff;border:1px solid #e6e7ed;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:25px 32px;background:#171820;color:#ffffff;">
                <p style="margin:0 0 8px;color:#b9bbff;font-size:12px;font-weight:bold;letter-spacing:1.5px;">UIFLOW LABS</p>
                <h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:700;">New project inquiry</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 12px;">
                <p style="margin:0 0 22px;color:#555766;font-size:15px;line-height:1.6;">A potential client sent a message through your website. Here are the details:</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="width:110px;padding:12px 0;border-bottom:1px solid #ececf1;color:#747584;font-size:13px;font-weight:bold;">Name</td>
                    <td style="padding:12px 0;border-bottom:1px solid #ececf1;color:#20212a;font-size:14px;">${safeName}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #ececf1;color:#747584;font-size:13px;font-weight:bold;">Email</td>
                    <td style="padding:12px 0;border-bottom:1px solid #ececf1;font-size:14px;"><a href="mailto:${replyAddress}" style="color:#4549b7;text-decoration:none;">${safeEmail}</a></td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #ececf1;color:#747584;font-size:13px;font-weight:bold;">Service</td>
                    <td style="padding:12px 0;border-bottom:1px solid #ececf1;color:#20212a;font-size:14px;">${safeService}</td>
                  </tr>
                </table>
                <h2 style="margin:24px 0 10px;color:#20212a;font-size:15px;">Project details</h2>
                <div style="padding:16px;background:#f6f6fa;border-left:3px solid #585cf0;border-radius:4px;color:#333441;font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;">${safeMessage}</div>
                <p style="margin:24px 0 20px;">
                  <a href="mailto:${replyAddress}?subject=Re%3A%20your%20UIFlow%20Labs%20inquiry" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#393da6;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;">Reply to ${safeName}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f8f8fb;border-top:1px solid #ececf1;color:#777987;font-size:12px;line-height:1.5;">Sent automatically from the UIFlow Labs website inquiry form.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
  };
}

export function createInquiryMailer({ host, port, secure, user, password, recipient }) {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  });

  return async ({ name, email, service, message }) => {
    const inquiry = { name, email, service, message };
    await transporter.sendMail(createInquiryEmailMessage(inquiry, user, recipient));
  };
}
