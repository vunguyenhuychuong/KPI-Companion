from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import CurrentUser
from ..database import get_db
from ..services import brain_layer

router = APIRouter(prefix="/api/agent/brain", tags=["brain-layer"])


@router.get("/status", response_model=schemas.AgentBrainStatusOut)
def status(current_user: CurrentUser, db: Session = Depends(get_db)):
    return brain_layer.brain_status(db, current_user.id)


@router.get("/settings", response_model=schemas.AgentUserSettingsOut)
def get_settings(current_user: CurrentUser, db: Session = Depends(get_db)):
    return brain_layer.get_or_create_settings(db, current_user.id)


@router.put("/settings", response_model=schemas.AgentUserSettingsOut)
def update_settings(
    payload: schemas.AgentUserSettingsUpdate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    return brain_layer.update_settings(db, current_user.id, payload)


@router.post("/feedback", response_model=schemas.AgentFeedbackEventOut)
def record_feedback(
    payload: schemas.AgentFeedbackEventCreate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    return brain_layer.record_feedback(db, current_user.id, payload)


@router.get("/insights", response_model=list[schemas.AgentInsightSnapshotOut])
def insights(current_user: CurrentUser, db: Session = Depends(get_db)):
    return brain_layer.recent_insights(db, current_user.id)


@router.post("/retention/cleanup")
def cleanup_history(current_user: CurrentUser, db: Session = Depends(get_db)):
    deleted = brain_layer.cleanup_conversation_history(db, current_user.id)
    return {"ok": True, "deleted": deleted}
