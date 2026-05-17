# EduFlow — Behavioral Trust Engine

> "EduFlow is not just a face-scanner; it is a Behavioral Trust Engine. By treating attendance as a ratio of identity confidence and spatial entropy, we eliminate the 'Photo Proxy' loophole while simultaneously empowering students with RAG-based productivity tools."

## Quick Start (Docker)

```bash
cp .env.example .env          # add your GOOGLE_API_KEY or OPENAI_API_KEY
docker-compose up --build
```

- Frontend: http://localhost:5173  
- Backend API: http://localhost:8000  
- API Docs: http://localhost:8000/docs

## Local Dev

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

## Mathematical Trust Model

### Anomaly Score
```
Anomaly = 0.30*(1-E) + 0.25*(1-B) + 0.20*(1-T) + 0.25*R
```
| Symbol | Meaning |
|--------|---------|
| E | Embedding Variance — live faces fluctuate, photos don't |
| B | Bounding Box Variance — real people move slightly |
| T | Temporal Randomness — natural jitter vs. clock-perfect replay |
| R | Repetition Score — looped video has identical frames |

### Identity Score (C_face)
```
C_face = (v_ref · v_live) / (‖v_ref‖ × ‖v_live‖)   ∈ [0, 1]
```

### Final Attendance Score
```
A_final = 0.7 × C_face + 0.3 × (1 − Anomaly)
```

### Safe Bunk Calculator
```
safe_bunks = floor(attended − 75% × total_sessions)
```

### Behavioral Consistency
```
B_score = 1 − |σ_individual − σ_classroom| / (σ_classroom + ε)
```

See `backend/app/core/scoring.py` for full annotated implementation.

## False Positive Mitigation

A common failure mode in attendance systems is penalising students for events outside their control — a classmate walking past the camera, a momentary lighting change, or a brief head turn. EduFlow is architecturally immune to these because the alarm engine operates on **cumulative time**, not instantaneous detection.

### The 300-Point Presence Buffer

The system samples every 2 seconds. A 60-minute lecture produces **1,800 total samples**. The Phase 2 warning threshold requires **300 consecutive or cumulative misses** before any alert is triggered.

```
1 occlusion event (e.g. someone walks past) = 1 missed sample
1 missed sample out of 300 required = 0.33% of the warning threshold
```

A student who is briefly blocked by someone walking past the camera loses exactly **1 out of 300 required "presence points"** — less than one third of one percent of the threshold. The system simply continues accumulating on the next sample 2 seconds later.

### Occlusion Tolerance Table

| Event | Duration | Samples lost | % of warning threshold |
|-------|----------|-------------|----------------------|
| Person walks past camera | ~2s | 1 | 0.33% |
| Student looks down at notes | ~6s | 3 | 1.0% |
| Temporary lighting change | ~10s | 5 | 1.67% |
| Student steps out briefly | ~60s | 30 | 10% |
| Student absent 5 min (consecutive) | 300s | 150 | triggers Phase 2 |
| Student absent 10 min (cumulative) | 600s | 300 | triggers Phase 2 |

### Why This Works

The key insight is that **presence is treated as a ratio, not a binary state**:

```
Aacc = successful_checks / total_checks
```

A single missed frame moves `Aacc` by at most `1/total_checks`. After 30 minutes of a lecture (900 samples), one missed frame changes `Aacc` by 0.11%. The signal-to-noise ratio improves continuously as the session progresses.

This also means the system is **self-healing** — a student who was briefly occluded and lost a few presence points recovers them automatically on the next successful detection, resetting their consecutive miss counter to zero while their cumulative `Aacc` remains high.

### Comparison to Threshold-Based Systems

| Approach | 1 missed frame | 5 missed frames | Verdict |
|----------|---------------|-----------------|---------|
| Binary (present/absent per frame) | Marked absent | Marked absent | Fragile |
| Strike-based (3 strikes) | 1/3 of alarm | Near alarm | Brittle |
| **EduFlow persistence (300 samples)** | **0.33% of threshold** | **1.67% of threshold** | **Robust** |

See `backend/app/core/alarm.py` for the full implementation with inline constants (`GRACE_SAMPLES = 300`, `CONSEC_BLOCK_SAMPLES = 150`, `ABSENT_SAMPLES = 450`).

## Architecture

```
backend/
  app/
    core/
      scoring.py      ← All math: anomaly, C_face, B_score, safe bunks
      liveness.py     ← Spatial mapping, per-student history, detector
    api/
      endpoints.py    ← REST API (register, verify-stream, stats, RAG)
    models/
      schemas.py      ← Beanie documents + Pydantic schemas
    services/
      rag.py          ← LangChain FAISS RAG service
  main.py             ← FastAPI app + 2-second temporal sampling loop

frontend/src/pages/
  FacultyDashboard.jsx  ← Live video + SVG quadrant overlay + event stream
  StudentPortal.jsx     ← Circular progress ring + safe bunk calculator
  StudyAssistant.jsx    ← RAG chat interface + PDF upload
```
