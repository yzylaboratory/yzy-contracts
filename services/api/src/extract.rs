//! Request extractors that report rejections in the shared error format.

use axum::{
    Json,
    extract::{
        FromRequest, FromRequestParts, Path, Query, Request,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::{StatusCode, request::Parts},
};
use serde::de::DeserializeOwned;
use validator::{Validate, ValidationErrors};

use crate::error::ApiError;

pub struct ApiJson<T>(pub T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned + Validate,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        let Json(value) =
            Json::<T>::from_request(request, state)
                .await
                .map_err(|rejection: JsonRejection| {
                    if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
                        ApiError::PayloadTooLarge
                    } else {
                        ApiError::Validation(rejection.body_text())
                    }
                })?;
        value.validate().map_err(validation_error)?;
        Ok(Self(value))
    }
}

pub struct ApiPath<T>(pub T);

impl<T, S> FromRequestParts<S> for ApiPath<T>
where
    T: DeserializeOwned + Send,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Path(value) =
            Path::<T>::from_request_parts(parts, state)
                .await
                .map_err(|_: PathRejection| {
                    ApiError::Validation(
                        "The identifier in the path is not a valid UUID".to_owned(),
                    )
                })?;
        Ok(Self(value))
    }
}

pub struct ApiQuery<T>(pub T);

impl<T, S> FromRequestParts<S> for ApiQuery<T>
where
    T: DeserializeOwned + Validate,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Query(value) = Query::<T>::from_request_parts(parts, state)
            .await
            .map_err(|rejection: QueryRejection| ApiError::Validation(rejection.body_text()))?;
        value.validate().map_err(validation_error)?;
        Ok(Self(value))
    }
}

fn validation_error(errors: ValidationErrors) -> ApiError {
    let mut fields = errors
        .field_errors()
        .keys()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    fields.sort();
    ApiError::Validation(format!("Invalid value for: {}", fields.join(", ")))
}
