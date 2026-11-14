from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ErrorDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(
        ...,
        description="Deterministic machine-readable error code.",
        examples=["UNSUPPORTED_DOCUMENT_FORMAT"],
    )
    message: str = Field(
        ...,
        description="Safe human-readable error message without internal stack traces.",
        examples=["Only PDF and DOCX files are supported."],
    )


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorDetail
