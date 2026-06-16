from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import func, select, text

from . import models
from .auth import hash_password
from .config import settings
from .database import Base, SessionLocal, engine
from .rate_limit import limiter
from .routers import auth as auth_router
from .routers import autonomous_agent as autonomous_agent_router
from .routers import burnout, chat, cycles, help, kpis, notification_settings, notifications, objectives, oauth, reports, settings as settings_router
from .routers import calendar as calendar_router
from .routers import share_links, sources, work_items
from .services import autonomous_agent as autonomous_agent_service


def migrate():
    """Mini-migration cho SQLite: them cot moi vao bang cu ma khong mat du lieu."""
    with engine.connect() as conn:
        kpi_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(kpis)"))]
        obj_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(objectives)"))]
        user_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)"))]
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS agent_cycle_logs (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                cycle_key VARCHAR(80),
                phase VARCHAR(30) DEFAULT 'complete',
                status VARCHAR(20) DEFAULT 'ok',
                event_fingerprint VARCHAR(160) DEFAULT '',
                summary TEXT DEFAULT '',
                meta JSON,
                created_at DATETIME,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_agent_cycle_logs_user_id ON agent_cycle_logs(user_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_agent_cycle_logs_cycle_key ON agent_cycle_logs(cycle_key)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_agent_cycle_logs_event_fingerprint ON agent_cycle_logs(event_fingerprint)"))

        # KPI Cycles: tao default cycles cho objectives chua duoc gan cycle_id
        # (chay cho ca DB moi lan DB cu, su dung obj_cols de phat hien DB cu chua co cycle_id)
        if obj_cols and "cycle_id" not in obj_cols:
            # DB cu: them cot cycle_id roi tao default cycles
            conn.execute(text("ALTER TABLE objectives ADD COLUMN cycle_id INTEGER REFERENCES kpi_cycles(id)"))
            obj_cols = obj_cols + ["cycle_id"]  # cap nhat local list
        # Tao default cycles cho objectives chua co cycle_id (co the la DB moi hoac DB cu vua them cot)
        orphan_years = conn.execute(text(
            "SELECT DISTINCT user_id, year FROM objectives WHERE archived = 0 AND cycle_id IS NULL ORDER BY year"
        )).all()
        for user_id, year in orphan_years:
            y = year or 2026
            # Kiem tra da co cycle "Nam y" chua
            existing = conn.execute(text(
                "SELECT id FROM kpi_cycles WHERE user_id = :uid AND name = :name"
            ), {"uid": user_id, "name": f"Năm {y}"}).scalar()
            if existing:
                cycle_id = existing
            else:
                conn.execute(text(
                    "INSERT INTO kpi_cycles (user_id, name, cycle_type, start_date, end_date, is_active, is_locked, lock_reason, created_at) "
                    "VALUES (:uid, :name, 'yearly', :sd, :ed, 1, 0, '', CURRENT_TIMESTAMP)"
                ), {"uid": user_id, "name": f"Năm {y}", "sd": f"{y}-01-01", "ed": f"{y}-12-31"})
                cycle_id = conn.execute(text("SELECT MAX(id) FROM kpi_cycles")).scalar()
            conn.execute(text(
                "UPDATE objectives SET cycle_id = :cid WHERE user_id = :uid AND year = :year AND archived = 0 AND cycle_id IS NULL"
            ), {"cid": cycle_id, "uid": user_id, "year": y})
        conn.commit()

        if kpi_cols and "objective_id" not in kpi_cols:
            conn.execute(text("ALTER TABLE kpis ADD COLUMN objective_id INTEGER"))

        # Phan vung Work/Personal: KPI cu mac dinh "Work"
        if kpi_cols and "category" not in kpi_cols:
            conn.execute(text("ALTER TABLE kpis ADD COLUMN category VARCHAR(20) DEFAULT 'Work'"))

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

        # Explainable task mapping: luu ly do/ung vien KPI de Agent hoc tu lan confirm sau
        work_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(work_items)"))]
        if work_cols and "mapping_reason" not in work_cols:
            conn.execute(text("ALTER TABLE work_items ADD COLUMN mapping_reason TEXT DEFAULT ''"))
        if work_cols and "confidence" not in work_cols:
            conn.execute(text("ALTER TABLE work_items ADD COLUMN confidence FLOAT"))
        if work_cols and "alternative_kpis" not in work_cols:
            conn.execute(text("ALTER TABLE work_items ADD COLUMN alternative_kpis JSON"))

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

        # Multi-user: them email va hashed_password vao bang users
        if user_cols and "email" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(254)"))
            conn.execute(text("ALTER TABLE users ADD COLUMN hashed_password VARCHAR(200)"))

        # Google OAuth: them picture
        if user_cols and "picture" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN picture VARCHAR(500) DEFAULT ''"))

        # D1 Onboarding: them cac cot moi vao users
        if user_cols and "onboarding_completed" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN DEFAULT 0"))
            conn.execute(text("ALTER TABLE users ADD COLUMN onboarding_skipped_at DATETIME"))
            conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(100) DEFAULT ''"))
            # User cu: da dung qua -> danh dau hoan thanh onboarding
            conn.execute(text("UPDATE users SET onboarding_completed = 1"))

        # D3 Cycle Lock: them cac cot metadata
        cycle_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(kpi_cycles)"))]
        if cycle_cols and "locked_at" not in cycle_cols:
            conn.execute(text("ALTER TABLE kpi_cycles ADD COLUMN locked_at DATETIME"))
            conn.execute(text("ALTER TABLE kpi_cycles ADD COLUMN locked_by INTEGER"))
            conn.execute(text("ALTER TABLE kpi_cycles ADD COLUMN lock_reason VARCHAR(500) DEFAULT ''"))
            conn.execute(text("ALTER TABLE kpi_cycles ADD COLUMN cloned_from_cycle_id INTEGER"))

        conn.commit()


def cleanup_draft_data():
    """Remove old draft/proposal payloads; only confirmed user tasks remain persisted."""
    draft_meta_keys = {
        "proposed_items",
        "proposed_objectives",
        "proposed_kpis",
        "weight_changes",
        "delete_proposal",
    }
    db = SessionLocal()
    try:
        draft_items = list(
            db.scalars(
                select(models.WorkItem).where(models.WorkItem.confirmed == False)  # noqa: E712
            )
        )
        for item in draft_items:
            db.delete(item)

        messages = list(
            db.scalars(
                select(models.ChatMessage).where(models.ChatMessage.meta.isnot(None))
            )
        )
        for msg in messages:
            meta = msg.meta or {}
            if meta.get("intent") == "autonomous_agent":
                continue
            if not any(key in meta for key in draft_meta_keys):
                continue
            cleaned = {k: v for k, v in meta.items() if k not in draft_meta_keys}
            if cleaned.get("proposal_status") == "pending":
                cleaned["proposal_status"] = "dismissed"
            msg.meta = cleaned or None

        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def seed_objectives():
    """Tao 3 muc tieu mau va gan cac KPI seed vao (chi chay khi chua co objective nao)."""
    if not settings.seed_demo_data:
        return  # SEED_DEMO_DATA=false -> giu DB sach de nhap du lieu that
    db = SessionLocal()
    try:
        if db.scalars(select(models.Objective).limit(1)).first():
            return
        # Dam bao co default cycle 2026
        cycle = db.scalars(
            select(models.KPICycle).where(models.KPICycle.user_id == 1)
        ).first()
        if not cycle:
            cycle = models.KPICycle(
                user_id=1, name="Năm 2026", cycle_type="yearly",
                start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            )
            db.add(cycle)
            db.flush()
        mapping = {
            ("Vận hành CNTT ổn định và tuân thủ", 75): [
                "Hoàn thành báo cáo ITGC", "Tỷ lệ xử lý ticket", "hồ sơ audit",
            ],
            ("Nâng cao hiệu suất qua tự động hóa", 15): ["Tự động hóa"],
            ("Phát triển năng lực cá nhân", 10): ["khóa đào tạo"],
        }
        kpis = list(db.scalars(select(models.KPI).where(models.KPI.archived == False)))  # noqa: E712
        for (obj_name, obj_weight), keywords in mapping.items():
            obj = models.Objective(
                user_id=1, name=obj_name, weight=obj_weight, year=2026, cycle_id=cycle.id
            )
            db.add(obj)
            db.flush()
            for k in kpis:
                if k.objective_id is None and any(kw.lower() in k.name.lower() for kw in keywords):
                    k.objective_id = obj.id
        db.commit()
    finally:
        db.close()


DEMO_EMAIL = "demo@demo.com"
DEMO_PASSWORD = "demo1234"


def seed_demo_data():
    """Tao user mac dinh + bo KPI mau (chi khi DB trong) de demo nhanh.

    Tai khoan demo: demo@demo.com / demo1234
    (Email co dau cham de qua duoc validate o frontend; chay tren moi may/deploy.)
    """
    db = SessionLocal()
    try:
        user = db.get(models.User, 1)
        if not user:
            db.add(models.User(
                id=1, name="Người dùng demo",
                email=DEMO_EMAIL,
                hashed_password=hash_password(DEMO_PASSWORD),
            ))
            db.commit()
        else:
            # Tu va DB cu: tai khoan demo legacy (demo@local / chua co email) ->
            # chuyen sang email hop le + mat khau chuan de login duoc qua frontend.
            changed = False
            if user.email in (None, "", "demo@local"):
                user.email = DEMO_EMAIL
                user.hashed_password = hash_password(DEMO_PASSWORD)
                changed = True
            elif user.hashed_password is None:
                user.hashed_password = hash_password(DEMO_PASSWORD)
                changed = True
            if changed:
                db.commit()

        if not settings.seed_demo_data:
            return  # SEED_DEMO_DATA=false -> khong tao KPI mau, chi dam bao tai khoan demo
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


def seed_compare_demo():
    """Tao du lieu demo so sanh 2 chu ky 2025 vs 2026 voi tien do co thuc.

    - Sua loi chinh ta 'Nam 20XX' -> 'Năm 20XX' trong tat ca cycles.
    - Idempotent: bo qua neu cycle 'Năm 2025' da ton tai.
    """
    if not settings.seed_demo_data:
        return
    db = SessionLocal()
    try:
        # 1. Fix typo 'Nam ' -> 'Năm ' trong ten tat ca cycles
        bad = db.scalars(
            select(models.KPICycle).where(
                models.KPICycle.user_id == 1,
                models.KPICycle.name.like("Nam %"),
            )
        ).all()
        for c in bad:
            c.name = "Năm" + c.name[3:]
        if bad:
            db.commit()

        # 2. Kiem tra xem cycle 2025 da co chua
        cycle_2025 = db.scalars(
            select(models.KPICycle).where(
                models.KPICycle.user_id == 1,
                models.KPICycle.name == "Năm 2025",
            )
        ).first()
        if cycle_2025:
            return  # da co du lieu demo

        # 3. Tao cycle Năm 2025 (da ket thuc, tien do cao)
        cycle_2025 = models.KPICycle(
            user_id=1, name="Năm 2025", cycle_type="yearly",
            start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
            is_active=False, is_locked=True,
        )
        db.add(cycle_2025)
        db.flush()

        OBJECTIVES_2025 = [
            ("Vận hành CNTT ổn định và tuân thủ", 50, [
                ("Hoàn thành báo cáo ITGC 4 quý đúng hạn", 40, "báo cáo", 4, 4.0),
                ("Tỷ lệ xử lý ticket trong SLA ≥ 95%", 35, "%", 100, 97.0),
                ("Hoàn thành hồ sơ audit nội bộ 2025", 25, "đợt audit", 2, 2.0),
            ]),
            ("Nâng cao hiệu suất qua tự động hóa", 30, [
                ("Tự động hóa 2 báo cáo tuân thủ định kỳ", 60, "báo cáo", 2, 2.0),
                ("Triển khai dashboard KPI nội bộ", 40, "dashboard", 1, 1.0),
            ]),
            ("Phát triển năng lực cá nhân", 20, [
                ("Hoàn thành 3 khóa đào tạo bắt buộc", 50, "khóa học", 3, 3.0),
                ("Đạt chứng chỉ ISO 27001 Foundation", 50, "chứng chỉ", 1, 1.0),
            ]),
        ]

        for obj_name, obj_weight, kpi_list in OBJECTIVES_2025:
            obj = models.Objective(
                user_id=1, cycle_id=cycle_2025.id, name=obj_name,
                weight=obj_weight, year=2025,
            )
            db.add(obj)
            db.flush()
            for kpi_name, kpi_weight, unit, target, current in kpi_list:
                db.add(models.KPI(
                    user_id=1, objective_id=obj.id, name=kpi_name,
                    weight=kpi_weight, unit=unit,
                    target_value=float(target), current_value=float(current),
                    year=2025, deadline=date(2025, 12, 31),
                ))

        # 4. Dam bao cycle Năm 2026 ton tai voi objectives day du
        cycle_2026 = db.scalars(
            select(models.KPICycle).where(
                models.KPICycle.user_id == 1,
                models.KPICycle.name == "Năm 2026",
            )
        ).first()
        if not cycle_2026:
            cycle_2026 = models.KPICycle(
                user_id=1, name="Năm 2026", cycle_type="yearly",
                start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
                is_active=True, is_locked=False,
            )
            db.add(cycle_2026)
            db.flush()

        existing_objs_2026 = db.scalar(
            select(func.count(models.Objective.id)).where(
                models.Objective.cycle_id == cycle_2026.id,
                models.Objective.archived == False,  # noqa: E712
            )
        ) or 0
        if existing_objs_2026 == 0:
            OBJECTIVES_2026 = [
                ("Vận hành CNTT ổn định và tuân thủ", 50, [
                    ("Hoàn thành báo cáo ITGC 4 quý đúng hạn", 40, "báo cáo", 4, 2.0),
                    ("Tỷ lệ xử lý ticket trong SLA ≥ 95%", 35, "%", 100, 45.0),
                    ("Hoàn thành hồ sơ audit nội bộ 2026", 25, "đợt audit", 2, 0.0),
                ]),
                ("Nâng cao hiệu suất qua tự động hóa", 30, [
                    ("Tự động hóa 2 báo cáo tuân thủ định kỳ", 60, "báo cáo", 2, 0.0),
                    ("Triển khai dashboard KPI nội bộ", 40, "dashboard", 1, 0.0),
                ]),
                ("Phát triển năng lực cá nhân", 20, [
                    ("Hoàn thành 3 khóa đào tạo bắt buộc", 50, "khóa học", 3, 1.0),
                    ("Đạt chứng chỉ ISO 27001 Foundation", 50, "chứng chỉ", 1, 0.0),
                ]),
            ]
            for obj_name, obj_weight, kpi_list in OBJECTIVES_2026:
                obj = models.Objective(
                    user_id=1, cycle_id=cycle_2026.id, name=obj_name,
                    weight=obj_weight, year=2026,
                )
                db.add(obj)
                db.flush()
                for kpi_name, kpi_weight, unit, target, current in kpi_list:
                    db.add(models.KPI(
                        user_id=1, objective_id=obj.id, name=kpi_name,
                        weight=kpi_weight, unit=unit,
                        target_value=float(target), current_value=float(current),
                        year=2026, deadline=date(2026, 12, 31),
                    ))

        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate()
    cleanup_draft_data()
    # nap cau hinh app-level da luu (vd google_mock_mode doi tu UI) de giu sau restart
    from .services import app_config
    db = SessionLocal()
    try:
        app_config.load_overrides(db)
    finally:
        db.close()
    seed_demo_data()
    seed_objectives()
    seed_compare_demo()
    await autonomous_agent_service.runner.start()
    try:
        yield
    finally:
        await autonomous_agent_service.runner.stop()


_docs_url = "/docs" if settings.swagger_enabled else None
_redoc_url = "/redoc" if settings.swagger_enabled else None
_openapi_url = "/openapi.json" if settings.swagger_enabled else None
app = FastAPI(
    title="KPI Companion API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=_docs_url,
    redoc_url=_redoc_url,
    openapi_url=_openapi_url,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(cycles.router)
app.include_router(kpis.router)
app.include_router(objectives.router)
app.include_router(chat.router)
app.include_router(work_items.router)
app.include_router(sources.router)
app.include_router(reports.router)
app.include_router(settings_router.router)
app.include_router(oauth.router)
app.include_router(autonomous_agent_router.router)
app.include_router(notifications.router)
app.include_router(burnout.router)
app.include_router(notification_settings.router)
app.include_router(share_links.router)
app.include_router(help.router)
app.include_router(share_links.public_router)
app.include_router(calendar_router.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


import os  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402

_static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.isdir(_static_dir):
    _assets_dir = os.path.join(_static_dir, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path:
            safe = os.path.normpath(os.path.join(_static_dir, full_path))
            if safe.startswith(os.path.normpath(_static_dir)) and os.path.isfile(safe):
                return FileResponse(safe)
        return FileResponse(os.path.join(_static_dir, "index.html"))
