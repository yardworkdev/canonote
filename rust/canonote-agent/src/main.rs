//! The canonote agent API, in Rust, as one binary.
//!
//! Same contract as the Node reference server: a 700-byte manifest, metadata-only
//! lists, byte caps, append-safe writes, a revision guard, and an instant switch.
//! The point of the exercise is to measure whether Rust makes this easier or only
//! faster, so the routes and the JSON are deliberately identical.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use rand::Rng;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

const FIELDS: [&str; 8] = ["id", "title", "created", "updated", "words", "rev", "folder", "tags"];
const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 50;
const DEFAULT_MAX_BYTES: usize = 8000;
const HARD_MAX_BYTES: usize = 16000;

#[derive(Clone, Debug)]
struct Note {
    id: String,
    title: String,
    body: String,
    rev: String,
    created: String,
    updated: String,
    folder: String,
    contributors: Vec<String>,
    tags: Vec<String>,
    /// False hides the note from every agent route, which answers 404 for it so
    /// an agent cannot tell a withheld note from one that never existed.
    agent_access: bool,
}

#[derive(Clone)]
struct Key {
    id: String,
    kind: &'static str,
    write: bool,
    enabled: bool,
}

struct Store {
    base: String,
    notes: Vec<Note>,
    keys: HashMap<String, Key>,
    global: bool,
    writes: Vec<Value>,
    /// note id -> the one agent currently working in it, with a millisecond stamp
    presence: HashMap<String, Value>,
    seq: usize,
}

type Shared = Arc<RwLock<Store>>;

// ------------------------------------------------------------------ small helpers

fn revision_of(body: &str) -> String {
    let mut h = Sha256::new();
    h.update(body.as_bytes());
    format!("{:x}", h.finalize())[..16].to_string()
}

fn hash_key(key: &str) -> String {
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    format!("{:x}", h.finalize())
}

fn token(prefix: &str, secret_len: usize) -> (String, String, String) {
    let mut rng = rand::thread_rng();
    let id: String = (0..8).map(|_| format!("{:x}", rng.gen_range(0u8..16))).collect();
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let secret: String = (0..secret_len)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect();
    let key = format!("{prefix}_{id}_{secret}");
    (id, key.clone(), hash_key(&key))
}

const PRESENCE_TTL_MS: u64 = 12_000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn now_iso() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

// Howard Hinnant's days-from-civil, inverted. No date crate for one format string.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn join_blocks(a: &str, b: &str) -> String {
    let left = a.trim_end();
    let right = b.trim_start();
    match (left.is_empty(), right.is_empty()) {
        (true, _) => right.to_string(),
        (_, true) => left.to_string(),
        _ => format!("{left}\n\n{right}"),
    }
}

fn with_author(mut list: Vec<String>, author: &str) -> Vec<String> {
    if !list.iter().any(|a| a == author) {
        list.push(author.to_string());
    }
    list
}

fn note_json(note: &Note) -> Value {
    json!({
        "id": note.id,
        "title": note.title,
        "created": note.created,
        "updated": note.updated,
        "words": count_words(&note.body),
        "rev": note.rev,
        "folder": note.folder,
        "tags": note.tags,
    })
}

fn project(note: &Note, fields: Option<&Vec<String>>) -> Value {
    let full = note_json(note);
    let Some(fields) = fields else { return full };
    let mut out = Map::new();
    if let Value::Object(full) = full {
        for f in fields {
            if let Some(v) = full.get(f) {
                out.insert(f.clone(), v.clone());
            }
        }
    }
    Value::Object(out)
}

fn parse_fields(raw: Option<&String>) -> Option<Vec<String>> {
    let raw = raw?;
    let asked: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| FIELDS.contains(&s.as_str()))
        .collect();
    if asked.is_empty() {
        None
    } else {
        Some(asked)
    }
}

