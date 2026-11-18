//! Which product schema this process serves. PROD and DEV run the same binary;
//! `CONTRACTS_DATABASE_SCHEMA` selects the schema at runtime and the database
//! role must match it, so a mismatched environment stops at startup.

use anyhow::bail;

pub const PRODUCTION_SCHEMA: &str = "yzy_contracts";
pub const DEVELOPMENT_SCHEMA: &str = "yzy_contracts_dev";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatabaseSchema {
    Production,
    Development,
}

impl DatabaseSchema {
    /// Unset means production. Any other value must be one of the two known schemas.
    pub fn from_env() -> anyhow::Result<Self> {
        match std::env::var("CONTRACTS_DATABASE_SCHEMA") {
            Err(std::env::VarError::NotPresent) => Ok(Self::Production),
            Err(error) => Err(error.into()),
            Ok(value) => Self::parse(&value),
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        match value {
            PRODUCTION_SCHEMA => Ok(Self::Production),
            DEVELOPMENT_SCHEMA => Ok(Self::Development),
            other => bail!(
                "CONTRACTS_DATABASE_SCHEMA must be {PRODUCTION_SCHEMA} or {DEVELOPMENT_SCHEMA}, not {other:?}"
            ),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Production => PRODUCTION_SCHEMA,
            Self::Development => DEVELOPMENT_SCHEMA,
        }
    }

    /// The schema this process must not read. DEV is never allowed to reach PROD.
    pub fn other_name(self) -> &'static str {
        match self {
            Self::Production => DEVELOPMENT_SCHEMA,
            Self::Development => PRODUCTION_SCHEMA,
        }
    }

    /// The runtime role. It is the only role allowed with this schema.
    pub fn role(self) -> &'static str {
        match self {
            Self::Production => "yzy_contracts_app",
            Self::Development => "yzy_contracts_dev_app",
        }
    }

    /// Custom setting read by the row-level policies as the superadministrator id.
    pub fn superadmin_setting(self) -> &'static str {
        match self {
            Self::Production => "yzy_contracts.superadmin_id",
            Self::Development => "yzy_contracts_dev.superadmin_id",
        }
    }

    pub fn ledger_table(self) -> &'static str {
        match self {
            Self::Production => "yzy_contracts._sqlx_migrations",
            Self::Development => "yzy_contracts_dev._sqlx_migrations",
        }
    }
}

/// The DEV rename applied to the embedded migrations at runtime. It is the same
/// rewrite the former build-time DEV image applied, so DEV ledger checksums stay valid.
/// Production uses the embedded SQL untouched.
pub fn development_sql(sql: &str) -> String {
    let renamed = replace_whole_word(sql, "yzy_contracts_app", "yzy_contracts_dev_app");
    replace_whole_word(&renamed, "yzy_contracts", "yzy_contracts_dev")
}

/// Replaces `from` where it is a whole word, matching perl's `\b` on ASCII word
/// characters: letters, digits and underscore.
fn replace_whole_word(text: &str, from: &str, to: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for (index, _) in text.match_indices(from) {
        let before = text[..index].chars().next_back();
        let after = text[index + from.len()..].chars().next();
        if before.is_some_and(is_word_char) || after.is_some_and(is_word_char) {
            continue;
        }
        out.push_str(&text[last..index]);
        out.push_str(to);
        last = index + from.len();
    }
    out.push_str(&text[last..]);
    out
}

fn is_word_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_the_two_known_schemas() {
        assert_eq!(
            DatabaseSchema::parse("yzy_contracts").unwrap(),
            DatabaseSchema::Production
        );
        assert_eq!(
            DatabaseSchema::parse("yzy_contracts_dev").unwrap(),
            DatabaseSchema::Development
        );
        for invalid in [
            "",
            "public",
            "YZY_CONTRACTS",
            "yzy_contracts ",
            "yzy_contracts_stg",
        ] {
            assert!(DatabaseSchema::parse(invalid).is_err(), "{invalid:?}");
        }
    }

    #[test]
    fn each_schema_has_its_own_role_and_setting() {
        assert_eq!(DatabaseSchema::Production.role(), "yzy_contracts_app");
        assert_eq!(DatabaseSchema::Development.role(), "yzy_contracts_dev_app");
        assert_eq!(
            DatabaseSchema::Development.superadmin_setting(),
            "yzy_contracts_dev.superadmin_id"
        );
        assert_eq!(
            DatabaseSchema::Development.ledger_table(),
            "yzy_contracts_dev._sqlx_migrations"
        );
        assert_eq!(DatabaseSchema::Development.other_name(), "yzy_contracts");
    }

    #[test]
    fn development_rename_matches_the_whole_word_rules() {
        assert_eq!(
            development_sql("GRANT USAGE ON SCHEMA yzy_contracts TO yzy_contracts_app;"),
            "GRANT USAGE ON SCHEMA yzy_contracts_dev TO yzy_contracts_dev_app;"
        );
        assert_eq!(
            development_sql("current_setting('yzy_contracts.superadmin_id', true)"),
            "current_setting('yzy_contracts_dev.superadmin_id', true)"
        );
        assert_eq!(
            development_sql("CREATE TABLE yzy_contracts._sqlx_migrations(x int);"),
            "CREATE TABLE yzy_contracts_dev._sqlx_migrations(x int);"
        );
        // Longer identifiers are not whole words. Non-ASCII bytes are not word
        // characters for perl's \b, so an accented neighbour still counts as a boundary.
        assert_eq!(
            development_sql("xyzy_contracts yzy_contracts_api yzy_contractsé"),
            "xyzy_contracts yzy_contracts_api yzy_contracts_devé"
        );
        assert_eq!(
            development_sql("(yzy_contracts)\nyzy_contracts_app\n"),
            "(yzy_contracts_dev)\nyzy_contracts_dev_app\n"
        );
    }
}
