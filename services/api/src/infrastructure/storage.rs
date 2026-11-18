use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use aws_sdk_s3::{
    Client,
    config::{Credentials, Region, RequestChecksumCalculation, ResponseChecksumValidation},
    error::ProvideErrorMetadata,
    presigning::PresigningConfig,
};

use crate::config::R2Config;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresignedRequest {
    pub url: String,
    /// Headers the client must send verbatim because they are part of the signature.
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectMetadata {
    pub size_bytes: i64,
    pub content_type: Option<String>,
    pub etag: String,
}

/// A trait because tests replace the network. R2 is the only production implementation.
#[async_trait]
pub trait ObjectStorage: Send + Sync {
    async fn presign_put(
        &self,
        key: &str,
        mime_type: &str,
        size_bytes: i64,
        ttl: Duration,
    ) -> anyhow::Result<PresignedRequest>;

    async fn presign_get(
        &self,
        key: &str,
        attachment_file_name: Option<&str>,
        ttl: Duration,
    ) -> anyhow::Result<String>;

    /// `None` means the object does not exist.
    async fn head(&self, key: &str) -> anyhow::Result<Option<ObjectMetadata>>;

    async fn read_prefix(&self, key: &str, length: u32) -> anyhow::Result<Vec<u8>>;

    /// Reads exactly the inspected object, bounded by its declared length.
    /// None means its ETag or length changed since inspection.
    async fn read_matching(
        &self,
        key: &str,
        metadata: &ObjectMetadata,
    ) -> anyhow::Result<Option<Vec<u8>>>;

    async fn delete(&self, key: &str) -> anyhow::Result<()>;
}

pub struct R2Storage {
    client: Client,
    signing_client: Client,
    bucket: String,
}

impl R2Storage {
    pub fn new(config: &R2Config) -> Self {
        let credentials = Credentials::new(
            &config.access_key_id,
            &config.secret_access_key,
            None,
            None,
            "yzy-contracts-env",
        );
        let s3_config = aws_sdk_s3::Config::builder()
            .behavior_version_latest()
            // R2 requires a region value and ignores it.
            .region(Region::new("auto"))
            .credentials_provider(credentials)
            .force_path_style(config.force_path_style)
            // Otherwise the SDK adds checksum parameters that a browser PUT cannot satisfy.
            .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
            .response_checksum_validation(ResponseChecksumValidation::WhenRequired);
        let signing_client =
            Client::from_conf(s3_config.clone().endpoint_url(&config.endpoint).build());
        let client = match &config.internal_endpoint {
            Some(endpoint) => Client::from_conf(s3_config.endpoint_url(endpoint).build()),
            None => signing_client.clone(),
        };
        Self {
            client,
            signing_client,
            bucket: config.bucket.clone(),
        }
    }
}

#[async_trait]
impl ObjectStorage for R2Storage {
    async fn presign_put(
        &self,
        key: &str,
        mime_type: &str,
        size_bytes: i64,
        ttl: Duration,
    ) -> anyhow::Result<PresignedRequest> {
        let request = self
            .signing_client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(mime_type)
            .content_length(size_bytes)
            .presigned(PresigningConfig::expires_in(ttl).context("invalid upload URL lifetime")?)
            .await
            .context("could not presign the upload")?;
        Ok(PresignedRequest {
            url: request.uri().to_owned(),
            headers: request
                .headers()
                .map(|(name, value)| (name.to_owned(), value.to_owned()))
                .collect(),
        })
    }

    async fn presign_get(
        &self,
        key: &str,
        attachment_file_name: Option<&str>,
        ttl: Duration,
    ) -> anyhow::Result<String> {
        let mut request = self
            .signing_client
            .get_object()
            .bucket(&self.bucket)
            .key(key);
        if let Some(file_name) = attachment_file_name {
            request = request.response_content_disposition(content_disposition(file_name));
        }
        let presigned = request
            .presigned(PresigningConfig::expires_in(ttl).context("invalid download URL lifetime")?)
            .await
            .context("could not presign the download")?;
        Ok(presigned.uri().to_owned())
    }

    async fn head(&self, key: &str) -> anyhow::Result<Option<ObjectMetadata>> {
        let response = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await;
        let output = match response {
            Ok(output) => output,
            Err(error) => {
                let service_error = error.into_service_error();
                if service_error.is_not_found() {
                    return Ok(None);
                }
                return Err(anyhow::Error::new(service_error).context("could not inspect object"));
            }
        };
        Ok(Some(ObjectMetadata {
            size_bytes: output
                .content_length()
                .context("storage returned no object size")?,
            content_type: output.content_type().map(str::to_owned),
            etag: output
                .e_tag()
                .context("storage returned no object ETag")?
                .to_owned(),
        }))
    }

    async fn read_prefix(&self, key: &str, length: u32) -> anyhow::Result<Vec<u8>> {
        let last_byte = length
            .checked_sub(1)
            .context("prefix length must be positive")?;
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .range(format!("bytes=0-{last_byte}"))
            .send()
            .await
            .context("could not read object prefix")?;
        let bytes = output
            .body
            .collect()
            .await
            .context("could not read object prefix body")?;
        Ok(bytes.into_bytes().to_vec())
    }

    async fn read_matching(
        &self,
        key: &str,
        metadata: &ObjectMetadata,
    ) -> anyhow::Result<Option<Vec<u8>>> {
        let response = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .if_match(&metadata.etag)
            .send()
            .await;
        let mut output = match response {
            Ok(output) => output,
            Err(error) => {
                if error.as_service_error().is_some_and(|error| {
                    matches!(error.code(), Some("PreconditionFailed" | "NoSuchKey"))
                }) {
                    return Ok(None);
                }
                return Err(anyhow::Error::new(error).context("could not read inspected object"));
            }
        };
        if output.e_tag() != Some(metadata.etag.as_str())
            || output.content_length() != Some(metadata.size_bytes)
        {
            return Ok(None);
        }
        let limit = usize::try_from(metadata.size_bytes).context("invalid object length")?;
        let mut bytes = Vec::new();
        while let Some(chunk) = output
            .body
            .try_next()
            .await
            .context("could not read inspected object body")?
        {
            if chunk.len() > limit.saturating_sub(bytes.len()) {
                return Ok(None);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok((bytes.len() == limit).then_some(bytes))
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .context("could not delete object")?;
        Ok(())
    }
}

/// RFC 6266 value. The plain `filename` keeps only safe ASCII so that a stored
/// name cannot inject header syntax; `filename*` preserves the original.
pub(crate) fn content_disposition(file_name: &str) -> String {
    let ascii: String = file_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let mut encoded = String::new();
    for byte in file_name.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> R2Storage {
        R2Storage::new(&R2Config {
            endpoint: "https://account.r2.cloudflarestorage.test".to_owned(),
            internal_endpoint: Some("http://storage:9000".to_owned()),
            bucket: "contracts".to_owned(),
            access_key_id: "synthetic-access-key".to_owned(),
            secret_access_key: "synthetic-secret-key".to_owned(),
            force_path_style: true,
        })
    }

    #[tokio::test]
    async fn presigned_upload_is_signed_for_the_key_type_and_lifetime() {
        let request = storage()
            .presign_put(
                "users/u/uploads/f.pdf",
                "application/pdf",
                1234,
                Duration::from_secs(300),
            )
            .await
            .expect("presign");

        assert!(request.url.starts_with(
            "https://account.r2.cloudflarestorage.test/contracts/users/u/uploads/f.pdf?"
        ));
        assert!(request.url.contains("X-Amz-Signature="));
        assert!(request.url.contains("X-Amz-Expires=300"));
        assert!(!request.url.contains("synthetic-secret-key"));
        let signed = request
            .url
            .split("X-Amz-SignedHeaders=")
            .nth(1)
            .and_then(|rest| rest.split('&').next())
            .expect("signed headers");
        assert!(signed.contains("content-type"), "signed: {signed}");
        assert!(signed.contains("content-length"), "signed: {signed}");
        assert!(
            request
                .headers
                .contains(&("content-type".to_owned(), "application/pdf".to_owned()))
        );
        assert!(!request.url.to_lowercase().contains("x-amz-checksum"));
    }

    #[tokio::test]
    async fn presigned_download_is_temporary_and_names_the_attachment() {
        let url = storage()
            .presign_get(
                "users/u/uploads/f.docx",
                Some("Contrato año.docx"),
                Duration::from_secs(60),
            )
            .await
            .expect("presign");

        assert!(url.contains("X-Amz-Expires=60"));
        assert!(url.contains("response-content-disposition="));
    }

    #[test]
    fn content_disposition_cannot_inject_header_syntax() {
        let value = content_disposition("a\"; evil=\"b\r\n.pdf");
        assert!(!value.contains('\r') && !value.contains('\n'));
        assert!(value.starts_with("attachment; filename=\"a__ evil__b__.pdf\";"));
    }
}
