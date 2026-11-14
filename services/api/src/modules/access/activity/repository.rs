use sqlx::{PgPool, types::Json};
use uuid::Uuid;

use crate::error::ApiError;

use super::{
    super::admin::USER_SOURCE,
    ActivityItem, ActivityPage, ActivityQuery, TourEventInput,
    events::{ActivityEvent, ActivityEventsPage, ActivityEventsQuery, NewActivityEvent},
};

const HOURLY_EVENT_LIMIT: i64 = 120;
const HOURLY_ACTIVITY_LIMIT: i64 = 240;
const EVENT_ORDER: &str = "occurred_at DESC, source, stable_id, event, step";

pub(super) async fn observe_portal_access(db: &PgPool, user_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO yzy_contracts.portal_access_observations (user_id)
         SELECT $1
         WHERE NOT EXISTS (
             SELECT 1 FROM yzy_contracts.portal_access_observations
             WHERE user_id = $1 AND last_portal_access_at > statement_timestamp() - interval '5 minutes'
         )
         ON CONFLICT (user_id) DO UPDATE SET last_portal_access_at = EXCLUDED.last_portal_access_at
         WHERE portal_access_observations.last_portal_access_at
            <= EXCLUDED.last_portal_access_at - interval '5 minutes'",
    )
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(())
}

pub(super) async fn record_tour_event(
    db: &PgPool,
    user_id: Uuid,
    input: TourEventInput,
) -> Result<(), ApiError> {
    let mut tx = db.begin().await?;
    // Serialize each account's admissions, including across API instances. The
    // next statement sees any events committed while this transaction waited.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 210400))")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    let result: String = sqlx::query_scalar(
        "WITH admission AS (
            SELECT CASE
                WHEN NOT EXISTS (
                    SELECT 1 FROM yzy_contracts.companies c
                    WHERE c.archived_at IS NULL AND yzy_contracts.has_enabled_access($1)
                ) THEN 'ineligible'
                WHEN EXISTS (
                    SELECT 1 FROM yzy_contracts.tour_events
                    WHERE user_id = $1 AND run_id = $2 AND (
                        (event = $3 AND (step = $4 OR event = 'opened'))
                        OR (event IN ('completed', 'skipped') AND $3 IN ('completed', 'skipped'))
                    )
                ) THEN 'duplicate'
                WHEN EXISTS (
                    SELECT 1 FROM yzy_contracts.tour_events
                    WHERE user_id = $1 AND observed_at > statement_timestamp() - interval '1 hour'
                    OFFSET $5 LIMIT 1
                ) THEN 'limited'
                ELSE 'accepted'
            END AS result
         ), inserted AS (
            INSERT INTO yzy_contracts.tour_events (user_id, run_id, event, step)
            SELECT $1, $2, $3, $4 FROM admission WHERE result = 'accepted'
            ON CONFLICT DO NOTHING
         )
         SELECT result FROM admission",
    )
    .bind(user_id)
    .bind(input.run_id)
    .bind(input.event)
    .bind(input.step)
    .bind(HOURLY_EVENT_LIMIT - 1)
    .fetch_one(&mut *tx)
    .await?;

    match result.as_str() {
        "accepted" | "duplicate" => {
            tx.commit().await?;
            Ok(())
        }
        "limited" => Err(ApiError::TourRateLimited),
        "ineligible" => Err(ApiError::AccessPending),
        _ => Err(anyhow::anyhow!("invalid tour event admission result").into()),
    }
}

/// Admits duplicates even at the hourly limit. Portal observations and API
/// outcomes have separate quotas so one source cannot exhaust the other.
pub(super) async fn record_event(
    db: &PgPool,
    user_id: Uuid,
    activity: NewActivityEvent,
) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 210401))")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    let acknowledged = sqlx::query_scalar(
        "WITH admission AS (
            SELECT CASE
                WHEN EXISTS (
                    SELECT 1 FROM yzy_contracts.portal_activity_events
                    WHERE user_id = $1 AND client_event_id = $2
                ) THEN 'duplicate'
                WHEN EXISTS (
                    SELECT 1 FROM yzy_contracts.portal_activity_events
                    WHERE user_id = $1 AND occurred_at > statement_timestamp() - interval '1 hour'
                      AND (client_event_id IS NULL) = ($2::uuid IS NULL)
                    OFFSET $6 LIMIT 1
                ) THEN 'limited'
                ELSE 'accepted'
            END AS result
         ), inserted AS (
            INSERT INTO yzy_contracts.portal_activity_events (user_id, client_event_id, event, screen, result)
            SELECT $1, $2, $3, $4, $5 FROM admission WHERE result = 'accepted'
            ON CONFLICT (user_id, client_event_id) DO NOTHING
         )
         SELECT result <> 'limited' FROM admission",
    )
    .bind(user_id)
    .bind(activity.client_event_id)
    .bind(activity.event)
    .bind(activity.screen)
    .bind(activity.result)
    .bind(HOURLY_ACTIVITY_LIMIT - 1)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(acknowledged)
}

