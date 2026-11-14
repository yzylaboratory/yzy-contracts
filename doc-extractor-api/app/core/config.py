from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Any, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

SUPPORTED_OCR_LANGUAGES = {"es", "en"}


def _parse_csv_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    raise ValueError("Expected a comma-separated string or list of strings.")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = Field(default="Doc Extractor API", min_length=1)
    app_env: Literal["development", "staging", "production", "test"] = "development"
    app_host: str = Field(default="0.0.0.0", min_length=1)
    app_port: int = Field(default=8000, ge=1, le=65535)

    internal_api_key: SecretStr = Field(default=SecretStr(""))

    max_file_size_mb: int = Field(default=25, ge=1, le=200)
    max_concurrent_extractions: int = Field(default=2, ge=1, le=32)
    download_connect_timeout_seconds: float = Field(default=10.0, gt=0.0, le=120.0)
    download_timeout_seconds: float = Field(default=60.0, gt=0.0, le=600.0)
    extraction_timeout_seconds: float = Field(default=300.0, gt=0.0, le=1800.0)

    ocr_enabled: bool = True
    ocr_languages: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["es", "en"])
    ocr_engine: Literal["auto", "rapidocr", "tesseract"] = "auto"

    r2_allowed_hosts: Annotated[list[str], NoDecode] = Field(default_factory=list)
    docling_artifacts_path: str | None = Field(default=None)

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    enable_api_docs: bool = True

    @field_validator("ocr_languages", mode="before")
    @classmethod
    def validate_ocr_languages(cls, value: Any) -> list[str]:
        langs = [lang.lower() for lang in _parse_csv_list(value)]
        if not langs:
            raise ValueError("OCR_LANGUAGES must include at least one language (e.g. 'es,en').")
        unsupported = [lang for lang in langs if lang not in SUPPORTED_OCR_LANGUAGES]
        if unsupported:
            raise ValueError(
                f"Unsupported OCR languages: {unsupported}. Supported languages are: {sorted(SUPPORTED_OCR_LANGUAGES)}."
            )
        deduped: list[str] = []
        for lang in langs:
            if lang not in deduped:
                deduped.append(lang)
        return deduped

    @field_validator("r2_allowed_hosts", mode="before")
    @classmethod
    def validate_r2_allowed_hosts(cls, value: Any) -> list[str]:
        hosts = [host.lower() for host in _parse_csv_list(value)]
        normalized: list[str] = []
        for host in hosts:
            if "://" in host or "/" in host or ":" in host or "*" in host:
                raise ValueError(
                    f"Invalid R2 host '{host}'. Specify exact hostnames without scheme, port, path, or wildcard."
                )
            if host not in normalized:
                normalized.append(host)
        return normalized

    @field_validator("log_level", mode="before")
    @classmethod
    def normalize_log_level(cls, value: Any) -> str:
        if isinstance(value, str):
            return value.strip().upper()
        return value

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
