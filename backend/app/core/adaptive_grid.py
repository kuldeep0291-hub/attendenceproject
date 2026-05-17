"""
adaptive_grid.py — Dynamic Spatial Grid Engine
===============================================

Grid dimension is chosen based on face count (N_faces):

    N_faces <= 10  →  1×2  (vertical split, lateral movement focus)
    10 < N <=  30  →  2×2  (balanced spatial entropy)
    N_faces >  30  →  3×3  (high-resolution, dense classrooms)

Entropy Normalisation
---------------------
Spatial entropy is normalised by log2(num_quadrants) so the trust score
is consistent regardless of grid size:

    H_norm = H_raw / log2(Q)   where Q = total quadrant count

Quadrant IDs
------------
    1×2  →  L  (Left),  R  (Right)
    2×2  →  Q1, Q2, Q3, Q4
    3×3  →  Z1 … Z9  (row-major, top-left = Z1)
"""

from __future__ import annotations
import math
from typing import Tuple


# ─── Grid selection ───────────────────────────────────────────────────────────

def select_grid(n_faces: int) -> Tuple[int, int]:
    """Return (rows, cols) based on current face count."""
    if n_faces <= 10:
        return (1, 2)
    if n_faces <= 30:
        return (2, 2)
    return (3, 3)


def grid_label(rows: int, cols: str) -> str:
    return f"{rows}×{cols}"


# ─── Quadrant assignment ──────────────────────────────────────────────────────

def assign_quadrant(
    cx: float, cy: float,
    frame_w: int, frame_h: int,
    rows: int, cols: int,
) -> str:
    """
    Map centroid (cx, cy) to a quadrant ID for the given grid.

    Cell width  = frame_w / cols
    Cell height = frame_h / rows
    col_idx     = floor(cx / cell_w),  clamped to [0, cols-1]
    row_idx     = floor(cy / cell_h),  clamped to [0, rows-1]
    """
    cell_w = frame_w / cols
    cell_h = frame_h / rows

    col_idx = min(int(cx // cell_w), cols - 1)
    row_idx = min(int(cy // cell_h), rows - 1)

    if rows == 1 and cols == 2:
        return "L" if col_idx == 0 else "R"

    if rows == 2 and cols == 2:
        # Q1=top-right, Q2=top-left, Q3=bottom-left, Q4=bottom-right
        mapping = {(0, 0): "Q2", (0, 1): "Q1", (1, 0): "Q3", (1, 1): "Q4"}
        return mapping[(row_idx, col_idx)]

    # 3×3: Z1–Z9 row-major
    return f"Z{row_idx * cols + col_idx + 1}"


# ─── Entropy normalisation ────────────────────────────────────────────────────

def normalise_entropy(raw_entropy: float, rows: int, cols: int) -> float:
    """
    H_norm = H_raw / log2(Q)

    Ensures spatial entropy is comparable across grid sizes.
    Returns raw_entropy unchanged if Q <= 1.
    """
    q = rows * cols
    if q <= 1:
        return raw_entropy
    return raw_entropy / math.log2(q)


# ─── Convenience wrapper ──────────────────────────────────────────────────────

class AdaptiveGrid:
    """Stateless helper — call process() each 2-second cycle."""

    def process(
        self,
        n_faces: int,
        frame_w: int,
        frame_h: int,
        centroids: list[Tuple[float, float]],
    ) -> dict:
        """
        Given the current face count and centroids, return:
            rows, cols, grid_mode, quadrant_ids, num_quadrants
        """
        rows, cols = select_grid(n_faces)
        q_ids = [
            assign_quadrant(cx, cy, frame_w, frame_h, rows, cols)
            for cx, cy in centroids
        ]
        return {
            "rows": rows,
            "cols": cols,
            "grid_mode": f"{rows}x{cols}",
            "num_quadrants": rows * cols,
            "quadrant_ids": q_ids,
        }


adaptive_grid = AdaptiveGrid()
