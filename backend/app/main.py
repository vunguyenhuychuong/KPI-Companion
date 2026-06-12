from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from . import models
from .database import Base, SessionLocal, engine
from .routers import chat, kpis, objectives, reports, sources, work_items


def migrate():
    """Mini-migration cho SQLite: them cot moi vao bang cu ma khong mat du lieu."""
    with engine.connect() as conn:
        kpi_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(kpis)"))]
        obj_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(objectives)"))]
        if kpi_cols and "objective_id" not in kpi_cols:
            conn.execute(text("ALTER TABLE kpis ADD COLUMN objective_id INTEGER"))

        # He don vi do: unit / target_value / current_value (giu nguyen % cu)
        if kpi_cols and "unit" not in kpi_cols:
            conn.execute(text("ALTER TABLE kpis ADD COLUMN unit VARCHAR(50) DEFAULT '%'"))
            conn.execute(text("ALTER TABLE kpis ADD COLUMN target_value FLOAT DEFAULT 100"))
            conn.execute(text("ALTER TABLE kpis ADD COLUMN current_value FLOAT DEFAULT 0"))
            if "progress" in kpi_cols:  # KPI cu: thuc dat = % tien do cu (target=100)
                conn.execute(text("UPDATE kpis SET current_value = progress"))

        # Phien chat: tin nhan cu (truoc khi co chat_sessions) gom vao 1 phien "Lich su truoc day"
        msg_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(chat_messages)"))]
        if msg_cols and "session_id" not in msg_cols:
            conn.execute(text("ALTER TABLE chat_messages ADD COLUMN session_id INTEGER"))
            has_old = conn.execute(text("SELECT COUNT(*) FROM chat_messages")).scalar()
            if has_old:
                conn.execute(
                    text(
                        "INSERT INTO chat_sessions (user_id, title, created_at) "
                        "VALUES (1, 'Lịch sử trước đây', CURRENT_TIMESTAMP)"
                    )
                )
                sid = conn.execute(text("SELECT MAX(id) FROM chat_sessions")).scalar()
                conn.execute(text("UPDATE chat_messages SET session_id = :sid"), {"sid": sid})

        # Bao cao ky: them khoa chuan period_key de tao lai bao cao cung ky
        rep_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(saved_reports)"))]
        if rep_cols and "period_key" not in rep_cols:
            conn.execute(text("ALTER TABLE saved_reports ADD COLUMN period_key VARCHAR(20) DEFAULT ''"))

        # Trong so 2 tang: objective.weight = tong trong so KPI con cu,
        # trong so KPI quy ve ty le % TRONG objective -> diem tong khong doi.
        if obj_cols and "weight" not in obj_cols:
            conn.execute(text("ALTER TABLE objectives ADD COLUMN weight FLOAT DEFAULT 0"))
            groups = conn.execute(
                text(
                    "SELECT objective_id, SUM(weight) FROM kpis "
                    "WHERE archived = 0 GROUP BY objective_id"
                )
            ).all()
            for obj_id, total in groups:
                total = total or 0
                if obj_id is not None:
                    conn.execute(
                        text("UPDATE objectives SET weight = :w WHERE id = :id"),
                        {"w": total, "id": obj_id},
                    )
                if total > 0:
                    cond = "objective_id = :oid" if obj_id is not None else "objective_id IS NULL"
                    conn.execute(
                        text(
                            f"UPDATE kpis SET weight = ROUND(weight * 100.0 / :total, 1) "
                            f"WHERE archived = 0 AND {cond}"
                        ),
                        {"total": total, **({"oid": obj_id} if obj_id is not None else {})},
                    )
        conn.commit()


def seed_objectives():
    """Tao 3 muc tieu mau va gan cac KPI seed vao (chi chay khi chua co objective nao)."""
    db = SessionLocal()
    try:
        if db.scalars(select(models.Objective).limit(1)).first():
            return
        mapping = {
            ("Vận hành CNTT ổn định và tuân thủ", 75): [
                "Hoàn thành báo cáo ITGC", "Tỷ lệ xử lý ticket", "hồ sơ audit",
            ],
            ("Nâng cao hiệu suất qua tự động hóa", 15): ["Tự động hóa"],
            ("Phát triển năng lực cá nhân", 10): ["khóa đào tạo"],
        }
        kpis = list(db.scalars(select(models.KPI).where(models.KPI.archived == False)))  # noqa: E712
        for (obj_name, obj_weight), keywords in mapping.items():
            obj = models.Objective(user_id=1, name=obj_name, weight=obj_weight, year=2026)
            db.add(obj)
            db.flush()
            for k in kpis:
                if k.objective_id is None and any(kw.lower() in k.name.lower() for kw in keywords):
                    k.objective_id = obj.id
        db.commit()
    finally:
        db.close()


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
                target="4/4 báo cáo quý được duyệt đúng hạn", weight=40,
                unit="báo cáo", target_value=4, current_value=2,
                year=2026, deadline=date(2026, 12, 31),
            ),
            models.KPI(
                user_id=1, name="Tỷ lệ xử lý ticket trong SLA ≥ 95%",
                description="Xử lý ticket vận hành (workflow, phân quyền, sự cố) trong SLA",
                target="≥95% ticket đóng trong SLA, đo theo tháng", weight=35,
                unit="%", target_value=100, current_value=45,
                year=2026, deadline=date(2026, 12, 31),
            ),
            models.KPI(
                user_id=1, name="Hoàn thành hồ sơ audit nội bộ 2026",
                description="Chuẩn bị đầy đủ bằng chứng kiểm soát phục vụ 2 đợt audit nội bộ",
                target="2 đợt audit không có finding nghiêm trọng về hồ sơ", weight=25,
                unit="đợt audit", target_value=2, current_value=0,
                year=2026, deadline=date(2026, 10, 31),
            ),
            models.KPI(
                user_id=1, name="Tự động hóa 2 báo cáo tuân thủ định kỳ",
                description="Xây dựng script/tool tự động sinh báo cáo tuân thủ hàng tháng",
                target="2 báo cáo chạy tự động, giảm ≥50% thời gian thủ công", weight=100,
                unit="báo cáo", target_value=2, current_value=0,
                year=2026, deadline=date(2026, 9, 30),
            ),
            models.KPI(
                user_id=1, name="Hoàn thành 3 khóa đào tạo bắt buộc",
                description="Các khóa an toàn thông tin và tuân thủ theo quy định công ty",
                target="3/3 khóa học hoàn thành trước hạn", weight=100,
                unit="khóa học", target_value=3, current_value=1,
                year=2026, deadline=date(2026, 12, 31),
            ),
        ]
        db.add_all(samples)
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate()
    seed_demo_data()
    seed_objectives()
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
app.include_router(objectives.router)
app.include_router(chat.router)
app.include_router(work_items.router)
app.include_router(sources.router)
app.include_router(reports.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
