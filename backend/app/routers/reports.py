from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..agent import agent as kpi_agent
from ..database import get_db
from ..services import kpi_service, report_service

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    return kpi_service.build_dashboard(db)


@router.get("/weekly")
def weekly(db: Session = Depends(get_db)):
    """Ban tong ket tuan do Agent viet (LLM)."""
    return {"report": kpi_agent.weekly_report(db)}


@router.get("/export")
def export_excel(db: Session = Depends(get_db)):
    data = report_service.export_evaluation_excel(db)
    filename = f"bao-cao-kpi-{datetime.now(timezone.utc).date().isoformat()}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
