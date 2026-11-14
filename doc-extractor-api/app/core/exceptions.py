from __future__ import annotations

from http import HTTPStatus


class AppError(Exception):
    """Base structured exception mapped to deterministic HTTP error responses."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = HTTPStatus.BAD_REQUEST,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = int(status_code)


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Invalid or missing internal API key.") -> None:
        super().__init__(
            code="UNAUTHORIZED",
            message=message,
            status_code=HTTPStatus.UNAUTHORIZED,
        )


class ForbiddenDownloadUrlError(AppError):
    def __init__(self, message: str = "The download URL is not permitted.") -> None:
        super().__init__(
            code="FORBIDDEN_DOWNLOAD_URL",
            message=message,
            status_code=HTTPStatus.BAD_REQUEST,
        )


class DocumentNotFoundError(AppError):
    def __init__(self, message: str = "The source document was not found in storage.") -> None:
        super().__init__(
            code="DOCUMENT_NOT_FOUND",
            message=message,
            status_code=HTTPStatus.NOT_FOUND,
        )


class PresignedUrlExpiredError(AppError):
    def __init__(self, message: str = "The presigned download URL has expired.") -> None:
        super().__init__(
            code="PRESIGNED_URL_EXPIRED",
            message=message,
            status_code=HTTPStatus.GONE,
        )


class StorageAccessDeniedError(AppError):
    def __init__(self, message: str = "Access to the source document in storage was denied.") -> None:
        super().__init__(
            code="STORAGE_ACCESS_DENIED",
            message=message,
            status_code=HTTPStatus.FORBIDDEN,
        )


class DownloadTimeoutError(AppError):
    def __init__(self, message: str = "Downloading the source document timed out.") -> None:
        super().__init__(
            code="DOWNLOAD_TIMEOUT",
            message=message,
            status_code=HTTPStatus.GATEWAY_TIMEOUT,
        )


class DownloadFailedError(AppError):
    def __init__(self, message: str = "Failed to download the source document from storage.") -> None:
        super().__init__(
            code="DOWNLOAD_FAILED",
            message=message,
            status_code=HTTPStatus.BAD_GATEWAY,
        )


class UnsupportedDocumentFormatError(AppError):
    def __init__(self, message: str = "Only PDF and DOCX files are supported.") -> None:
        super().__init__(
            code="UNSUPPORTED_DOCUMENT_FORMAT",
            message=message,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )


class EmptyDocumentError(AppError):
    def __init__(self, message: str = "The downloaded document is empty.") -> None:
        super().__init__(
            code="EMPTY_DOCUMENT",
            message=message,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )


class DocumentTooLargeError(AppError):
    def __init__(self, max_size_mb: int) -> None:
        super().__init__(
            code="DOCUMENT_TOO_LARGE",
            message=f"The document exceeds the maximum allowed size of {max_size_mb} MB.",
            status_code=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
        )


class PasswordProtectedDocumentError(AppError):
    def __init__(
        self,
        message: str = "Password-protected or encrypted documents cannot be processed.",
    ) -> None:
        super().__init__(
            code="PASSWORD_PROTECTED_DOCUMENT",
            message=message,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )


class CorruptDocumentError(AppError):
    def __init__(self, message: str = "The document is corrupt or unreadable.") -> None:
        super().__init__(
            code="CORRUPT_DOCUMENT",
            message=message,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )


class EmptyExtractionError(AppError):
    def __init__(
        self,
        message: str = "No readable content could be extracted from the document.",
    ) -> None:
        super().__init__(
            code="EMPTY_EXTRACTION",
            message=message,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )


class ExtractionTimeoutError(AppError):
    def __init__(self, message: str = "Document conversion timed out.") -> None:
        super().__init__(
            code="EXTRACTION_TIMEOUT",
            message=message,
            status_code=HTTPStatus.GATEWAY_TIMEOUT,
        )


class ConcurrencyLimitError(AppError):
    def __init__(
        self,
        message: str = "The extractor is at maximum capacity. Please retry shortly.",
    ) -> None:
        super().__init__(
            code="TOO_MANY_CONCURRENT_EXTRACTIONS",
            message=message,
            status_code=HTTPStatus.TOO_MANY_REQUESTS,
        )


class ConversionFailedError(AppError):
    def __init__(self, message: str = "Docling failed to convert the document.") -> None:
        super().__init__(
            code="CONVERSION_FAILED",
            message=message,
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
        )
