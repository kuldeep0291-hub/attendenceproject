"""
EduFlow Behavioral Trust Engine — scoring.py
============================================
This module implements the core mathematical trust model for proxy detection.

TRUST MODEL OVERVIEW
--------------------
Attendance is treated not as a binary present/absent flag, but as a
*confidence ratio* derived from identity verification and behavioral entropy.

The final attendance score is:
    A_final = 0.7 * C_face + 0.3 * (1 - Anomaly)

Where:
    C_face  = Cosine Similarity Ratio between stored and live face embeddings
    Anomaly = Weighted behavioral anomaly score (see below)

ANOMALY SCORE FORMULA
---------------------
    Anomaly = 0.30*(1 - E) + 0.25*(1 - B) + 0.20*(1 - T) + 0.25*R

Component breakdown:
    E  — Embedding Variance (0–1)
         Measures how much the face embedding fluctuates across frames.
         A real face has micro-variations; a static photo has near-zero variance.
         High E → low anomaly contribution from this term.

    B  — Bounding Box Variance (0–1)
         Measures spatial movement of the detected face bounding box.
         A live person shifts slightly; a printed photo stays perfectly still.
         High B → low anomaly contribution from this term.

    T  — Temporal Randomness (0–1)
         Measures whether detection intervals are naturally irregular.
         Real humans have slight timing jitter; replay attacks are clock-perfect.
         High T → low anomaly contribution from this term.

    R  — Repetition Score (0–1)
         Measures how often the same embedding vector repeats across frames.
         A looped video or static image will have high repetition.
         High R → high anomaly contribution (note: no inversion here).

WEIGHT RATIONALE
----------------
    0.30 × (1-E)  — Embedding variance is the strongest single signal
    0.25 × (1-B)  — Bounding box movement is equally important as repetition
    0.20 × (1-T)  — Temporal jitter is a supporting signal
    0.25 × R      — Repetition directly adds to anomaly (not inverted)
    ─────────────
    Σ = 1.00      — Weights sum to 1, keeping score in [0, 1]

BEHAVIORAL CONSISTENCY (B_score)
---------------------------------
    B_score = 1 - |σ_individual - σ_classroom| / (σ_classroom + ε)

Compares an individual's movement variance against the classroom mean variance.
A student who is suspiciously still while everyone else moves normally gets a
low B_score, flagging potential proxy behavior at the collective level.

COSINE SIMILARITY (C_face)
--------------------------
    C_face = (v_ref · v_live) / (||v_ref|| × ||v_live||)

Ranges from -1 to 1; clamped to [0, 1] for use as a confidence ratio.
Values above IDENTITY_THRESHOLD (0.75) are considered a verified match.
"""

import numpy as np
from collections import deque
from typing import Dict, List, Optional, Tuple


# ─── Thresholds ───────────────────────────────────────────────────────────────
IDENTITY_THRESHOLD = 0.75   # C_face must exceed this to count as present
PROXY_THRESHOLD    = 0.65   # Anomaly score above this flags a proxy attempt
HISTORY_SIZE       = 10     # Number of frames kept in rolling history


# ─── Cosine Similarity ────────────────────────────────────────────────────────

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """
    Compute C_face = (v_ref · v_live) / (||v_ref|| × ||v_live||).

    Returns a value in [0, 1] clamped from the raw [-1, 1] cosine range.
    A score of 1.0 means the embeddings are identical; 0.0 means orthogonal.
    """
    a = np.array(v1, dtype=np.float64)
    b = np.array(v2, dtype=np.float64)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    raw = float(np.dot(a, b) / (norm_a * norm_b))
    return float(np.clip(raw, 0.0, 1.0))


# ─── Per-Student History ──────────────────────────────────────────────────────

