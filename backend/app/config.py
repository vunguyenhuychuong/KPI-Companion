from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # LLM — Qwen qua endpoint OpenAI-compatible
    llm_base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    llm_api_key: str = "vn-8VHFt_8Og6s-j8GyfKTG88axZG_Uv978d89acf2ac9478194be8bc2586bea17Qxwo4UM_54UYD8JnITQc2NIVZC_L-4u"
    llm_model: str = "qwen3.5-plus"
    llm_temperature: float = 0.2
    # Tat thinking mode cua Qwen3 (giam latency ~24 lan). Dat false neu endpoint bao loi tham so la.
    llm_disable_thinking: bool = True
    # Tu tao bo KPI mau khi DB trong (tat sau khi da nhap du lieu that)
    seed_demo_data: bool = True

    database_url: str = f"sqlite:///{BASE_DIR / 'kpi_companion.db'}"

    @field_validator("database_url")
    @classmethod
    def _resolve_sqlite_path(cls, v: str) -> str:
        """SQLite path tuong doi -> tuyet doi theo BASE_DIR (thu muc backend).

        Dam bao chay tu BAT KY thu muc nao (agentbase, may khac, IDE) deu tro
        ve cung 1 file DB, khong phu thuoc current working directory.
        """
        prefix = "sqlite:///"
        if v.startswith(prefix):
            raw = v[len(prefix):]
            p = Path(raw)
            if not p.is_absolute():
                p = (BASE_DIR / raw).resolve()
            return f"{prefix}{p.as_posix()}"
        return v

    # JWT Auth — đặt JWT_SECRET_KEY dài, ngẫu nhiên trong .env khi deploy thật
    jwt_secret_key: str = "change-me-in-production-with-a-long-random-string"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 30

    # CORS: danh sách origin phân cách bởi dấu phẩy, hoặc "*" để cho tất cả
    cors_origins: str = "*"

    # Google OAuth2 — lấy từ Google Cloud Console > Credentials > OAuth 2.0 Client IDs
    # Để trống thì không hiển thị nút "Đăng nhập bằng Google"
    google_client_id: str = ""

    # Google: mock mode khi chua co OAuth credentials
    google_mock_mode: bool = True
    google_credentials_file: str = "credentials.json"
    google_token_file: str = "token.json"

    # OAuth ket noi nguon du lieu (Gmail/Calendar/Sheets...) tu giao dien.
    # oauth_redirect_base: goc URL CONG KHAI cua BACKEND, vd "http://localhost:8000"
    #   -> redirect_uri = {base}/api/oauth/{provider}/callback (phai khai bao trong Google Console).
    #   De trong: tu suy ra tu request (chi dung duoc khi backend truy cap truc tiep).
    oauth_redirect_base: str = ""
    # frontend_url: noi tra trinh duyet ve sau khi ket noi xong, vd "http://localhost:5173/sources".
    #   De trong: ve "/sources".
    frontend_url: str = ""

    # Ma hoa token OAuth luu trong DB (Fernet). De trong -> tu suy ra tu jwt_secret_key
    # (chay duoc ngay). Khi deploy that nen dat key rieng:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    token_encryption_key: str = ""

    # Phase 3 (tuy chon) — dien client id/secret khi mo rong sang cac nguon khac.
    notion_client_id: str = ""
    notion_client_secret: str = ""
    slack_client_id: str = ""
    slack_client_secret: str = ""
    outlook_client_id: str = ""
    outlook_client_secret: str = ""

    # Vision Help Panel — OpenAI-compatible vision endpoint.
    # De trong vision_api_key -> UI van hien huong dan fallback, khong goi AI.
    vision_base_url: str = ""
    vision_api_key: str = ""
    vision_model: str = ""

    # Email (SMTP) — dùng để gửi email thật qua Gmail
    # App Password: lấy từ https://myaccount.google.com/apppasswords
    smtp_email: str = ""
    smtp_password: str = ""
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587

    @property
    def google_credentials_path(self) -> Path:
        return BASE_DIR / self.google_credentials_file

    @property
    def google_token_path(self) -> Path:
        return BASE_DIR / self.google_token_file

    @property
    def mock_data_dir(self) -> Path:
        return BASE_DIR / "mock_data"

    @property
    def uploads_dir(self) -> Path:
        path = BASE_DIR / "uploads"
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
