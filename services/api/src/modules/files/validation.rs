use crate::error::ApiError;

const PDF_MIME: &str = "application/pdf";
const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/// Bytes needed to recognize any supported file signature.
pub const SIGNATURE_LENGTH: u32 = 5;
const ARTIFACT_MAX_BYTES: usize = 20 * 1024 * 1024;

pub(crate) fn artifact_max_bytes(upload_max_bytes: i64) -> usize {
    usize::try_from(upload_max_bytes)
        .unwrap_or(ARTIFACT_MAX_BYTES)
        .min(ARTIFACT_MAX_BYTES)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Pdf,
    Docx,
}

impl FileKind {
    pub fn from_mime(mime_type: &str) -> Option<Self> {
        match mime_type {
            PDF_MIME => Some(Self::Pdf),
            DOCX_MIME => Some(Self::Docx),
            _ => None,
        }
    }

    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Pdf => PDF_MIME,
            Self::Docx => DOCX_MIME,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Docx => "docx",
        }
    }

    /// DOCX is a ZIP archive. The extractor checks the inner structure.
    pub fn matches_signature(self, prefix: &[u8]) -> bool {
        match self {
            Self::Pdf => prefix.starts_with(b"%PDF-"),
            Self::Docx => prefix.starts_with(b"PK\x03\x04"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedUpload {
    pub kind: FileKind,
    pub file_name: String,
}

pub fn validate_upload(
    file_name: &str,
    mime_type: &str,
    size_bytes: i64,
    max_bytes: i64,
) -> Result<ValidatedUpload, ApiError> {
    let kind = FileKind::from_mime(mime_type).ok_or(ApiError::UnsupportedFileType)?;

    // Browsers may send a full path. Only the last segment is a name.
    let base_name = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim();
    if base_name.is_empty() || base_name.chars().any(char::is_control) {
        return Err(ApiError::Validation(
            "Invalid value for: file_name".to_owned(),
        ));
    }
    let extension = base_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    if extension.as_deref() != Some(kind.extension()) {
        return Err(ApiError::UnsupportedFileType);
    }

    if size_bytes <= 0 {
        return Err(ApiError::Validation(
            "Invalid value for: size_bytes".to_owned(),
        ));
    }
    if size_bytes > max_bytes {
        return Err(ApiError::FileTooLarge);
    }

    Ok(ValidatedUpload {
        kind,
        file_name: base_name.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAX: i64 = 1000;

    #[test]
    fn accepts_pdf_and_docx_with_matching_extension() {
        let pdf = validate_upload("Contrato.PDF", PDF_MIME, 10, MAX).expect("pdf");
        assert_eq!(pdf.kind, FileKind::Pdf);
        assert_eq!(pdf.file_name, "Contrato.PDF");
        let docx = validate_upload("contrato.docx", DOCX_MIME, 10, MAX).expect("docx");
        assert_eq!(docx.kind, FileKind::Docx);
    }

    #[test]
    fn rejects_other_types_and_mismatched_extensions() {
        for (name, mime) in [
            ("contrato.doc", "application/msword"),
            ("contrato.exe", PDF_MIME),
            ("contrato.docx", PDF_MIME),
            ("contrato.pdf", DOCX_MIME),
            ("contrato", PDF_MIME),
        ] {
            assert!(
                matches!(
                    validate_upload(name, mime, 10, MAX),
                    Err(ApiError::UnsupportedFileType)
                ),
                "{name} with {mime}"
            );
        }
    }

    #[test]
    fn enforces_size_limits() {
        assert!(validate_upload("a.pdf", PDF_MIME, MAX, MAX).is_ok());
        assert!(matches!(
            validate_upload("a.pdf", PDF_MIME, MAX + 1, MAX),
            Err(ApiError::FileTooLarge)
        ));
        assert!(matches!(
            validate_upload("a.pdf", PDF_MIME, 0, MAX),
            Err(ApiError::Validation(_))
        ));
    }

    #[test]
    fn strips_paths_and_rejects_control_characters() {
        let file = validate_upload("../../etc/contrato.pdf", PDF_MIME, 10, MAX).expect("name");
        assert_eq!(file.file_name, "contrato.pdf");
        let windows = validate_upload(r"C:\tmp\contrato.pdf", PDF_MIME, 10, MAX).expect("name");
        assert_eq!(windows.file_name, "contrato.pdf");
        assert!(matches!(
            validate_upload("con\ntrato.pdf", PDF_MIME, 10, MAX),
            Err(ApiError::Validation(_))
        ));
    }

    #[test]
    fn recognizes_file_signatures() {
        assert!(FileKind::Pdf.matches_signature(b"%PDF-1.7"));
        assert!(!FileKind::Pdf.matches_signature(b"PK\x03\x04"));
        assert!(FileKind::Docx.matches_signature(b"PK\x03\x04\x14"));
        assert!(!FileKind::Docx.matches_signature(b"%PDF-"));
    }
}
