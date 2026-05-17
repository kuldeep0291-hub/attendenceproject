"""
alarm.py — 10-Minute Persistence & Alarm Engine
================================================

SAMPLING RATE: 1 sample every 2 seconds  →  30 samples/minute

GRACE PERIOD MATH
-----------------
    GRACE_PERIOD     = 600 s  →  300 samples  (10 min cumulative absence)
    CONSEC_BLOCK     = 150 samples            (5 min consecutive block)
    ABSENT_THRESHOLD = 25% of lecture         (default 60-min lecture = 450 samples)

PHASE ESCALATION
----------------
    Phase 1 — Observation  : miss logged, no action
    Phase 2 — Warning      : cumulative_misses >= 300  OR  consecutive_misses >= 150
                             → email dispatched once per session (cooldown enforced)
    Phase 3 — Final Absent : cumulative_misses >= ABSENT_THRESHOLD (450 for 60-min)
                             → attendance_status set to "Absent" in MongoDB

AACC STATUS THRESHOLDS
----------------------
    Present  : Aacc >= α (0.80)
    Warning  : β (0.50) <= Aacc < α
    Absent   : Aacc < β  OR  phase-3 triggered
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Optional
import time

# ─── Sampling constants ───────────────────────────────────────────────────────
SAMPLE_INTERVAL_S   = 2          # seconds between samples
SAMPLES_PER_MINUTE  = 60 // SAMPLE_INTERVAL_S   # 30

# ─── Persistence thresholds ───────────────────────────────────────────────────
ALARM_SCORE_THRESHOLD = 0.45     # final_score below this → miss

GRACE_PERIOD_S        = 600      # 10 minutes
GRACE_SAMPLES         = GRACE_PERIOD_S // SAMPLE_INTERVAL_S   # 300

CONSEC_BLOCK_S        = 300      # 5 minutes consecutive
CONSEC_BLOCK_SAMPLES  = CONSEC_BLOCK_S // SAMPLE_INTERVAL_S   # 150

LECTURE_DURATION_S    = 3600     # default 60-minute lecture
ABSENT_FRACTION       = 0.25     # absent if missing > 25% of lecture
ABSENT_SAMPLES        = int((LECTURE_DURATION_S // SAMPLE_INTERVAL_S) * ABSENT_FRACTION)
# = 450 samples = 15 minutes

# ─── Aacc thresholds ─────────────────────────────────────────────────────────
ALPHA = 0.80
BETA  = 0.50


@dataclass
class StudentAlarmState:
    student_id:          str
    email:               Optional[str] = None

    # Counters
    total_checks:        int = 0
    successful_checks:   int = 0
    cumulative_misses:   int = 0    # total miss samples this session
    consecutive_misses:  int = 0    # current unbroken miss streak
    peak_consecutive:    int = 0    # longest streak seen

    # Phase tracking
    phase:               int = 1    # 1=Observation, 2=Warning, 3=Absent
    email_sent:          bool = False
    absent_finalized:    bool = False

    # Timestamps
    session_start:       float = field(default_factory=time.time)
    last_miss_at:        Optional[float] = None
    email_sent_at:       Optional[float] = None

    # ── Derived ───────────────────────────────────────────────────────────────

    @property
    def a_acc(self) -> float:
        if self.total_checks == 0:
            return 1.0
        return round(self.successful_checks / self.total_checks, 4)

    @property
    def absence_minutes(self) -> float:
        """Total cumulative absence in minutes."""
        return round(self.cumulative_misses * SAMPLE_INTERVAL_S / 60, 1)

    @property
    def consecutive_minutes(self) -> float:
        """Current consecutive absence block in minutes."""
        return round(self.consecutive_misses * SAMPLE_INTERVAL_S / 60, 1)

    @property
    def aacc_status(self) -> str:
        if self.absent_finalized:
            return "Absent"
        acc = self.a_acc
        if acc >= ALPHA:
            return "Present"
        if acc >= BETA:
            return "Warning"
        return "Absent"

    def to_dict(self) -> dict:
        return {
            "student_id":         self.student_id,
            "phase":              self.phase,
            "a_acc":              self.a_acc,
            "status":             self.aacc_status,
            "total_checks":       self.total_checks,
            "successful_checks":  self.successful_checks,
            "cumulative_misses":  self.cumulative_misses,
            "consecutive_misses": self.consecutive_misses,
            "absence_minutes":    self.absence_minutes,
            "consecutive_minutes": self.consecutive_minutes,
            "email_sent":         self.email_sent,
            "absent_finalized":   self.absent_finalized,
        }


class AlarmEngine:
    """
    Persistence-based alarm engine.
    Call record_sample() on every 2-second detection cycle.
    """

    def __init__(self):
        self._states: Dict[str, StudentAlarmState] = {}

    def get_or_create(self, student_id: str, email: Optional[str] = None) -> StudentAlarmState:
        if student_id not in self._states:
            self._states[student_id] = StudentAlarmState(
                student_id=student_id, email=email
            )
        elif email and not self._states[student_id].email:
            self._states[student_id].email = email
        return self._states[student_id]

    def record_sample(
        self,
        student_id: str,
        final_score: float,
        email: Optional[str] = None,
    ) -> dict:
        """
        Process one 2-second sample.

        Returns a payload dict with:
            phase, a_acc, status, absence_minutes, consecutive_minutes,
            alert_triggered, absent_finalized, warning_count (alias)
        """
        state = self.get_or_create(student_id, email)
        state.total_checks += 1

        is_miss = final_score < ALARM_SCORE_THRESHOLD

        # ── Update counters ───────────────────────────────────────────────────
        if is_miss:
            state.cumulative_misses  += 1
            state.consecutive_misses += 1
            state.last_miss_at        = time.time()
            state.peak_consecutive    = max(state.peak_consecutive,
                                            state.consecutive_misses)
        else:
            state.successful_checks  += 1
            state.consecutive_misses  = 0   # reset streak on detection

        # ── Phase 3: Final Absent ─────────────────────────────────────────────
        # Triggered when cumulative absence > 25% of lecture (450 samples / 15 min)
        if not state.absent_finalized and state.cumulative_misses >= ABSENT_SAMPLES:
            state.absent_finalized = True
            state.phase = 3

        # ── Phase 2: Warning email ────────────────────────────────────────────
        # Triggered once when:
        #   cumulative_misses >= 300 (10 min total)  OR
        #   consecutive_misses >= 150 (5 min block)
        # Cooldown: only one email per session
        #
        # FALSE POSITIVE MITIGATION
        # ─────────────────────────
        # Because the threshold is 300 samples (not 1), brief occlusions are
        # mathematically irrelevant:
        #
        #   1 occlusion (e.g. someone walks past camera) = 1 missed sample
        #   Impact = 1 / GRACE_SAMPLES = 1 / 300 = 0.33% of warning threshold
        #
        # A student who is briefly blocked never accumulates enough misses to
        # trigger an alarm. Only sustained, genuine absence crosses the threshold.
        #
        # The system is also self-healing: consecutive_misses resets to 0 on
        # any successful detection, so a student who returns after a brief
        # absence immediately stops contributing to the consecutive block counter.
        #
        # Occlusion tolerance reference:
        #   Person walks past (~2s)   → 1 sample  →  0.33% of threshold  → safe
        #   Student looks down (~6s)  → 3 samples →  1.0%  of threshold  → safe
        #   Steps out briefly (~60s)  → 30 samples → 10%   of threshold  → safe
        #   5-min consecutive block   → 150 samples → 50%  of threshold  → alarm
        #   10-min cumulative         → 300 samples → 100% of threshold  → alarm
        alert_triggered = False
        if (
            state.phase == 1
            and not state.email_sent
            and (
                state.cumulative_misses  >= GRACE_SAMPLES        # 10 min cumulative
                or state.consecutive_misses >= CONSEC_BLOCK_SAMPLES  # 5 min block
            )
        ):
            state.phase        = 2
            state.email_sent   = True
            state.email_sent_at = time.time()
            alert_triggered    = True

        return {
            # Core alarm payload
            "phase":               state.phase,
            "a_acc":               state.a_acc,
            "status":              state.aacc_status,
            "absence_minutes":     state.absence_minutes,
            "consecutive_minutes": state.consecutive_minutes,
            "cumulative_misses":   state.cumulative_misses,
            "consecutive_misses":  state.consecutive_misses,
            "total_checks":        state.total_checks,
            "successful_checks":   state.successful_checks,
            "alert_triggered":     alert_triggered,
            "absent_finalized":    state.absent_finalized,
            # Legacy aliases kept for dashboard compatibility
            "warning_count":       state.phase - 1,
            "alarm_triggered":     alert_triggered,
            "alerts_sent":         int(state.email_sent),
        }

    def get_all_states(self) -> list:
        return [s.to_dict() for s in self._states.values()]

    def reset(self):
        self._states.clear()


alarm_engine = AlarmEngine()
