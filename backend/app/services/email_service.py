"""
email_service.py — MNIT Automated Notification Engine
======================================================

MNIT Email Formula:
    recipient_email = f"{student_id.lower()}@mnit.ac.in"

Architecture:
    - Uses FastAPI BackgroundTasks so the CV loop never blocks on SMTP
    - Strike trigger: alarm_counter == 3 exactly
    - Cooldown: one email per student per 60-minute session (in-memory dict)
    - Transport: Gmail SMTP (smtp.gmail.com:587, STARTTLS)
    - Fallback: stdout log in dev mode

SMTP env vars:
    MAIL_USERNAME   — Gmail address (e.g. eduflow@mnit.ac.in)
    MAIL_PASSWORD   — App password (not your login password)
    MAIL_FROM       — Sender display address (defaults to MAIL_USERNAME)
"""

import os
import logging
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger("eduflow.email")

# ─── Session-level cooldown (student_id → epoch of last sent email) ──────────
_cooldown: dict[str, float] = {}
COOLDOWN_SECONDS = 3600   # 60 minutes


def _mnit_email(student_id: str) -> str:
    """Derive institutional email from roll number."""
    return f"{student_id.strip().lower()}@mnit.ac.in"


def _is_on_cooldown(student_id: str) -> bool:
    last = _cooldown.get(student_id)
    if last is None:
        return False
    return (time.time() - last) < COOLDOWN_SECONDS


def _mark_sent(student_id: str):
    _cooldown[student_id] = time.time()


def reset_cooldowns():
    """Call at session end to allow fresh alerts next session."""
    _cooldown.clear()


# ─── HTML email template ──────────────────────────────────────────────────────

def _build_html(
    student_id: str,
    timestamp: str,
    grid_mode: str,
    quadrant: str,
    a_acc: float,
    absence_minutes: float,
    consecutive_minutes: float,
) -> str:
    pct        = f"{a_acc:.1%}"
    bar_color  = "#22c55e" if a_acc >= 0.80 else "#f59e0b" if a_acc >= 0.50 else "#ef4444"
    bar_width  = int(a_acc * 100)
    trigger    = "5-min consecutive block" if consecutive_minutes >= 5 else "10-min cumulative absence"

    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;">
            <table width="100%"><tr>
              <td>
                <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px;">
                  ⚠️ EduFlow Attendance Alert
                </div>
                <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">
                  Persistence-Based Absence Detection · MNIT Jaipur
                </div>
              </td>
              <td align="right">
                <div style="background:rgba(255,255,255,0.15);border-radius:8px;
                            padding:8px 14px;font-size:12px;color:#fff;font-weight:700;">
                  MNIT Jaipur
                </div>
              </td>
            </tr></table>
          </td>
        </tr>

        <!-- Body -->
        <tr><td style="padding:28px 32px;">

          <p style="margin:0 0 16px;font-size:15px;color:#94a3b8;">
            Dear <b style="color:#e2e8f0;">{student_id.upper()}</b>,
          </p>

          <!-- Main message -->
          <div style="background:#ef44441a;border:1px solid #ef444440;border-radius:10px;
                      padding:16px 20px;margin-bottom:24px;">
            <p style="margin:0;font-size:14px;line-height:1.7;color:#fca5a5;">
              You have been <b>undetected for {absence_minutes} minutes</b>
              (trigger: <i>{trigger}</i>) during your current session at
              <b style="color:#e2e8f0;">{timestamp}</b>.
              Please ensure you are visible to the EduFlow system to avoid
              loss of attendance for this session.
            </p>
          </div>

          <!-- Stats grid -->
          <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
            <tr>
              <td width="33%" style="padding-right:6px;">
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;">
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Spatial Grid</div>
                  <div style="font-size:18px;font-weight:900;color:#6366f1;margin-top:4px;">{grid_mode}</div>
                </div>
              </td>
              <td width="33%" style="padding:0 3px;">
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;">
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Last Quadrant</div>
                  <div style="font-size:18px;font-weight:900;color:#6366f1;margin-top:4px;">{quadrant}</div>
                </div>
              </td>
              <td width="33%" style="padding-left:6px;">
                <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:12px;">
                  <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Absent (min)</div>
                  <div style="font-size:18px;font-weight:900;color:#ef4444;margin-top:4px;">{absence_minutes}m</div>
                </div>
              </td>
            </tr>
          </table>

          <!-- Aacc bar -->
          <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:16px;margin-bottom:24px;">
            <div style="margin-bottom:8px;display:flex;justify-content:space-between;">
              <span style="font-size:12px;color:#64748b;">Attendance Accumulation (Aacc)</span>
              <span style="font-size:14px;font-weight:700;color:{bar_color};">{pct}</span>
            </div>
            <div style="background:#1e293b;border-radius:4px;height:8px;overflow:hidden;">
              <div style="width:{bar_width}%;height:100%;background:{bar_color};border-radius:4px;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:6px;">
              <span style="font-size:10px;color:#475569;">0%</span>
              <span style="font-size:10px;color:#f59e0b;">50% → Warning</span>
              <span style="font-size:10px;color:#22c55e;">80% → Present</span>
            </div>
          </div>

          <!-- Thresholds info -->
          <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;
                      padding:14px 16px;margin-bottom:24px;font-size:12px;color:#64748b;line-height:1.8;">
            <b style="color:#94a3b8;">Persistence Thresholds</b><br>
            Phase 2 (Warning): 10 min cumulative absence OR 5 min consecutive block<br>
            Phase 3 (Absent):  &gt;15 min absence (25% of 60-min lecture)
          </div>

          <!-- Action required -->
          <div style="background:#f59e0b1a;border-left:3px solid #f59e0b;
                      border-radius:0 8px 8px 0;padding:14px 16px;">
            <b style="color:#fbbf24;font-size:13px;">Action Required</b>
            <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
              Return to your assigned quadrant and ensure your face is clearly visible
              to the classroom camera. If absence continues beyond 15 minutes total,
              your status will be permanently set to <b style="color:#ef4444;">Absent</b>.
            </p>
          </div>

        </td></tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0f172a;padding:16px 32px;border-top:1px solid #1e293b;">
            <p style="margin:0;font-size:11px;color:#475569;text-align:center;">
              EduFlow Behavioral Trust Engine · MNIT Jaipur ·
              This is an automated message — do not reply.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


