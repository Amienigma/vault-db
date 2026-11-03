use axum::{extract::{DefaultBodyLimit, Multipart, Query, State}, http::StatusCode, routing::{get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::time::Duration;

type R = Result<Json<Value>, (StatusCode, String)>;
fn e<E: std::fmt::Display>(x: E) -> (StatusCode, String) { (StatusCode::INTERNAL_SERVER_ERROR, x.to_string()) }
#[derive(Deserialize)] struct Q { q: Option<String> }

async fn files(State(db): State<PgPool>) -> R {
    let r: (Value,) = sqlx::query_as("SELECT COALESCE(json_agg(f ORDER BY f.id DESC),'[]'::json) FROM (SELECT id,name,status,size_bytes,rows_loaded,rejected,error FROM files) f")
        .fetch_one(&db).await.map_err(e)?;
    Ok(Json(r.0))
}

async fn records(State(db): State<PgPool>, Query(p): Query<Q>) -> R {
    let r: (Value,) = sqlx::query_as("SELECT COALESCE(json_agg(r ORDER BY r.id DESC),'[]'::json) FROM (SELECT id,file_id,data FROM records WHERE $1 = '' OR data::text ILIKE '%'||$1||'%' ORDER BY id DESC LIMIT 100) r")
        .bind(p.q.unwrap_or_default()).fetch_one(&db).await.map_err(e)?;
    Ok(Json(r.0))
}

async fn upload(State(db): State<PgPool>, mut mp: Multipart) -> R {
    let dir = std::env::var("UPLOAD_DIR").unwrap_or("/data/uploads".into());
    tokio::fs::create_dir_all(&dir).await.map_err(e)?;
    let mut out = vec![];
    while let Some(f) = mp.next_field().await.map_err(e)? {
        let name = f.file_name().unwrap_or("upload").replace('/', "_");
        let bytes = f.bytes().await.map_err(e)?;
        let hash = hex::encode(Sha256::digest(&bytes));
        let path = format!("{dir}/{hash}-{name}");
        tokio::fs::write(&path, &bytes).await.map_err(e)?;
        let row = sqlx::query("INSERT INTO files(name,path,sha256,size_bytes) VALUES($1,$2,$3,$4) ON CONFLICT (sha256) DO NOTHING RETURNING id")
            .bind(&name).bind(&path).bind(&hash).bind(bytes.len() as i64)
            .fetch_optional(&db).await.map_err(e)?;
        out.push(match row {
            Some(r) => json!({"name": name, "id": r.get::<i64, _>("id")}),
            None => json!({"name": name, "duplicate": true}),
        });
    }
    Ok(Json(json!(out)))
}

#[tokio::main]
async fn main() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = loop {
        match PgPoolOptions::new().max_connections(8).connect(&url).await {
            Ok(p) => break p,
            Err(_) => tokio::time::sleep(Duration::from_secs(2)).await,
        }
    };
    let app = Router::new()
        .route("/files", get(files)).route("/records", get(records)).route("/upload", post(upload))
        .layer(DefaultBodyLimit::max(200 * 1024 * 1024)).with_state(pool);
    axum::serve(tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap(), app).await.unwrap();
}
