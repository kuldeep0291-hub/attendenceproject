"""
liveness.py — Spatial mapping and per-student liveness state management.
Delegates all scoring math to scoring.py.
"""

import time
from typing import Dict, Tuple, List
from app.core.scoring import (
    StudentHistory,
    compute_anomaly_score,
    compute_behavioral_consistency,
    compute_final_score,
    cosine_similarity,
    PROXY_THRESHOLD,
)


def map_to_quadrant(x: int, y: int, frame_w: int, frame_h: int) -> str:
    """
    Divide the camera frame into a 2×2 quadrant grid and return the
    Quadrant_ID for the centroid (x, y).

        Q2 | Q1
        ───┼───
        Q3 | Q4

    Q1 = top-right,  Q2 = top-left
    Q3 = bottom-left, Q4 = bottom-right
    """
    mid_x = frame_w // 2
    mid_y = frame_h // 2

    if x >= mid_x and y < mid_y:
        return "Q1"
    elif x < mid_x and y < mid_y:
        return "Q2"
    elif x < mid_x and y >= mid_y:
        return "Q3"
    else:
        return "Q4"


class LivenessProxyDetector:
    """
    Maintains rolling history for every tracked student and exposes a
    single `check_liveness` method that returns all scoring signals.

    Temporal Sampling: designed to be called every 2 seconds from the
    background camera loop in main.py.
    """

    def __init__(self):
        # student_id → StudentHistory
        self._histories: Dict[str, StudentHistory] = {}

    def _get_history(self, student_id: str) -> StudentHistory:
        if student_id not in self._histories:
            self._histories[student_id] = StudentHistory()
        return self._histories[student_id]

    def check_liveness(
        self,
        student_id: str,
        x: int,
        y: int,
        confidence: float,
        embedding: List[float] = None,
        bbox: Tuple[int, int, int, int] = None,
        ref_embedding: List[float] = None,
    ) -> dict:
        """
        Push a new observation and return the full scoring payload.

        Parameters
        ----------
        student_id   : unique identifier (roll number)
        x, y         : face centroid in pixels
        confidence   : raw face-match confidence from DeepFace (0–1)
        embedding    : 128-d face embedding vector for this frame
        bbox         : (x, y, w, h) bounding box of detected face
        ref_embedding: stored reference embedding for C_face calculation
        """
        history = self._get_history(student_id)
        ts = time.time()

        # Use provided values or sensible defaults for stub mode
        _embedding = embedding or [0.0] * 128
        _bbox = bbox or (x, y, 64, 80)
        centroid = (x, y)

        history.push(_embedding, _bbox, ts, centroid)

        # ── Scoring ──────────────────────────────────────────────────────────
        anomaly_data = compute_anomaly_score(history)
        anomaly_score = anomaly_data["anomaly_score"]

        # C_face: cosine similarity if we have both embeddings, else use raw confidence
        if ref_embedding and embedding:
            c_face = cosine_similarity(ref_embedding, embedding)
        else:
            c_face = float(confidence)

        final_score = compute_final_score(c_face, anomaly_score)
        is_proxy = anomaly_score > PROXY_THRESHOLD

        # ── Behavioral consistency across classroom ───────────────────────────
        import numpy as np
        individual_var = float(np.sum(np.var(
            [[p[0], p[1]] for p in history.positions], axis=0
        ))) if len(history.positions) >= 2 else 0.0

        all_vars = [
            float(np.sum(np.var([[p[0], p[1]] for p in h.positions], axis=0)))
            for sid, h in self._histories.items()
            if sid != student_id and len(h.positions) >= 2
        ]
        b_score = compute_behavioral_consistency(individual_var, all_vars)

        return {
            "c_face": round(c_face, 4),
            "anomaly_score": anomaly_score,
            "anomaly_components": {
                "E": anomaly_data["E"],
                "B": anomaly_data["B"],
                "T": anomaly_data["T"],
                "R": anomaly_data["R"],
            },
            "behavioral_consistency": round(b_score, 4),
            "final_attendance_score": final_score,
            "is_proxy": is_proxy,
            "spatial_variance": round(individual_var, 4),
        }

    def reset_student(self, student_id: str):
        """Clear history for a student (e.g., at session end)."""
        self._histories.pop(student_id, None)

    def reset_all(self):
        self._histories.clear()


# Singleton used across the application
liveness_detector = LivenessProxyDetector()
