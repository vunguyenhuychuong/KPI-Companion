from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from . import models
from .database import Base, SessionLocal, engine
from .routers import chat, kpis, reports, sources, work_items


def seed_demo_data():
    """Tao user mac dinh + bo KPI mau (chi khi DB trong) de demo nhanh."""
    db = SessionLocal()
    try:
        if not db.get(models.User, 1):
            db.add(models.User(id=1, name="Người dùng demo"))
            db.commit()
        if db.scalars(select(models.KPI).limit(1)).first():
            return
        samples = [
            models.KPI(
                user_id=1, name="Hoàn thành báo cáo ITGC 4 quý đúng hạn",
                description="Lập và nộp báo cáo kiểm soát chung CNTT (ITGC) mỗi quý",
                target="4/4 báo cáo quý được duyệt đúng hạn", weight=30,
                year=2026, deadline=date(2026, 12, 31), progress=40,
            ),
            models.KPI(
                user_id=1, name="Tỷ lệ xử lý ticket trong SLA ≥ 95%",
                description="Xử lý ticket vận hành (workflow, phân quyền, sự cố) trong SLA",
                target="≥95% ticket đóng trong SLA, đo theo tháng", weight=25,
                year=2026, deadline=date(2026, 12, 31), progress=45,
            ),
            models.KPI(
                user_id=1, name="Hoàn thành hồ sơ audit nội bộ 2026",
                description="Chuẩn bị đầy đủ bằng chứng kiểm soát phục vụ 2 đợt audit nội bộ",
                target="2 đợt audit không có finding nghiêm trọng về hồ sơ", weight=20,
                year=2026, deadline=date(2026, 10, 31), progress=15,
            ),
            models.KPI(
                user_id=1, name="Tự động hóa 2 báo cáo tuân thủ định kỳ",
                description="Xây dựng script/tool tự động sinh báo cáo tuân thủ hàng tháng",
                target="2 báo cáo chạy tự động, giảm ≥50% thời gian thủ công", weight=15,
                year=2026, deadline=date(2026, 9, 30), progress=10,
            ),
            models.KPI(
                user_id=1, name="Hoàn thành 100% khóa đào tạo bắt buộc",
                description="Các khóa an toàn thông tin và tuân thủ theo quy định công ty",
                target="100% khóa học hoàn thành trước hạn từng quý", weight=10,
                year=2026, deadline=date(2026, 12, 31), progress=50,
            ),
        ]
        db.add_all(samples)
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed_demo_data()
    yield


app = FastAPI(title="KPI Companion API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(kpis.router)
app.include_router(chat.router)
app.include_router(work_items.router)
app.include_router(sources.router)
app.include_router(reports.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