/// The timeline and summary use the same event sources and sort order. Source
/// keys only break ties inside PostgreSQL and are omitted from the response.
fn timeline_sql(user_id: &str) -> String {
    format!(
        "SELECT event, screen, result, occurred_at, NULL::text AS step, 1 AS source, id::text AS stable_id
         FROM yzy_contracts.portal_activity_events WHERE user_id = {user_id}
         UNION ALL
         SELECT 'portal_access', NULL, 'observed', first_portal_access_at, NULL, 2, 'first'
         FROM yzy_contracts.portal_access_observations WHERE user_id = {user_id}
         UNION ALL
         SELECT 'portal_access', NULL, 'observed', last_portal_access_at, NULL, 2, 'last'
         FROM yzy_contracts.portal_access_observations
         WHERE user_id = {user_id} AND last_portal_access_at > first_portal_access_at
         UNION ALL
         SELECT 'tour_' || event, NULL, 'observed', observed_at, step, 3, run_id::text
         FROM yzy_contracts.tour_events WHERE user_id = {user_id}
         UNION ALL
         SELECT 'document_generated', NULL, 'success', created_at, NULL, 4, id::text
         FROM yzy_contracts.generated_documents WHERE owner_id = {user_id} AND NOT imported_from_session
         UNION ALL
         SELECT 'invitation_registered', NULL, 'observed', created_at, NULL, 5, email
         FROM yzy_contracts.access_invitations WHERE accepted_by = {user_id}
         UNION ALL
         SELECT 'invitation_sent', NULL, 'success', m.sent_at, NULL, 5, v.email
         FROM yzy_contracts.access_invitations v
         JOIN yzy_contracts.access_mail m ON m.kind = 'invitation' AND m.reference = v.email
         WHERE v.accepted_by = {user_id} AND m.sent_at IS NOT NULL"
    )
}

#[derive(sqlx::FromRow)]
struct EventPageRow {
    items: Json<Vec<ActivityEvent>>,
    total: i64,
}

pub(super) async fn list_events(
    db: &PgPool,
    user_id: Uuid,
    query: ActivityEventsQuery,
) -> sqlx::Result<Option<ActivityEventsPage>> {
    let events = timeline_sql("$1");
    let sql = format!(
        "WITH events AS ({events}), paged AS (
            SELECT * FROM events ORDER BY {EVENT_ORDER} LIMIT $2 OFFSET $3
         )
         SELECT (SELECT count(*) FROM events) AS total,
             COALESCE((
                 SELECT jsonb_agg(to_jsonb(paged) - 'source' - 'stable_id' ORDER BY {EVENT_ORDER})
                 FROM paged
             ), '[]'::jsonb) AS items
         FROM yzy_contracts.profiles WHERE user_id = $1"
    );
    let row: Option<EventPageRow> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(user_id)
        .bind(query.per_page)
        .bind((query.page - 1).saturating_mul(query.per_page))
        .fetch_optional(db)
        .await?;
    Ok(row.map(|row| ActivityEventsPage {
        items: row.items.0,
        page: query.page,
        per_page: query.per_page,
        total: row.total,
    }))
}

#[derive(sqlx::FromRow)]
struct PageRow {
    items: Json<Vec<ActivityItem>>,
    total: i64,
}

