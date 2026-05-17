"""
endpoints.py — EduFlow REST API
"""

import base64
import os
import random
import uuid
from datetime import datetime
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from pydantic import BaseModel as PydanticBase
from app.core.liveness import liveness_detector
from app.core.adaptive_grid import adaptive_grid, assign_quadrant, select_grid
from app.core.scoring import safe_bunk_calculator, find_best_match, euclidean_to_confidence
from app.core.alarm import alarm_engine
from app.services.email_service import send_warning_email_sync
from app.services.absence_email import send_absence_emails_sync
from app.models.schemas import (
    AttendanceLog, CourseMaterial, RAGQuery,
    Student, StudentRegister, StudentStatsResponse, VideoFrame,
    Section, SectionCreate, ManualAttendanceRecord, ManualAttendanceSubmit,
)
from app.services.rag import rag_assistant

router = APIRouter()

FRAME_W, FRAME_H    = 640, 480
ATTENDANCE_THRESHOLD = 0.60


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _decode_image(b64_str: str) -> np.ndarray:
    import cv2
    _, data = b64_str.split(",", 1) if "," in b64_str else ("", b64_str)
    arr = np.frombuffer(base64.b64decode(data), dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _extract_embedding(img: np.ndarray) -> List[float]:
    try:
        from deepface import DeepFace
        return DeepFace.represent(img, model_name="Facenet", enforce_detection=False)[0]["embedding"]
    except Exception:
        seed = int(np.mean(img)) if img is not None else 42
        return np.random.default_rng(seed).random(128).tolist()


# ─── Student Registration ─────────────────────────────────────────────────────

@router.post("/register")
async def register_student(payload: StudentRegister):
    if await Student.find_one(Student.roll_no == payload.roll_no):
        raise HTTPException(400, "Student already registered")
    try:
        img = _decode_image(payload.image_base64)
        embedding = _extract_embedding(img)
    except Exception as e:
        raise HTTPException(422, f"Image processing failed: {e}")

    await Student(
        name=payload.name, roll_no=payload.roll_no,
        email=payload.email, face_embeddings=embedding,
    ).insert()
    return {"status": "success", "message": f"Student {payload.name} registered"}


@router.post("/register-embedding")
async def register_embedding(payload: dict):
    """
    Extract a face embedding from a base64 photo and store it on the
    Student document. Called when a teacher uploads a student photo in
    the section matrix — ensures the student is ready for live matching.

    Body: { roll_no, photo_data_url, student_name (optional) }
    """
    roll_no       = payload.get("roll_no", "").strip()
    photo_b64     = payload.get("photo_data_url", "")
    student_name  = payload.get("student_name", "")

    if not roll_no or not photo_b64:
        raise HTTPException(422, "roll_no and photo_data_url are required")

    try:
        img       = _decode_image(photo_b64)
        embedding = _extract_embedding(img)
    except Exception as e:
        raise HTTPException(422, f"Embedding extraction failed: {e}")

    student = await Student.find_one(Student.roll_no == roll_no)
    if student:
        student.face_embeddings = embedding
        if photo_b64 and not student.photo_data_url:
            student.photo_data_url = photo_b64
        if student_name and not student.name:
            student.name = student_name
        await student.save()
    else:
        await Student(
            name=student_name or roll_no,
            roll_no=roll_no,
            face_embeddings=embedding,
            photo_data_url=photo_b64,
        ).insert()

    return {"status": "ok", "roll_no": roll_no, "embedding_dim": len(embedding)}


# ─── Frame Verification ───────────────────────────────────────────────────────

@router.post("/verify-stream")
async def verify_stream(frame: VideoFrame, background_tasks: BackgroundTasks):
    """
    Per-frame pipeline:
      1. Decode image
      2. Detect faces → count N_faces → select adaptive grid
      3. Assign quadrant via adaptive grid
      4. Run liveness / trust scoring
      5. Run alarm engine (strike → alarm → email trigger)
      6. Queue email via BackgroundTasks (non-blocking)
      7. Persist AttendanceLog
    """
    try:
        img = _decode_image(frame.frame_base64)
    except Exception:
        raise HTTPException(422, "Invalid frame data")

    # ── Face detection ────────────────────────────────────────────────────────
    n_faces = 1   # default
    try:
        from deepface import DeepFace
        faces_raw = DeepFace.extract_faces(img, enforce_detection=False)
        n_faces = max(len(faces_raw), 1)
        if faces_raw:
            r = faces_raw[0]["facial_area"]
            cx_px = r["x"] + r["w"] / 2
            cy_px = r["y"] + r["h"] / 2
            bbox  = (r["x"], r["y"], r["w"], r["h"])
        else:
            cx_px = random.randint(50, FRAME_W - 50)
            cy_px = random.randint(50, FRAME_H - 50)
            bbox  = (int(cx_px) - 32, int(cy_px) - 40, 64, 80)
        live_embedding = _extract_embedding(img)
    except Exception:
        cx_px = random.randint(50, FRAME_W - 50)
        cy_px = random.randint(50, FRAME_H - 50)
        bbox  = (int(cx_px) - 32, int(cy_px) - 40, 64, 80)
        live_embedding = np.random.rand(128).tolist()

    # ── Adaptive grid ─────────────────────────────────────────────────────────
    rows, cols = select_grid(n_faces)
    grid_mode  = f"{rows}x{cols}"
    quadrant   = assign_quadrant(cx_px, cy_px, FRAME_W, FRAME_H, rows, cols)

    # ── Identity matching — Euclidean nearest-neighbour ───────────────────────
    # Load all students with stored embeddings and find the closest match.
    #
    # Distance formula:  d = ||v_live - v_ref||₂  (L2 / Euclidean)
    # Confidence:        c = max(0, 1 - d / threshold)
    # Threshold:         15.0  (FaceNet 128-d; same person typically d < 10)
    #
    # This replaces the old "first student" stub with a real O(N×D) search.
    all_students = await Student.find().to_list()
    candidates   = [
        {"id": s.roll_no, "embedding": s.face_embeddings,
         "email": s.email, "name": s.name}
        for s in all_students if s.face_embeddings
    ]

    match = find_best_match(live_embedding, candidates, threshold=15.0)

    if match:
        student_id      = match["id"]
        c_face_override = match["confidence"]
        matched_student = next((s for s in all_students if s.roll_no == student_id), None)
    else:
        student_id      = "unknown"
        c_face_override = 0.0
        matched_student = None

    liveness_data = liveness_detector.check_liveness(
        student_id=student_id,
        x=int(cx_px), y=int(cy_px),
        confidence=c_face_override,
        embedding=live_embedding,
        bbox=bbox,
        ref_embedding=matched_student.face_embeddings if matched_student else None,
    )
    # Override c_face with the Euclidean-derived confidence
    liveness_data["c_face"] = round(c_face_override, 4)

    # ── Alarm engine ──────────────────────────────────────────────────────────
    alarm_data = alarm_engine.record_sample(
        student_id=student_id,
        final_score=liveness_data["final_attendance_score"],
        email=matched_student.email if matched_student else None,
    )

    # ── Email via BackgroundTasks (non-blocking) ──────────────────────────────
    # Fires when Phase 2 is first entered (10-min cumulative OR 5-min block)
    if alarm_data["alert_triggered"]:
        background_tasks.add_task(
            send_warning_email_sync,
            student_id=student_id,
            quadrant=quadrant,
            a_acc=alarm_data["a_acc"],
            grid_mode=grid_mode,
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            absence_minutes=alarm_data["absence_minutes"],
            consecutive_minutes=alarm_data["consecutive_minutes"],
        )

    # ── Persist log ───────────────────────────────────────────────────────────
    await AttendanceLog(
        student_id=student_id,
        session_id=frame.session_id or str(uuid.uuid4()),
        quadrant_id=quadrant,
        c_face=liveness_data["c_face"],
        anomaly_score=liveness_data["anomaly_score"],
        anomaly_components=liveness_data["anomaly_components"],
        behavioral_consistency=liveness_data["behavioral_consistency"],
        final_attendance_score=liveness_data["final_attendance_score"],
        is_proxy=liveness_data["is_proxy"],
        a_acc=alarm_data["a_acc"],
        attendance_status=alarm_data["status"],
        warning_count=alarm_data["warning_count"],
        alarm_triggered=alarm_data["alarm_triggered"],
    ).insert()

    if matched_student:
        matched_student.total_sessions += 1
        if liveness_data["final_attendance_score"] >= ATTENDANCE_THRESHOLD:
            matched_student.attended_sessions += 1
        await matched_student.save()

    # ── Write a ManualAttendanceRecord so the roster tab updates in real time ─
    if matched_student and frame.session_id:
        if liveness_data["is_proxy"] or liveness_data["anomaly_score"] > 0.65:
            live_att_status = "suspicious"
        elif liveness_data["final_attendance_score"] >= ATTENDANCE_THRESHOLD:
            live_att_status = "present"
        else:
            live_att_status = "absent"

        # Look up the real section name
        section_obj = await Section.get(frame.session_id)
        real_section_name = section_obj.name if section_obj else frame.session_id
        real_subject = section_obj.subject if section_obj else "Live Session"

        await ManualAttendanceRecord(
            section_id=frame.session_id,
            section_name=real_section_name,
            teacher_id="live_session",
            student_roll_no=student_id,
            student_name=matched_student.name,
            photo_data_url=None,
            status=live_att_status,
            subject=real_subject or "Live Session",
        ).insert()

    return {
        "status":       "processed",
        "student_id":   student_id,
        "student_name": matched_student.name if matched_student else "Unknown",
        "quadrant":     quadrant,
        "grid_mode":    grid_mode,
        "n_faces":      n_faces,
        "bbox":         bbox,
        "euclidean_distance": match["distance"] if match else None,
        **liveness_data,
        **alarm_data,
    }


# ─── Alarm state (live warning counters for dashboard) ───────────────────────

@router.get("/alarm/states")
async def get_alarm_states():
    """Returns current Aacc, status, and warning_count for all tracked students."""
    return alarm_engine.get_all_states()


# ─── Student Stats ────────────────────────────────────────────────────────────

@router.get("/student/stats/{roll_no}", response_model=StudentStatsResponse)
async def get_student_stats(roll_no: str):
    student = await Student.find_one(Student.roll_no == roll_no)
    if not student:
        raise HTTPException(404, "Student not found")

    total    = max(student.total_sessions, 1)
    attended = student.attended_sessions
    pct      = round((attended / total) * 100, 1)

    recent_logs = await AttendanceLog.find(
        AttendanceLog.student_id == roll_no
    ).sort(-AttendanceLog.timestamp).limit(5).to_list()

    alarm_state = next(
        (s for s in alarm_engine.get_all_states() if s["student_id"] == roll_no), {}
    )

    return StudentStatsResponse(
        roll_no=roll_no,
        name=student.name,
        attendance_percentage=pct,
        attended_sessions=attended,
        total_sessions=total,
        safe_bunks_available=safe_bunk_calculator(attended, total, total),
        recent_anomaly=any(log.is_proxy for log in recent_logs),
        a_acc=alarm_state.get("a_acc", 1.0),
        attendance_status=alarm_state.get("status", "Present"),
        warning_count=alarm_state.get("warning_count", 0),
        alerts_sent=alarm_state.get("alerts_sent", 0),
    )


@router.get("/students")
async def list_students():
    students = await Student.find_all().to_list()
    return [{"roll_no": s.roll_no, "name": s.name, "email": s.email} for s in students]


@router.get("/attendance/logs/{roll_no}")
async def get_attendance_logs(roll_no: str, limit: int = 20):
    return await AttendanceLog.find(
        AttendanceLog.student_id == roll_no
    ).sort(-AttendanceLog.timestamp).limit(limit).to_list()


# ─── Sections ────────────────────────────────────────────────────────────────

@router.post("/sections")
async def create_section(payload: SectionCreate):
    existing = await Section.find_one(
        Section.name == payload.name,
        Section.teacher_id == payload.teacher_id
    )
    if existing:
        raise HTTPException(400, f"Section '{payload.name}' already exists")
    section = Section(
        name=payload.name,
        teacher_id=payload.teacher_id,
        subject=payload.subject,
    )
    await section.insert()
    return {"status": "success", "id": str(section.id), "name": section.name}


@router.get("/sections/{teacher_id}")
async def get_sections(teacher_id: str):
    sections = await Section.find(Section.teacher_id == teacher_id).to_list()
    return [{"id": str(s.id), "name": s.name, "subject": s.subject,
             "created_at": s.created_at} for s in sections]


@router.delete("/sections/{section_id}")
async def delete_section(section_id: str):
    section = await Section.get(section_id)
    if not section:
        raise HTTPException(404, "Section not found")
    await section.delete()
    # Also remove all manual attendance records for this section
    await ManualAttendanceRecord.find(
        ManualAttendanceRecord.section_id == section_id
    ).delete()
    return {"status": "deleted"}


# ─── Manual Attendance ────────────────────────────────────────────────────────

@router.post("/attendance/manual")
async def submit_manual_attendance(payload: ManualAttendanceSubmit):
    """
    Teacher submits a batch of student attendance rows for a section.
    Each row has: roll_no, optional name, optional photo, present/absent.
    Persists to MongoDB and updates Student.attended_sessions counters.
    """
    records = []
    for row in payload.rows:
        if not row.student_roll_no.strip():
            continue

        record = ManualAttendanceRecord(
            section_id=payload.section_id,
            section_name=payload.section_name,
            teacher_id=payload.teacher_id,
            student_roll_no=row.student_roll_no.strip(),
            student_name=row.student_name,
            photo_data_url=row.photo_data_url,
            status=row.status,
            subject=payload.subject or payload.section_name,
        )
        await record.insert()
        records.append(record)

        # Update or create Student document
        student = await Student.find_one(Student.roll_no == row.student_roll_no.strip())
        if student:
            student.total_sessions += 1
            if row.status == "present":
                student.attended_sessions += 1
            # Store photo if not already saved
            if row.photo_data_url and not student.photo_data_url:
                student.photo_data_url = row.photo_data_url
            if row.student_name and not student.name:
                student.name = row.student_name
            await student.save()
        else:
            # Auto-register student from manual entry
            await Student(
                name=row.student_name or row.student_roll_no,
                roll_no=row.student_roll_no.strip(),
                photo_data_url=row.photo_data_url,
                total_sessions=1,
                attended_sessions=1 if row.status == "present" else 0,
            ).insert()

    return {
        "status": "success",
        "submitted": len(records),
        "present": sum(1 for r in records if r.status == "present"),
        "absent":  sum(1 for r in records if r.status == "absent"),
    }


@router.get("/attendance/manual/student/{roll_no}")
async def get_student_manual_attendance(roll_no: str):
    """All manual attendance records for a specific student."""
    records = await ManualAttendanceRecord.find(
        ManualAttendanceRecord.student_roll_no == roll_no
    ).sort(-ManualAttendanceRecord.submitted_at).to_list()
    total    = len(records)
    attended = sum(1 for r in records if r.status == "present")
    return {
        "roll_no": roll_no,
        "total": total,
        "attended": attended,
        "percentage": round((attended / total * 100), 1) if total else 0,
        "records": [{"section": r.section_name, "subject": r.subject,
                     "status": r.status, "date": r.submitted_at} for r in records],
    }


@router.get("/attendance/manual/{section_id}")
async def get_manual_attendance(section_id: str, limit: int = 100):
    """Get all manual attendance records for a section."""
    records = await ManualAttendanceRecord.find(
        ManualAttendanceRecord.section_id == section_id
    ).sort(-ManualAttendanceRecord.submitted_at).limit(limit).to_list()
    return [
        {
            "id": str(r.id),
            "student_roll_no": r.student_roll_no,
            "student_name": r.student_name,
            "status": r.status,
            "subject": r.subject,
            "submitted_at": r.submitted_at,
            "has_photo": bool(r.photo_data_url),
        }
        for r in records
    ]


# ─── Session Finalize — email absentees ──────────────────────────────────────

class FinalizeSession(PydanticBase):
    section_id:   str
    section_name: str
    subject:      Optional[str] = None

@router.post("/session/finalize")
async def finalize_session(payload: FinalizeSession, background_tasks: BackgroundTasks):
    """
    Called when teacher ends a live session.
    1. Determines who was present vs absent from ManualAttendanceRecord
    2. Sends absence notification emails to absentees via BackgroundTasks
    """
    # Get all records for this session
    records = await ManualAttendanceRecord.find(
        ManualAttendanceRecord.section_id == payload.section_id
    ).to_list()

    if not records:
        return {"status": "no_records", "message": "No attendance records found for this session"}

    # Latest status per student (most recent record wins)
    latest: dict = {}
    for r in sorted(records, key=lambda x: x.submitted_at):
        latest[r.student_roll_no] = {
            "roll_no": r.student_roll_no,
            "name":    r.student_name or r.student_roll_no,
            "status":  r.status,
        }

    present_list    = [s for s in latest.values() if s["status"] == "present"]
    absent_list     = [s for s in latest.values() if s["status"] in ("absent", "suspicious")]

    # Enrich with email from Student document
    for s in absent_list:
        student = await Student.find_one(Student.roll_no == s["roll_no"])
        if student and student.email:
            s["email"] = student.email

    # Dispatch absence emails in background
    if absent_list:
        background_tasks.add_task(
            send_absence_emails_sync,
            absentees=absent_list,
            section_name=payload.section_name,
            subject=payload.subject or payload.section_name,
        )

    return {
        "status":        "finalized",
        "total":         len(latest),
        "present":       len(present_list),
        "absent":        len(absent_list),
        "emails_queued": len(absent_list),
        "absentees":     [s["roll_no"] for s in absent_list],
    }


# ─── RAG ─────────────────────────────────────────────────────────────────────

@router.post("/rag/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported")
    os.makedirs("data/uploads", exist_ok=True)
    path = f"data/uploads/{uuid.uuid4()}_{file.filename}"
    with open(path, "wb") as f:
        f.write(await file.read())
    material = CourseMaterial(filename=file.filename, file_path=path)
    await material.insert()
    try:
        chunks = rag_assistant.process_pdf(path) or 0
        material.processed = True
        material.chunk_count = chunks
        await material.save()
    except Exception as e:
        raise HTTPException(500, f"PDF processing failed: {e}")
    return {"status": "success", "material_id": str(material.id),
            "filename": file.filename, "chunks": material.chunk_count}


@router.post("/rag/ask")
async def ask_question(payload: RAGQuery):
    return {"question": payload.question, "answer": rag_assistant.ask_question(payload.question)}


@router.get("/rag/materials")
async def list_materials():
    return [
        {"id": str(m.id), "filename": m.filename, "processed": m.processed,
         "chunk_count": m.chunk_count, "uploaded_at": m.uploaded_at}
        for m in await CourseMaterial.find_all().to_list()
    ]
