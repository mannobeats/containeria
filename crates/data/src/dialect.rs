use crate::engine::Engine;

/// How one SQL engine spells identifiers, placeholders and the parts of a query that differ.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Dialect {
    Postgres,
    MySql,
    Sqlite,
    ClickHouse,
}

impl Dialect {
    #[must_use]
    pub(crate) const fn of(engine: Engine) -> Option<Self> {
        match engine {
            Engine::Postgres => Some(Self::Postgres),
            Engine::MySql | Engine::MariaDb => Some(Self::MySql),
            Engine::Sqlite => Some(Self::Sqlite),
            Engine::ClickHouse => Some(Self::ClickHouse),
            Engine::MongoDb | Engine::Redis => None,
        }
    }

    /// Quotes an identifier, doubling any quote character inside it, so any table or column name is
    /// safe to put in SQL.
    #[must_use]
    pub(crate) fn quote(self, identifier: &str) -> String {
        let mark = match self {
            Self::Postgres | Self::Sqlite => '"',
            Self::MySql | Self::ClickHouse => '`',
        };
        let mut quoted = String::with_capacity(identifier.len() + 2);
        quoted.push(mark);
        for char in identifier.chars() {
            if char == mark {
                quoted.push(mark);
            }
            quoted.push(char);
        }
        quoted.push(mark);
        quoted
    }

    /// The `n`th bound parameter (1-based), cast to the column's type where the engine needs it.
    #[must_use]
    pub(crate) fn placeholder(self, index: usize, cast_to: Option<&str>) -> String {
        match (self, cast_to) {
            (Self::Postgres, Some(type_name)) => format!("CAST(${index} AS {type_name})"),
            (Self::Postgres, None) => format!("${index}"),
            (Self::ClickHouse, Some(type_name)) => format!("CAST(? AS {type_name})"),
            (Self::MySql | Self::Sqlite | Self::ClickHouse, _) => "?".to_owned(),
        }
    }

    /// Case-insensitive `LIKE` over the column read as text.
    #[must_use]
    pub(crate) fn like(self, column: &str, placeholder: &str) -> String {
        match self {
            Self::Postgres => format!("{column}::text ILIKE {placeholder} ESCAPE '\\'"),
            Self::MySql => format!("{column} LIKE {placeholder} ESCAPE '\\\\'"),
            Self::Sqlite => format!("{column} LIKE {placeholder} ESCAPE '\\'"),
            Self::ClickHouse => format!("toString({column}) ILIKE {placeholder}"),
        }
    }

    /// `ORDER BY` for one column, with nulls last in both directions.
    #[must_use]
    pub(crate) fn order(self, column: &str, descending: bool) -> String {
        let direction = if descending { "DESC" } else { "ASC" };
        match self {
            Self::MySql => format!("{column} IS NULL, {column} {direction}"),
            Self::Postgres | Self::Sqlite | Self::ClickHouse => {
                format!("{column} {direction} NULLS LAST")
            }
        }
    }

    /// A qualified table name.
    #[must_use]
    pub(crate) fn table(self, schema: Option<&str>, name: &str) -> String {
        match schema {
            Some(schema) if !schema.is_empty() => {
                format!("{}.{}", self.quote(schema), self.quote(name))
            }
            _ => self.quote(name),
        }
    }
}

/// Escapes `%`, `_` and the escape character so a search term matches literally inside `LIKE`.
#[must_use]
pub(crate) fn escape_like(term: &str) -> String {
    let mut escaped = String::with_capacity(term.len());
    for char in term.chars() {
        if matches!(char, '%' | '_' | '\\') {
            escaped.push('\\');
        }
        escaped.push(char);
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_identifiers_and_doubles_embedded_quotes() {
        assert_eq!(Dialect::Postgres.quote("orders"), "\"orders\"");
        assert_eq!(Dialect::Postgres.quote("we\"ird"), "\"we\"\"ird\"");
        assert_eq!(Dialect::MySql.quote("a`b"), "`a``b`");
        assert_eq!(Dialect::Sqlite.quote("x; DROP TABLE y"), "\"x; DROP TABLE y\"");
    }

    #[test]
    fn numbers_postgres_placeholders_and_casts_them() {
        assert_eq!(Dialect::Postgres.placeholder(2, Some("integer")), "CAST($2 AS integer)");
        assert_eq!(Dialect::MySql.placeholder(2, Some("int")), "?");
    }

    #[test]
    fn escapes_like_wildcards() {
        assert_eq!(escape_like("50%_off\\"), "50\\%\\_off\\\\");
    }

    #[test]
    fn keeps_nulls_last_on_mysql() {
        assert_eq!(Dialect::MySql.order("`a`", true), "`a` IS NULL, `a` DESC");
        assert_eq!(Dialect::Postgres.order("\"a\"", false), "\"a\" ASC NULLS LAST");
    }

    #[test]
    fn qualifies_tables_with_their_schema() {
        assert_eq!(Dialect::Postgres.table(Some("auth"), "users"), "\"auth\".\"users\"");
        assert_eq!(Dialect::Sqlite.table(None, "notes"), "\"notes\"");
    }
}