fn parse_limit(raw: Option<&String>, fallback: usize, max: usize) -> usize {
    raw.and_then(|v| v.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .map(|n| n.min(max))
        .unwrap_or(fallback)
}

fn clamp_to_bytes(text: &str, max: usize) -> (String, bool) {
    if text.len() <= max {
        return (text.to_string(), false);
    }
    let mut cut = max;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    (text[..cut].to_string(), true)
}

/// Serialise, then hold the body inside the caller's budget. Truncation stays valid JSON.
fn respond(payload: &Value, budget: Option<usize>) -> (String, usize, bool) {
    let budget = budget.unwrap_or(DEFAULT_MAX_BYTES).min(HARD_MAX_BYTES);
    let raw = serde_json::to_string(payload).unwrap_or_else(|_| "{}".into());
    if raw.len() <= budget {
        let n = raw.len();
        return (raw, n, false);
    }
    let mut head_budget = budget.saturating_sub(200);
    for _ in 0..6 {
        let (head, _) = clamp_to_bytes(&raw, head_budget);
        let envelope = json!({
            "truncated": true,
            "budget": budget,
            "head": head,
            "hint": "narrow it: fields=id,title  limit=5  part=meta|body  maxBytes=",
        });
        let body = serde_json::to_string(&envelope).unwrap_or_default();
        if body.len() <= budget {
            let n = body.len();
            return (body, n, true);
        }
        head_budget = head_budget.saturating_sub(120);
    }
    let fallback = json!({"truncated": true, "budget": budget, "hint": "request too large; ask for less"});
    let body = fallback.to_string();
    let n = body.len();
    (body, n, true)
}

fn emit(payload: Value, budget: Option<usize>) -> Response {
    let (body, bytes, truncated) = respond(&payload, budget);
    let mut res = (StatusCode::OK, body).into_response();
    let h = res.headers_mut();
    h.insert("content-type", "application/json; charset=utf-8".parse().unwrap());
    h.insert("cache-control", "no-store".parse().unwrap());
    h.insert("x-canonote-bytes", bytes.to_string().parse().unwrap());
    h.insert("x-canonote-truncated", if truncated { "true" } else { "false" }.parse().unwrap());
    res
}

/// The notebook is off. Point at the route that turns it back on: an agent reading
/// a 423 should not have to guess.
fn locked(store: &Store) -> Response {
    (
        StatusCode::LOCKED,
        json!({
            "error": "this notebook is switched off for agents",
            "switch": format!("{}/api/agent/switch", store.base),
        })
        .to_string(),
    )
        .into_response()
}

/// No key, or one nobody minted. Point at the manifest that explains how to enter.
fn unauthorized(store: &Store) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        json!({
            "error": "unknown key",
            "enter": format!("{}/api/agent", store.base),
        })
        .to_string(),
    )
        .into_response()
}

fn err(status: StatusCode, message: &str) -> Response {
    (status, json!({"error": message}).to_string()).into_response()
}

fn ok(status: StatusCode, value: Value) -> Response {
    let mut res = (status, value.to_string()).into_response();
    res.headers_mut()
        .insert("content-type", "application/json".parse().unwrap());
    res
}

fn caller(headers: &HeaderMap, store: &Store) -> Option<Key> {
    let raw = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_start_matches("Bearer ").trim().to_string())
        .or_else(|| headers.get("x-agent-key").and_then(|v| v.to_str().ok()).map(str::to_string))?;
    store.keys.get(&hash_key(&raw)).cloned()
}

// ----------------------------------------------------------------------- the routes

async fn manifest(State(shared): State<Shared>) -> Response {
    let store = shared.read().unwrap();
    let newest = store.notes.first().map(|n| n.updated.clone()).unwrap_or_default();
    let payload = json!({
        "canonote": 1,
        "you": "a key with read, propose and write rights",
        "notes": store.notes.len(),
        "pending": 0,
        "newest": newest,
        "start": "/api/agent/notes?limit=20&fields=id,title,updated,words",
        "then": [
            "/api/agent/notes/:id?part=meta|body",
            "/api/agent/search?q=",
            "PATCH /api/agent/notes/:id {op: append|replace, content, ifRevision}",
        ],
        "rules": ["lists are metadata only", "bodies one at a time", "every response is capped"],
        "limits": {"maxBytes": DEFAULT_MAX_BYTES, "maxNotes": MAX_LIMIT},
        "off": "/api/agent/switch",
    });
    let (body, bytes, _) = respond(&payload, Some(700));
    let mut res = (StatusCode::OK, body).into_response();
    let h = res.headers_mut();
    h.insert("content-type", "application/json; charset=utf-8".parse().unwrap());
    h.insert("x-canonote-bytes", bytes.to_string().parse().unwrap());
    res
}

