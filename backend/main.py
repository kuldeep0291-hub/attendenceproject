"""
main.py — EduFlow FastAPI application entry point.

Temporal Sampling: the background camera loop fires every 2 seconds,
matching the mathematical requirement for the anomaly detection model.
"""

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

from app.models.schemas import Student, AttendanceLog, CourseMaterial, Section, ManualAttendanceRecord
from app.api.endpoints import router as api_router


MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME   = os.getenv("DB_NAME", "eduflow")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Database init ─────────────────────────────────────────────────────────
    client = AsyncIOMotorClient(MONGO_URL)
    await init_beanie(
        database=client[DB_NAME],
        document_models=[Student, AttendanceLog, CourseMaterial, Section, ManualAttendanceRecord],
    )

    # ── Background temporal sampling loop (every 2 seconds) ──────────────────
    task = asyncio.create_task(_camera_sampling_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def _camera_sampling_loop():
    """
    Temporal Sampling: polls the camera/RTSP stream exactly every 2 seconds.
    In production, replace the stub with actual frame capture and call
    POST /api/verify-stream with the encoded frame.
    """
    while True:
        await asyncio.sleep(2)
        # TODO: capture frame → encode → POST to /api/verify-stream
        # frame = camera.read()
        # await process_frame(frame)


app = FastAPI(
    title="EduFlow API",
    description="AI-Driven Attendance & Academic Productivity Suite — Behavioral Trust Engine",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/", tags=["Health"])
def read_root():
    return {"message": "EduFlow API is running", "version": "1.0.0"}


@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "ok"}
