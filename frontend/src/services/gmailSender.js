/**
 * gmailSender.js — Send emails via Gmail API using Google OAuth token
 *
 * Uses the access token obtained from Google Sign-In (with gmail.send scope).
 * No SMTP server needed — emails are sent directly from the user's Gmail account.
 */

import { googleAccessToken, googleUserEmail } from '../pages/AuthPage'

/**
 * Encode email to base64url format required by Gmail API
 */
function makeEmailRaw(to, subject, htmlBody, fromEmail) {
  const boundary = `boundary_${Date.now()}`
  const raw = [
    `From: EduFlow <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    btoa(unescape(encodeURIComponent(htmlBody))),
    `--${boundary}--`,
  ].join('\r\n')

  // base64url encode
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Send a single email via Gmail API
 */
export async function sendViaGmail(to, subject, htmlBody) {
  if (!googleAccessToken) {
    console.warn('[Gmail] No access token — user not signed in with Google')
    return false
  }

  const raw = makeEmailRaw(to, subject, htmlBody, googleUserEmail)

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    })

    if (res.ok) {
      console.log(`[Gmail] Sent to ${to}`)
      return true
    } else {
      const err = await res.json()
      console.error(`[Gmail] Failed to ${to}:`, err)
      return false
    }
  } catch (e) {
    console.error(`[Gmail] Error:`, e)
    return false
  }
}

/**
 * Build absence email HTML
 */
export function buildAbsenceEmail(studentName, rollNo, sectionName, subject, date) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">
        <tr>
          <td style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:28px 32px;">
            <div style="font-size:22px;font-weight:900;color:#fff;">📋 Attendance Update</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">EduFlow · MNIT Jaipur</div>
          </td>
        </tr>
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:15px;color:#94a3b8;">
            Dear <b style="color:#e2e8f0;">${studentName || rollNo.toUpperCase()}</b>,
          </p>
          <div style="background:#ef44441a;border:1px solid #ef444440;border-radius:12px;
                      padding:20px;margin-bottom:24px;text-align:center;">
            <div style="font-size:40px;margin-bottom:8px;">❌</div>
            <div style="font-size:18px;font-weight:900;color:#fca5a5;">
              You were marked <span style="color:#ef4444;">ABSENT</span> today
            </div>
          </div>
          <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
            <tr>
              <td width="33%" style="padding-right:6px;">
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;">
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Section</div>
                  <div style="font-size:16px;font-weight:900;color:#6366f1;margin-top:4px;">${sectionName}</div>
                </div>
              </td>
              <td width="33%" style="padding:0 3px;">
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;">
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Subject</div>
                  <div style="font-size:16px;font-weight:900;color:#6366f1;margin-top:4px;">${subject || '—'}</div>
                </div>
              </td>
              <td width="33%" style="padding-left:6px;">
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;">
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Date</div>
                  <div style="font-size:14px;font-weight:700;color:#e2e8f0;margin-top:4px;">${date}</div>
                </div>
              </td>
            </tr>
          </table>
          <div style="background:#f59e0b1a;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:14px 16px;">
            <b style="color:#fbbf24;font-size:13px;">Important</b>
            <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This absence has been recorded. If you believe this is an error, contact your teacher.
              Maintaining above 75% attendance is mandatory.
            </p>
          </div>
        </td></tr>
        <tr>
          <td style="background:#0f172a;padding:16px 32px;border-top:1px solid #1e293b;">
            <p style="margin:0;font-size:11px;color:#475569;text-align:center;">
              EduFlow · MNIT Jaipur · Automated attendance system · Do not reply
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim()
}