class StudentHistory:
    """
    Rolling window of per-frame observations for a single student.
    Stores the last HISTORY_SIZE frames of embeddings, bounding boxes,
    and detection timestamps to compute variance-based anomaly signals.
    """

    def __init__(self):
        self.embeddings:   deque = deque(maxlen=HISTORY_SIZE)   # List[List[float]]
        self.bboxes:       deque = deque(maxlen=HISTORY_SIZE)   # (x, y, w, h)
        self.timestamps:   deque = deque(maxlen=HISTORY_SIZE)   # float (epoch seconds)
        self.positions:    deque = deque(maxlen=HISTORY_SIZE)   # (cx, cy) centroid

    def push(self, embedding: List[float], bbox: Tuple[int,int,int,int],
             timestamp: float, centroid: Tuple[int,int]):
        self.embeddings.append(embedding)
        self.bboxes.append(bbox)
        self.timestamps.append(timestamp)
        self.positions.append(centroid)

    def ready(self) -> bool:
        """True once we have enough frames for reliable statistics."""
        return len(self.embeddings) >= 3


# ─── Component Calculators ────────────────────────────────────────────────────

def _embedding_variance(history: StudentHistory) -> float:
    """
    E — Embedding Variance.
    Computes the mean per-dimension variance across stored embeddings,
    then normalises to [0, 1] via a sigmoid-like soft cap.
    A static photo yields E ≈ 0; a live face yields E > 0.
    """
    if not history.ready():
        return 0.5  # neutral default while warming up
    mat = np.array(list(history.embeddings), dtype=np.float64)  # (N, D)
    mean_var = float(np.mean(np.var(mat, axis=0)))
    # Soft-normalise: variance of ~0.01 maps to ~0.73 (typical live face)
    return float(1.0 - np.exp(-mean_var / 0.01))


def _bbox_variance(history: StudentHistory) -> float:
    """
    B — Bounding Box Variance.
    Measures spatial jitter of the face bounding box centroid.
    Normalised so that ~5px of movement maps to B ≈ 0.63.
    """
    if not history.ready():
        return 0.5
    pts = np.array([(b[0] + b[2]/2, b[1] + b[3]/2) for b in history.bboxes])
    total_var = float(np.sum(np.var(pts, axis=0)))
    return float(1.0 - np.exp(-total_var / 25.0))


def _temporal_randomness(history: StudentHistory) -> float:
    """
    T — Temporal Randomness.
    Measures coefficient of variation (std/mean) of inter-frame intervals.
    A replay attack has perfectly uniform intervals → T ≈ 0.
    A live person has natural jitter → T > 0.
    """
    if len(history.timestamps) < 3:
        return 0.5
    ts = np.array(list(history.timestamps), dtype=np.float64)
    intervals = np.diff(ts)
    mean_iv = float(np.mean(intervals))
    if mean_iv < 1e-9:
        return 0.0
    cv = float(np.std(intervals) / mean_iv)
    return float(np.clip(cv, 0.0, 1.0))


def _repetition_score(history: StudentHistory) -> float:
    """
    R — Repetition Score.
    Counts how many consecutive embedding pairs are nearly identical
    (cosine similarity > 0.999), normalised by the number of pairs.
    A looped video or static image scores R ≈ 1.
    """
    if not history.ready():
        return 0.0
    embs = list(history.embeddings)
    pairs = len(embs) - 1
    if pairs == 0:
        return 0.0
    repeats = sum(
        1 for i in range(pairs)
        if cosine_similarity(embs[i], embs[i+1]) > 0.999
    )
    return float(repeats / pairs)


# ─── Anomaly Score ────────────────────────────────────────────────────────────

def compute_anomaly_score(history: StudentHistory) -> Dict[str, float]:
    """
    Compute the full anomaly score using the weighted formula:

        Anomaly = 0.30*(1-E) + 0.25*(1-B) + 0.20*(1-T) + 0.25*R

    Returns a dict with all component values and the final score.
    """
    E = _embedding_variance(history)
    B = _bbox_variance(history)
    T = _temporal_randomness(history)
    R = _repetition_score(history)

    anomaly = (
        0.30 * (1.0 - E) +
        0.25 * (1.0 - B) +
        0.20 * (1.0 - T) +
        0.25 * R
    )
    return {
        "E": round(E, 4),
        "B": round(B, 4),
        "T": round(T, 4),
        "R": round(R, 4),
        "anomaly_score": round(float(np.clip(anomaly, 0.0, 1.0)), 4),
    }


