"""
Data analysis and chart generation via pandas + matplotlib.

CLI: python -m src.data_analysis <file-path> <query> [--json]

Reads CSV / JSON / JSONL / XLSX / Parquet files, computes a summary,
and generates one auto-selected chart. Degrades gracefully if optional
deps are absent.
"""
from __future__ import annotations

import base64
import json
import sys
import tempfile
from pathlib import Path


def _auto_chart(df, out_path: str) -> bool:
    """Generate an auto-selected chart (line/bar/heatmap) and save as PNG. Returns True on success."""
    try:
        import matplotlib  # type: ignore[import]
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt  # type: ignore[import]
        import pandas as pd  # type: ignore[import]

        fig, ax = plt.subplots(figsize=(8, 4))

        # Prefer a date/time axis for line charts
        date_cols = [c for c in df.columns if pd.api.types.is_datetime64_any_dtype(df[c])]
        num_cols = df.select_dtypes("number").columns.tolist()
        cat_cols = df.select_dtypes("object").columns.tolist()

        if date_cols and num_cols:
            df = df.sort_values(date_cols[0])
            ax.plot(df[date_cols[0]], df[num_cols[0]])
            ax.set_xlabel(date_cols[0])
            ax.set_ylabel(num_cols[0])
            ax.set_title(f"{num_cols[0]} over time")
        elif cat_cols:
            counts = df[cat_cols[0]].value_counts().head(10)
            counts.plot(kind="bar", ax=ax)
            ax.set_title(f"Top {cat_cols[0]} values")
        elif len(num_cols) >= 3:
            corr = df[num_cols].corr()
            im = ax.imshow(corr.values, cmap="coolwarm", vmin=-1, vmax=1)
            ax.set_xticks(range(len(num_cols)))
            ax.set_yticks(range(len(num_cols)))
            ax.set_xticklabels(num_cols, rotation=45, ha="right")
            ax.set_yticklabels(num_cols)
            plt.colorbar(im, ax=ax)
            ax.set_title("Correlation heatmap")
        else:
            plt.close(fig)
            return False

        plt.tight_layout()
        fig.savefig(out_path, dpi=90)
        plt.close(fig)
        return True
    except Exception:
        return False


def analyze(file_path: str, query: str) -> dict:
    """Analyze a data file and return a summary + optional base64 chart PNG."""
    try:
        import pandas as pd  # type: ignore[import]
    except ImportError:
        return {"success": False, "error": "pandas not installed — run: pip install pandas matplotlib openpyxl"}

    path = Path(file_path)
    if not path.exists():
        return {"success": False, "error": f"File not found: {file_path}"}

    ext = path.suffix.lower()
    try:
        if ext == ".csv":
            df = pd.read_csv(file_path)
        elif ext in (".json", ".jsonl"):
            df = pd.read_json(file_path, lines=(ext == ".jsonl"))
        elif ext in (".xlsx", ".xls"):
            df = pd.read_excel(file_path)
        elif ext == ".parquet":
            df = pd.read_parquet(file_path)
        else:
            return {"success": False, "error": f"Unsupported file type: {ext}"}
    except Exception as exc:
        return {"success": False, "error": f"Failed to read file: {exc}"}

    rows, cols = df.shape
    columns = df.columns.tolist()

    lines = [f"File: {path.name}  ({rows:,} rows × {cols} columns)"]
    lines.append("\n## Numeric summary\n" + df.describe().to_string())

    cat_cols = df.select_dtypes("object").columns[:3]
    if len(cat_cols):
        lines.append("\n## Top values")
        for col in cat_cols:
            vc = df[col].value_counts().head(5).to_string()
            lines.append(f"\n{col}:\n{vc}")

    if query:
        lines.append(f"\n## Query context\n{query}")

    summary = "\n".join(lines)

    chart_b64 = None
    fd, tmp = tempfile.mkstemp(suffix=".png")
    import os
    os.close(fd)
    try:
        if _auto_chart(df, tmp):
            with open(tmp, "rb") as f:
                chart_b64 = base64.b64encode(f.read()).decode()
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass

    return {
        "success": True,
        "summary": summary,
        "chartBase64": chart_b64,
        "rowCount": rows,
        "columnCount": cols,
        "columns": columns,
    }


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2:
        print(json.dumps({"success": False, "error": "Usage: python -m src.data_analysis <file> <query> [--json]"}))
        sys.exit(1)

    result = analyze(args[0], args[1])
    print(json.dumps(result))
    sys.exit(0 if result.get("success") else 1)
