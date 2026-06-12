from pathlib import Path

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

    database_url: str = f"sqlite:///{BASE_DIR / 'kpi_companion.db'}"

    # Google: mock mode khi chua co OAuth credentials
    google_mock_mode: bool = True
    google_credentials_file: str = "credentials.json"
    google_token_file: str = "token.json"

    @property
    def google_credentials_path(self) -> Path:
        return BASE_DIR / self.google_credentials_file

    @property
    def google_token_path(self) -> Path:
        return BASE_DIR / self.google_token_file

    @property
    def mock_data_dir(self) -> Path:
        return BASE_DIR / "mock_data"


settings = Settings()