# ─── Behavioral Consistency (B_score) ────────────────────────────────────────

def compute_behavioral_consistency(
    individual_variance: float,
    classroom_variances: List[float],
) -> float:
    """
    B_score = 1 - |σ_individual - σ_classroom| / (σ_classroom + ε)

    Compares an individual's movement variance against the classroom mean.
    Returns a value in [0, 1]; low scores indicate suspicious stillness
    relative to the rest of the class.
    """
    if not classroom_variances:
        return 1.0
    sigma_class = float(np.mean(classroom_variances))
    b_score = 1.0 - abs(individual_variance - sigma_class) / (sigma_class + 1e-6)
    return float(np.clip(b_score, 0.0, 1.0))


# ─── Final Attendance Score ───────────────────────────────────────────────────

def compute_final_score(c_face: float, anomaly_score: float) -> float:
    """
    A_final = 0.7 * C_face + 0.3 * (1 - Anomaly)

    Combines identity confidence with liveness quality.
    A score above IDENTITY_THRESHOLD (0.75) marks the student as present.
    """
    return round(float(np.clip(0.7 * c_face + 0.3 * (1.0 - anomaly_score), 0.0, 1.0)), 4)


# ─── Euclidean Distance & Identity Matching ───────────────────────────────────

def euclidean_distance(v1: List[float], v2: List[float]) -> float:
    """
    L2 distance between two embedding vectors.

    d(v1, v2) = sqrt( Σ (v1_i - v2_i)² )

    Lower = more similar. Typical FaceNet thresholds:
        d < 10  → same person (strict)
        d < 15  → same person (lenient)
        d > 20  → different person
    """
    a = np.array(v1, dtype=np.float64)
    b = np.array(v2, dtype=np.float64)
    return float(np.linalg.norm(a - b))


def euclidean_to_confidence(distance: float, threshold: float = 10.0) -> float:
    """
    Convert Euclidean distance to a [0, 1] confidence score.

    confidence = max(0, 1 - distance / threshold)

    At d=0   → confidence=1.0 (perfect match)
    At d=threshold → confidence=0.0 (no match)
    """
    return float(max(0.0, 1.0 - distance / threshold))


def find_best_match(
    live_embedding: List[float],
    candidates: List[Dict],          # [{"id": str, "embedding": List[float]}]
    threshold: float = 15.0,
) -> Optional[Dict]:
    """
    Nearest-neighbour search using Euclidean distance.

    Parameters
    ----------
    live_embedding : 128-d embedding from the live camera frame
    candidates     : list of {"id": roll_no, "embedding": stored_vector}
    threshold      : max distance to accept as a match

    Returns
    -------
    Best match dict with keys: id, distance, confidence
    Returns None if no candidate is within threshold.

    Complexity: O(N × D) — fine for classroom sizes (N ≤ 200, D = 128)
    """
    if not candidates or not live_embedding:
        return None

    best_id       = None
    best_distance = float("inf")

    for c in candidates:
        if not c.get("embedding"):
            continue
        d = euclidean_distance(live_embedding, c["embedding"])
        if d < best_distance:
            best_distance = d
            best_id       = c["id"]

    if best_distance > threshold:
        return None   # no confident match

    return {
        "id":         best_id,
        "distance":   round(best_distance, 4),
        "confidence": round(euclidean_to_confidence(best_distance, threshold), 4),
    }


# ─── Safe Bunk Calculator ─────────────────────────────────────────────────────

def safe_bunk_calculator(
    attended: int,
    total: int,
    total_sessions: int,
    required_pct: float = 75.0,
) -> int:
    """
    Safe bunks = floor((current_attended - required_attended) / impact_per_class)

    Where:
        required_attended = ceil(required_pct / 100 * total_sessions)
        impact_per_class  = 1  (each bunk reduces attended count by 1)

    Returns 0 if the student is already below the threshold.
    """
    import math
    required = math.ceil((required_pct / 100.0) * total_sessions)
    safe = attended - required
    return max(0, int(safe))
