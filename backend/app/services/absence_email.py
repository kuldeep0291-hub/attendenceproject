"""
absence_email.py — End-of-session absence notification
Sends one email per absent student: "Today you were marked Absent."
"""
import os
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

logger = logging.getLogger("eduflow.absence")


def _mnit_email(roll_no: str) -> str:
    return f"{roll_no.strip().lower()}@mnit.ac.in"


def _build_absent_html(student_name: str, roll_no: str, section: str,
                        subject: str, date_str: str) -> str:
    return f"""
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
            <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">
              EduFlow · MNIT Jaipur
            </div>
          </td>
        </tr>

        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:15px;color:#94a3b8;">
            Dear <b style="color:#e2e8f0;">{student_name or roll_no.upper()}</b>,
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
              <td width="50%" style="padding-right:6px;">
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;">
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Section</div>
                  <div style="font-size:16px;font-weight:900;color:#6366f1;margin-top:4px;">{section}</div>
                </div>
              </td>
              <td width="50%" style="padding-left:6px;">
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;">
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Subject</div>
                  <div style="font-size:16px;font-weight:900;color:#6366f1;margin-top:4px;">{subject or '—'}</div>
                </div>
              </td>
            </tr>
          </table>

          <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;
                      padding:14px 16px;margin-bottom:24px;">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Date</div>
            <div style="font-size:16px;font-weight:700;color:#e2e8f0;margin-top:4px;">{date_str}</div>
          </div>

          <div style="background:#f59e0b1a;border-left:3px solid #f59e0b;
                      border-radius:0 8px 8px 0;padding:14px 16px;">
            <b style="color:#fbbf24;font-size:13px;">Important</b>
            <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This absence has been recorded in the EduFlow system.
              If you believe this is an error, please contact your teacher.
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
</html>
""".strip()


def send_absence_emails_sync(
    absentees: list,   # [{ roll_no, name, email (optional) }]
    section_name: str,
    subject: str,
) -> dict:
    """
    Send absence notification to each absentee.
    absentees: list of dicts with roll_no, name, email (optional)
    Returns { sent: int, failed: int, skipped: int }
    """
    mail_user = os.getenv("MAIL_USERNAME", "")
    mail_pass = os.getenv("MAIL_PASSWORD", "")
    mail_from = os.getenv("MAIL_FROM", mail_user) or "noreply@eduflow.mnit.ac.in"
    date_str  = datetime.now().strftime("%d %B %Y, %I:%M %p")

    sent = failed = skipped = 0

    for student in absentees:
        roll_no = student.get("roll_no", "")
        name    = student.get("name", "") or roll_no
        # Use provided email or derive from roll number
        to_email = student.get("email") or _mnit_email(roll_no)

        html    = _build_absent_html(name, roll_no, section_name, subject, date_str)
        subj    = f"📋 Attendance: You were Absent Today [{date_str}]"

        if mail_user and mail_pass:
            try:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subj
                msg["From"]    = mail_from
                msg["To"]      = to_email
                msg.attach(MIMEText(html, "html"))

                with smtplib.SMTP("smtp.gmail.com", 587) as server:
                    server.ehlo(); server.starttls()
                    server.login(mail_user, mail_pass)
                    server.sendmail(mail_from, to_email, msg.as_string())

                logger.info(f"[ABSENT EMAIL] Sent to {to_email} ({name})")
                sent += 1
            except Exception as e:
                logger.error(f"[ABSENT EMAIL FAILED] {to_email}: {e}")
                failed += 1
        else:
            # Dev mode
            logger.warning(
                f"[DEV ABSENT EMAIL] To: {to_email} | Student: {name} | "
                f"Section: {section_name} | Date: {date_str}"
            )
            skipped += 1

    return {"sent": sent, "failed": failed, "skipped": skipped}
