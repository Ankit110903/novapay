import time
import os
import sys
from utils.supabase_client import get_db_connection

# Missing measurements remain unknown; never fabricate telemetry.
try:
    import psutil
except ImportError:
    psutil = None

def check_db_health():
    """Pings the Supabase database to measure connection availability and latency."""
    start_time = time.time()
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        latency = (time.time() - start_time) * 1000  # in ms
        return {"status": "connected", "latency_ms": round(latency, 2)}
    except Exception as e:
        return {"status": "disconnected", "error": str(e), "latency_ms": -1}
    finally:
        if conn:
            conn.close()

def get_system_telemetry():
    """Retrieves system resource statistics (CPU, Memory, Sessions)."""
    if psutil:
        try:
            cpu = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory().percent
        except Exception:
            cpu = None
            mem = None
    else:
        cpu = None
        mem = None
        
    return {
        "cpu_usage": cpu,
        "memory_usage": mem,
        "active_sessions": None  # Signed cookies do not provide a global session count.
    }