async fn list_notes(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let store = shared.read().unwrap();
    let Some(_key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if !store.global || !_key.enabled {
        return locked(&store);
    }
    let limit = parse_limit(q.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    let fields = parse_fields(q.get("fields"));
    let mut rows: Vec<&Note> = store.notes.iter().filter(|n| n.agent_access).collect();
    if let Some(since) = q.get("since") {
        rows.retain(|n| &n.updated > since);
    }
    let max_bytes = q.get("maxBytes").and_then(|v| v.parse().ok());
    let items: Vec<Value> = rows.iter().take(limit).map(|n| project(n, fields.as_ref())).collect();
    let next = if rows.len() > limit {
        rows.get(limit - 1).map(|n| format!("{}\u{1f}{}", n.updated, n.id))
    } else {
        None
    };
    emit(
        json!({"count": items.len(), "next": next, "items": items}),
        max_bytes,
    )
}

async fn get_note(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let store = shared.read().unwrap();
    let Some(_key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if !store.global || !_key.enabled {
        return locked(&store);
    }
    let Some(note) = store.notes.iter().find(|n| n.id == id && n.agent_access) else {
        return err(StatusCode::NOT_FOUND, "no such note");
    };
    let max_bytes = q.get("maxBytes").and_then(|v| v.parse().ok());
    match q.get("part").map(String::as_str) {
        Some("body") => {
            let (body, truncated) = clamp_to_bytes(&note.body, max_bytes.unwrap_or(6000).min(HARD_MAX_BYTES));
            emit(
                json!({"id": note.id, "rev": note.rev, "content": body, "truncated": truncated}),
                max_bytes,
            )
        }
        _ => emit(project(note, parse_fields(q.get("fields")).as_ref()), max_bytes),
    }
}

async fn search(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let store = shared.read().unwrap();
    let Some(_key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if !store.global || !_key.enabled {
        return locked(&store);
    }
    let needle = q.get("q").cloned().unwrap_or_default().to_lowercase();
    if needle.is_empty() {
        return err(StatusCode::BAD_REQUEST, "q is required");
    }
    let limit = parse_limit(q.get("limit"), 10, 20);
    let items: Vec<Value> = store
        .notes
        .iter()
        .filter(|n| n.agent_access)
        .filter(|n| n.title.to_lowercase().contains(&needle) || n.body.to_lowercase().contains(&needle))
        .take(limit)
        .map(|n| {
            let lower = n.body.to_lowercase();
            let at = lower.find(&needle).unwrap_or(0);
            let from = at.saturating_sub(40);
            let snippet: String = n.body.chars().skip(from).take(120).collect();
            json!({"id": n.id, "title": n.title, "updated": n.updated, "snippet": snippet.split_whitespace().collect::<Vec<_>>().join(" ")})
        })
        .collect();
    emit(json!({"hits": items.len(), "items": items}), None)
}

async fn create_note(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let mut store = shared.write().unwrap();
    let Some(key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if !store.global || !key.enabled {
        return locked(&store);
    }
    if !key.write {
        return err(StatusCode::FORBIDDEN, "no write scope");
    }
    let title = body.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if title.is_empty() {
        return err(StatusCode::BAD_REQUEST, "title is required");
    }
    let text = body.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
    store.seq += 1;
    let now = now_iso();
    let note = Note {
        id: format!("note-{:03}", store.seq),
        title,
        rev: revision_of(&text),
        body: text,
        created: now.clone(),
        updated: now.clone(),
        folder: "agent".into(),
        contributors: vec!["agent".into()],
        tags: vec![],
        agent_access: true,
    };
    let out = json!({"id": note.id, "rev": note.rev, "title": note.title});
    store.writes.push(json!({"at": now, "by": "agent", "op": "create", "note": note.id}));
    store.notes.insert(0, note);
    ok(StatusCode::CREATED, out)
}

async fn patch_note(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let mut store = shared.write().unwrap();
    let Some(key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if !store.global || !key.enabled {
        return locked(&store);
    }
    if !key.write {
        return err(StatusCode::FORBIDDEN, "no write scope");
    }
    let Some(idx) = store.notes.iter().position(|n| n.id == id && n.agent_access) else {
        return err(StatusCode::NOT_FOUND, "no such note");
    };
    let op = body.get("op").and_then(|v| v.as_str()).unwrap_or("replace");
    let text = body.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let now = now_iso();

    if op == "append" {
        if text.trim().is_empty() {
            return err(StatusCode::BAD_REQUEST, "nothing to append");
        }
        let note = &mut store.notes[idx];
        note.body = join_blocks(&note.body, &text);
        note.rev = revision_of(&note.body);
        note.updated = now.clone();
        note.contributors = with_author(note.contributors.clone(), "agent");
    } else {
        let if_rev = body.get("ifRevision").and_then(|v| v.as_str());
        let Some(if_rev) = if_rev else {
            let rev = store.notes[idx].rev.clone();
            return (
                StatusCode::PRECONDITION_REQUIRED,
                json!({"error": "ifRevision is required for a replace", "rev": rev}).to_string(),
            )
                .into_response();
        };
        if if_rev != store.notes[idx].rev {
            let current = store.notes[idx].clone();
            return ok(
                StatusCode::CONFLICT,
                json!({"error": "stale revision", "rev": current.rev, "body": current.body}),
            );
        }
        let note = &mut store.notes[idx];
        note.body = text;
        note.rev = revision_of(&note.body);
        note.updated = now.clone();
        note.contributors = with_author(note.contributors.clone(), "agent");
    }

    store.notes.sort_by(|a, b| b.updated.cmp(&a.updated));
    let note_id = store.notes[idx].id.clone();
    let out = {
        let note = store.notes.iter().find(|n| n.id == note_id).unwrap();
        json!({
            "id": note.id,
            "rev": note.rev,
            "by": note.contributors,
            "words": count_words(&note.body),
        })
    };
    store.writes.push(json!({"at": now, "by": "agent", "op": op, "note": note_id}));
    ok(StatusCode::OK, out)
}

async fn propose(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let store = shared.read().unwrap();
    let Some(key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if !store.global || !key.enabled {
        return locked(&store);
    }
    let Some(note) = store.notes.iter().find(|n| n.id == id && n.agent_access) else {
        return err(StatusCode::NOT_FOUND, "no such note");
    };
    if let Some(if_rev) = body.get("ifRevision").and_then(|v| v.as_str()) {
        if if_rev != note.rev {
            return ok(
                StatusCode::CONFLICT,
                json!({"error": "stale revision", "rev": note.rev}),
            );
        }
    }
    ok(
        StatusCode::CREATED,
        json!({
            "id": format!("sug-{}", note.id),
            "state": "pending",
            "note": note.id,
            "humanMustAccept": true,
        }),
    )
}

/// Where the agent is working. A note it cannot see answers 404 here too.
async fn agent_presence(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let mut store = shared.write().unwrap();
    let Some(key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if !store.global || !key.enabled {
        return locked(&store);
    }
    let visible = store.notes.iter().any(|n| n.id == id && n.agent_access);
    if !visible {
        return err(StatusCode::NOT_FOUND, "no such note");
    }
    let mode = match body.get("mode").and_then(|v| v.as_str()) {
        Some("proposing") => "proposing",
        Some("writing") => "writing",
        _ => "reading",
    };
    let entry = json!({
        "kind": "agent",
        "id": key.id,
        "name": "Rudi",
        "mode": mode,
        "from": body.get("from").and_then(|v| v.as_u64()),
        "to": body.get("to").and_then(|v| v.as_u64()),
        "at": now_ms(),
    });
    store.presence.insert(id, entry.clone());
    ok(StatusCode::OK, entry)
}

/// What the person’s browser polls while the note is open.
async fn human_presence(State(shared): State<Shared>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    let mut store = shared.write().unwrap();
    let Some(_key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    let entry = store.presence.get(&id).cloned();
    let live = match entry {
        Some(value) => {
            let at = value.get("at").and_then(|v| v.as_u64()).unwrap_or(0);
            if now_ms().saturating_sub(at) <= PRESENCE_TTL_MS {
                vec![value]
            } else {
                store.presence.remove(&id);
                Vec::new()
            }
        }
        None => Vec::new(),
    };
    ok(StatusCode::OK, json!({"ttl": PRESENCE_TTL_MS, "entries": live}))
}

/// The person's own switch, standing in for the checkbox in the app.
/// The agent API has no route that can turn access back on.
async fn human_access(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let mut store = shared.write().unwrap();
    let Some(key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if key.kind != "admin" {
        return err(StatusCode::FORBIDDEN, "admin key required");
    }
    let id = body.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let Some(idx) = store.notes.iter().position(|n| n.id == id) else {
        return err(StatusCode::NOT_FOUND, "no such note");
    };
    let on = body.get("agentAccess").and_then(|v| v.as_bool()).unwrap_or(true);
    store.notes[idx].agent_access = on;
    let now = now_iso();
    store.writes.push(json!({"at": now, "by": "human", "op": "access", "note": id}));
    ok(StatusCode::OK, json!({"id": id, "agentAccess": on}))
}

async fn human_append(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let mut store = shared.write().unwrap();
    let Some(key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if key.kind != "admin" {
        return err(StatusCode::FORBIDDEN, "admin key required");
    }
    let id = body.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let text = body.get("text").and_then(|v| v.as_str()).unwrap_or("");
    let Some(idx) = store.notes.iter().position(|n| n.id == id) else {
        return err(StatusCode::NOT_FOUND, "no such note");
    };
    let now = now_iso();
    let out = {
        let note = &mut store.notes[idx];
        note.body = join_blocks(&note.body, text);
        note.rev = revision_of(&note.body);
        note.updated = now.clone();
        note.contributors = with_author(note.contributors.clone(), "human");
        json!({"id": note.id, "rev": note.rev, "by": note.contributors})
    };
    let note_id = out.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    store.writes.push(json!({"at": now, "by": "human", "op": "append", "note": note_id}));
    ok(StatusCode::OK, out)
}

async fn switch(
    State(shared): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let mut store = shared.write().unwrap();
    let Some(key) = caller(&headers, &store) else {
        return unauthorized(&store);
    };
    if key.kind != "admin" {
        return err(StatusCode::FORBIDDEN, "admin key required");
    }
    if let Some(global) = body.get("global").and_then(|v| v.as_bool()) {
        store.global = global;
    }
    if let Some(enabled) = body.get("enabled").and_then(|v| v.as_bool()) {
        for k in store.keys.values_mut() {
            if k.kind != "admin" {
                k.enabled = enabled;
            }
        }
    }
    ok(
        StatusCode::OK,
        json!({"global": store.global, "agentsEnabled": store.keys.values().any(|k| k.kind == "agent" && k.enabled)}),
    )
}

// ------------------------------------------------------------------------ the fixture

fn seed_notes() -> Vec<Note> {
    const SUBJECTS: [&str; 8] = [
        "Q3 planning", "Launch retro", "Pricing page", "Reading list",
        "Hiring loop", "Weekly review", "Churn notes", "Roadmap bets",
    ];
    let paragraph = "This note exists so the API has something realistic to hand back. It is long \
                     enough to matter when someone measures bytes, and dull enough that nobody \
                     mistakes it for content. ";
    (0..40)
        .map(|i| {
            let title = format!("{} {}", SUBJECTS[i % SUBJECTS.len()], i);
            let body = format!(
                "# {title}\n\n{}\n\n## What happened\n\n{}\n\n## What we decided\n\n1. {}\n2. {}\n",
                paragraph.repeat(2),
                paragraph.repeat(3),
                &paragraph[..90],
                &paragraph[..70]
            );
            Note {
                id: format!("note-{:03}", i),
                title,
                rev: revision_of(&body),
                body,
                created: format!("2026-09-{:02}T09:{:02}:00.000Z", 28 - (i % 27), 10 + i),
                updated: format!("2026-10-{:02}T18:{:02}:00.000Z", 28 - (i % 27), (i * 7) % 60),
                folder: if i % 5 == 0 { "work".into() } else { "private".into() },
                contributors: vec!["human".into()],
                tags: if i % 3 == 0 { vec!["planning".into()] } else { vec![] },
                agent_access: true,
            }
        })
        .collect()
}

#[tokio::main]
async fn main() {
    let port: u16 = std::env::args().nth(1).and_then(|p| p.parse().ok()).unwrap_or(8140);
    let (admin_id, admin_key, admin_hash) = token("cn_admin", 40);
    let (agent_id, agent_key, agent_hash) = token("cn_live", 40);

    let mut keys = HashMap::new();
    keys.insert(admin_hash, Key { id: admin_id, kind: "admin", write: true, enabled: true });
    keys.insert(agent_hash, Key { id: agent_id, kind: "agent", write: true, enabled: true });

    let mut notes = seed_notes();
    notes.sort_by(|a, b| b.updated.cmp(&a.updated));
    let bytes: usize = notes.iter().map(|n| n.body.len()).sum();

    let shared: Shared = Arc::new(RwLock::new(Store {
        base: format!("http://127.0.0.1:{port}"),
        seq: notes.len(),
        notes,
        keys,
        global: true,
        writes: Vec::new(),
        presence: HashMap::new(),
    }));

    let app = Router::new()
        .route("/api/agent", get(manifest))
        .route("/api/agent/notes", get(list_notes).post(create_note))
        .route("/api/agent/notes/:id", get(get_note).merge(patch(patch_note)))
        .route("/api/agent/search", get(search))
        .route("/api/agent/notes/:id/propose", post(propose))
        .route("/api/agent/notes/:id/presence", post(agent_presence))
        .route("/api/human/notes/:id/presence", get(human_presence))
        .route("/api/agent/switch", post(switch))
        .route("/api/human/notes/append", post(human_append))
        .route("/api/human/notes/access", post(human_access))
        .with_state(shared);

    println!("{}", json!({"listening": format!("http://127.0.0.1:{port}"), "notes": 40, "notebookBytes": bytes}));
    println!("AGENT_KEY={agent_key}");
    println!("ADMIN_KEY={admin_key}");

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
