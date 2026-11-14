use serde::Deserialize;
use utoipa::IntoParams;
use validator::Validate;

#[derive(Deserialize, Validate, IntoParams)]
#[into_params(parameter_in = Query)]
pub(super) struct PageQuery {
    #[validate(range(min = 1))]
    pub page: Option<i64>,
    #[validate(range(min = 1, max = 100))]
    pub per_page: Option<i64>,
}

impl PageQuery {
    pub fn limit(&self) -> Option<i64> {
        (self.page.is_some() || self.per_page.is_some()).then(|| self.per_page.unwrap_or(10))
    }

    pub fn offset(&self) -> i64 {
        (self.page.unwrap_or(1) - 1).saturating_mul(self.limit().unwrap_or(0))
    }

    pub fn number(&self) -> i64 {
        self.page.unwrap_or(1)
    }
}