# ─── Core send function (runs in background task) ────────────────────────────

def send_warning_email_sync(
    student_id: str,
    quadrant: str,
    a_acc: float,
    grid_mode: str,
    timestamp: str,
    absence_minutes: float = 0.0,
    consecutive_minutes: float = 0.0,
) -> bool:
    """
    Synchronous send — called from BackgroundTasks so it never blocks the
    CV loop. Cooldown enforced: one email per student per session.
    """
    if _is_on_cooldown(student_id):
        logger.info(f"[COOLDOWN] Suppressed email for {student_id}")
        return False

    to_email = _mnit_email(student_id)
    subject  = f"⚠️ Attendance Warning: Absence Detected [Roll No: {student_id.upper()}]"
    html     = _build_html(
        student_id, timestamp, grid_mode, quadrant,
        a_acc, absence_minutes, consecutive_minutes,
    )

    mail_user = os.getenv("MAIL_USERNAME", "")
    mail_pass = os.getenv("MAIL_PASSWORD", "")
    mail_from = os.getenv("MAIL_FROM", mail_user) or "noreply@eduflow.mnit.ac.in"

    if mail_user and mail_pass:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"]    = mail_from
            msg["To"]      = to_email
            msg.attach(MIMEText(html, "html"))

            with smtplib.SMTP("smtp.gmail.com", 587) as server:
                server.ehlo()
                server.starttls()
                server.login(mail_user, mail_pass)
                server.sendmail(mail_from, to_email, msg.as_string())

            _mark_sent(student_id)
            logger.info(f"[EMAIL SENT] {to_email} | Aacc={a_acc:.1%} | Absent={absence_minutes}m")
            return True
        except Exception as e:
            logger.error(f"[EMAIL FAILED] {to_email}: {e}")
            return False

    # Dev mode
    logger.warning(
        f"\n{'='*60}\n"
        f"[DEV EMAIL] To: {to_email}\n"
        f"Subject: {subject}\n"
        f"Grid: {grid_mode} | Quadrant: {quadrant} | Aacc: {a_acc:.1%}\n"
        f"Absent: {absence_minutes}m cumulative | {consecutive_minutes}m consecutive\n"
        f"Set MAIL_USERNAME + MAIL_PASSWORD to enable real dispatch.\n"
        f"{'='*60}"
    )
    _mark_sent(student_id)
    return False


# ─── Async wrapper for FastAPI BackgroundTasks ────────────────────────────────

async def send_warning_email(
    student_id: str,
    warning_count: int,
    quadrant: str,
    a_acc: float,
    grid_mode: str = "2x2",
    timestamp: Optional[str] = None,
) -> bool:
    """Async shim — delegates to sync function (runs in thread via BackgroundTasks)."""
    import asyncio
    from datetime import datetime
    ts = timestamp or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        send_warning_email_sync,
        student_id, warning_count, quadrant, a_acc, grid_mode, ts,
    )
