from pydantic import BaseModel, Field
from beanie import Document
from typing import List, Optional, Dict
from datetime import datetime


# ─── MongoDB Documents ────────────────────────────────────────────────────────

class Student(Document):
    name: str
    roll_no: str
    email: Optional[str] = None
    face_embeddings: List[float] = Field(default_factory=list)
    photo_data_url: Optional[str] = None   # base64 photo stored at registration
    total_sessions: int = 0
    attended_sessions: int = 0

    class Settings:
        name = "Students"


class Section(Document):
    """A teacher's class section (e.g. CSE-3A, Section B)."""
    name: str
    teacher_id: str
    subject: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "Sections"


class ManualAttendanceRecord(Document):
    """
    One row submitted by a teacher via the section matrix.
    Stores roll_no, photo, and present/absent status for a given session.
    """
    section_id: str
    section_name: str
    teacher_id: str
    student_roll_no: str
    student_name: Optional[str] = None
    photo_data_url: Optional[str] = None
    status: str = "present"          # "present" | "absent"
    subject: Optional[str] = None
    submitted_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "ManualAttendance"


class AttendanceLog(Document):
    student_id: str
    session_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    quadrant_id: str
    c_face: float = 0.0
    anomaly_score: float = 0.0
    anomaly_components: Dict[str, float] = Field(default_factory=dict)
    behavioral_consistency: float = 1.0
    final_attendance_score: float = 0.0
    is_proxy: bool = False
    a_acc: float = 1.0
    attendance_status: str = "Present"
    warning_count: int = 0
    alarm_triggered: bool = False

    class Settings:
        name = "AttendanceLogs"


class CourseMaterial(Document):
    filename: str
    file_path: str
    uploaded_by: Optional[str] = None
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
    processed: bool = False
    chunk_count: int = 0

    class Settings:
        name = "CourseMaterials"


# ─── Request / Response Schemas ───────────────────────────────────────────────

class StudentRegister(BaseModel):
    name: str
    roll_no: str
    email: Optional[str] = None
    image_base64: str


class VideoFrame(BaseModel):
    frame_base64: str
    timestamp: float
    session_id: Optional[str] = None


class RAGQuery(BaseModel):
    question: str
    material_id: Optional[str] = None


class StudentStatsResponse(BaseModel):
    roll_no: str
    name: str
    attendance_percentage: float
    attended_sessions: int
    total_sessions: int
    safe_bunks_available: int
    recent_anomaly: bool
    a_acc: float = 1.0
    attendance_status: str = "Present"
    warning_count: int = 0
    alerts_sent: int = 0


class SectionCreate(BaseModel):
    name: str
    teacher_id: str
    subject: Optional[str] = None


class ManualAttendanceRow(BaseModel):
    student_roll_no: str
    student_name: Optional[str] = None
    photo_data_url: Optional[str] = None
    status: str = "present"   # "present" | "absent" | "suspicious"


class ManualAttendanceSubmit(BaseModel):
    section_id: str
    section_name: str
    teacher_id: str
    subject: Optional[str] = None
    rows: List[ManualAttendanceRow]


class FinalizeSession(BaseModel):
    section_id:   str
    section_name: str
    subject:      Optional[str] = None