pub(super) async fn list(
    db: &PgPool,
    superadmin_id: Option<Uuid>,
    query: ActivityQuery,
) -> sqlx::Result<ActivityPage> {
    // People and eligibility match the Users view. Activity joins run only for
    // the requested page, and the count and items use the same database snapshot.
    let events = timeline_sql("p.id");
    let sql = format!(
        "{USER_SOURCE}, matching AS (
            SELECT id, name, email, status, created_at
            FROM people
            WHERE ($1::text IS NULL OR strpos(lower(email), lower($1)) > 0
                   OR strpos(lower(COALESCE(name, '')), lower($1)) > 0)
              AND ($2::uuid IS NULL OR id IS DISTINCT FROM $2)
         ), paged AS (
            SELECT * FROM matching ORDER BY created_at DESC, email, id
            LIMIT $3 OFFSET $4
         ), details AS (
            SELECT p.id, p.name, p.email, p.status, p.created_at,
                invite.created_at AS invited_at, mail.sent_at AS invitation_sent_at,
                (invite.accepted_by IS NOT NULL) AS invitation_accepted,
                observed.first_portal_access_at, observed.last_portal_access_at,
                tour.last_tour, onboarding.completed_at AS onboarding_completed_at,
                docs.documents_generated, docs.last_document_generated_at,
                CASE
                    WHEN p.id IS NOT NULL THEN latest_activity.last_activity
                    WHEN mail.sent_at >= invite.created_at THEN jsonb_build_object(
                        'event', 'invitation_sent', 'screen', NULL, 'result', 'success',
                        'occurred_at', mail.sent_at, 'step', NULL
                    )
                    WHEN invite.created_at IS NOT NULL THEN jsonb_build_object(
                        'event', 'invitation_registered', 'screen', NULL, 'result', 'observed',
                        'occurred_at', invite.created_at, 'step', NULL
                    )
                END AS last_activity
            FROM paged p
            LEFT JOIN LATERAL (
                SELECT v.email, v.created_at, v.accepted_by
                FROM yzy_contracts.access_invitations v
                WHERE v.accepted_by = p.id
                   OR (p.id IS NULL AND v.email = p.email AND v.accepted_by IS NULL)
                ORDER BY v.created_at DESC, v.email
                LIMIT 1
            ) invite ON true
            LEFT JOIN yzy_contracts.access_mail mail
              ON mail.kind = 'invitation' AND mail.reference = invite.email
            LEFT JOIN yzy_contracts.portal_access_observations observed ON observed.user_id = p.id
            LEFT JOIN yzy_contracts.onboarding_completions onboarding ON onboarding.user_id = p.id
            LEFT JOIN LATERAL (
                SELECT jsonb_build_object(
                    'opened_at', opening.observed_at,
                    'last_step', COALESCE(outcome.step, latest.step),
                    'last_step_at', COALESCE(outcome.observed_at, latest.observed_at),
                    'outcome', outcome.event,
                    'outcome_at', outcome.observed_at
                ) AS last_tour
                FROM (
                    SELECT e.run_id, e.observed_at
                    FROM yzy_contracts.tour_events e
                    WHERE e.user_id = p.id AND e.event = 'opened'
                    ORDER BY e.observed_at DESC, e.run_id DESC
                    LIMIT 1
                ) opening
                JOIN LATERAL (
                    SELECT e.step, e.observed_at
                    FROM yzy_contracts.tour_events e
                    WHERE e.user_id = p.id AND e.run_id = opening.run_id
                      AND e.event IN ('opened', 'step_viewed')
                    ORDER BY e.observed_at DESC, e.event DESC, e.step
                    LIMIT 1
                ) latest ON true
                LEFT JOIN LATERAL (
                    SELECT e.step, e.observed_at, e.event
                    FROM yzy_contracts.tour_events e
                    WHERE e.user_id = p.id AND e.run_id = opening.run_id
                      AND e.event IN ('completed', 'skipped')
                ) outcome ON true
            ) tour ON true
            CROSS JOIN LATERAL (
                SELECT count(*) AS documents_generated, max(d.created_at) AS last_document_generated_at
                FROM yzy_contracts.generated_documents d
                WHERE d.owner_id = p.id AND NOT d.imported_from_session
            ) docs
            LEFT JOIN LATERAL (
                SELECT to_jsonb(e) - 'source' - 'stable_id' AS last_activity
                FROM ({events}) e ORDER BY {EVENT_ORDER} LIMIT 1
            ) latest_activity ON true
         )
         SELECT (SELECT count(*) FROM matching) AS total,
             COALESCE(
                 jsonb_agg(to_jsonb(details) - 'created_at' ORDER BY created_at DESC, email, id),
                 '[]'::jsonb
             ) AS items
         FROM details"
    );
    let row: PageRow = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(
            query
                .query
                .as_deref()
                .map(str::trim)
                .filter(|q| !q.is_empty()),
        )
        .bind(superadmin_id)
        .bind(query.per_page)
        .bind((query.page - 1).saturating_mul(query.per_page))
        .fetch_one(db)
        .await?;
    Ok(ActivityPage {
        items: row.items.0,
        page: query.page,
        per_page: query.per_page,
        total: row.total,
    })
}
