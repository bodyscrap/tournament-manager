import Database from "@tauri-apps/plugin-sql";
import type {
  Player,
  PlayerRow,
  CharacterMaster,
  CharacterMasterRow,
  CharacterList,
  CharacterListRow,
  Tournament,
  TournamentRow,
  TournamentPlayer,
  TournamentPlayerRow,
  TournamentAdmin,
  TournamentAdminRow,
  MatchActionLog,
  MatchActionLogRow,
  MatchActionType,
  MatchActionConfirmerType,
  MatchActionAuthMode,
  Match,
  MatchRow,
  BracketTree,
  BracketTreeRow,
  MatchBracket,
  CharacterInputMode,
  TournamentCharacterSelectionConfig,
  TournamentDefaultPlayerSide,
  RoundLock,
  RoundLockRow,
  MatchPlayerSide,
  TournamentMessageRecord,
  TournamentMessageRecordRow,
  UnmatchedMessageRecord,
  UnmatchedMessageRecordRow,
} from "./types";
import { normalizeCharacterSelectionConfig } from "./characterSelection";

// ----------------------
// Singleton DB connection
// ----------------------
let _db: Database | null = null;

async function ensureTournamentAdminsTable(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tournament_admins (
      tournament_id   TEXT NOT NULL,
      admin_id        TEXT NOT NULL,
      admin_code      TEXT NOT NULL DEFAULT '',
      admin_sequence  INTEGER NOT NULL DEFAULT 0,
      admin_id_4      TEXT NOT NULL DEFAULT '0000',
      name            TEXT NOT NULL,
      attributes      TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL,
      PRIMARY KEY (tournament_id, admin_id)
    );
  `);
}

async function ensureMatchActionLogsTable(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS match_action_logs (
      id                 TEXT PRIMARY KEY,
      tournament_id      TEXT NOT NULL,
      match_id           TEXT NOT NULL,
      action_type        TEXT NOT NULL,
      target_player_id   TEXT,
      confirmed_by_type  TEXT NOT NULL,
      confirmed_by_id    TEXT NOT NULL,
      confirmed_by_name  TEXT NOT NULL,
      confirmed_by_code  TEXT NOT NULL,
      created_at         TEXT NOT NULL
    );
  `);
}

async function ensureTournamentMessagesTable(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tournament_messages (
      id                    TEXT NOT NULL,
      tournament_id         TEXT NOT NULL,
      event_code            TEXT NOT NULL,
      source_tournament_id  TEXT NOT NULL,
      source_tournament_db_id TEXT,
      source_tournament_name TEXT NOT NULL,
      attribute             TEXT NOT NULL,
      title                 TEXT NOT NULL,
      body                  TEXT NOT NULL,
      comment               TEXT,
      target_tournament_ids_json TEXT,
      target_player_id      TEXT,
      target_player_name    TEXT,
      target_user_code      TEXT,
      requested_tournament_id TEXT,
      match_card_id         TEXT,
      match_slot            INTEGER,
      remote_dq_target_player_id TEXT,
      remote_dq_target_player_name TEXT,
      remote_dq_target_user_code TEXT,
      remote_dq_requested_by_tournament_id TEXT,
      remote_dq_requested_by_tournament_name TEXT,
      remote_dq_for_all_matches INTEGER NOT NULL DEFAULT 0,
      remote_dq_approved    INTEGER NOT NULL DEFAULT 0,
      is_duplicate_tournament_id INTEGER,
      thread_id             TEXT,
      parent_message_id     TEXT,
      root_message_id       TEXT,
      thread_resolved       INTEGER NOT NULL DEFAULT 0,
      thread_resolved_at    TEXT,
      thread_resolved_by_tournament_id TEXT,
      thread_resolved_by_tournament_name TEXT,
      direction             TEXT NOT NULL DEFAULT 'received',
      timestamp             TEXT NOT NULL,
      created_at            TEXT NOT NULL,
      PRIMARY KEY (id, tournament_id)
    );
  `);

  // Migration: add direction column when missing.
  try {
    await db.execute(`ALTER TABLE tournament_messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'received'`);
  } catch {
    // exists
  }
  try { await db.execute(`ALTER TABLE tournament_messages ADD COLUMN match_card_id TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE tournament_messages ADD COLUMN match_slot INTEGER`); } catch {}
  try { await db.execute(`ALTER TABLE tournament_messages ADD COLUMN remote_dq_target_player_id TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE tournament_messages ADD COLUMN remote_dq_target_player_name TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE tournament_messages ADD COLUMN remote_dq_target_user_code TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE tournament_messages ADD COLUMN remote_dq_requested_by_tournament_id TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE tournament_messages ADD COLUMN remote_dq_requested_by_tournament_name TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE tournament_messages ADD COLUMN remote_dq_for_all_matches INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { await db.execute(`ALTER TABLE tournament_messages ADD COLUMN remote_dq_approved INTEGER NOT NULL DEFAULT 0`); } catch {}
  try {
    await db.execute(`ALTER TABLE tournament_messages ADD COLUMN thread_resolved INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // exists
  }
  try {
    await db.execute(`ALTER TABLE tournament_messages ADD COLUMN thread_resolved_at TEXT`);
  } catch {
    // exists
  }
  try {
    await db.execute(`ALTER TABLE tournament_messages ADD COLUMN thread_resolved_by_tournament_id TEXT`);
  } catch {
    // exists
  }
  try {
    await db.execute(`ALTER TABLE tournament_messages ADD COLUMN thread_resolved_by_tournament_name TEXT`);
  } catch {
    // exists
  }

  // Migration: old schema used `id` as single primary key, which prevented
  // storing one incoming message into multiple local tournaments.
  try {
    const columns = await db.select<Array<{ name: string; pk: number }>>(
      "PRAGMA table_info(tournament_messages)"
    );
    const idPk = columns.find((c) => c.name === "id")?.pk ?? 0;
    const tournamentPk = columns.find((c) => c.name === "tournament_id")?.pk ?? 0;
    const needsRebuild = idPk === 1 && tournamentPk === 0;

    if (needsRebuild) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS tournament_messages_v2 (
          id                    TEXT NOT NULL,
          tournament_id         TEXT NOT NULL,
          event_code            TEXT NOT NULL,
          source_tournament_id  TEXT NOT NULL,
          source_tournament_db_id TEXT,
          source_tournament_name TEXT NOT NULL,
          attribute             TEXT NOT NULL,
          title                 TEXT NOT NULL,
          body                  TEXT NOT NULL,
          comment               TEXT,
          target_tournament_ids_json TEXT,
          target_player_id      TEXT,
          target_player_name    TEXT,
          target_user_code      TEXT,
          requested_tournament_id TEXT,
          match_card_id         TEXT,
          match_slot            INTEGER,
          remote_dq_target_player_id TEXT,
          remote_dq_target_player_name TEXT,
          remote_dq_target_user_code TEXT,
          remote_dq_requested_by_tournament_id TEXT,
          remote_dq_requested_by_tournament_name TEXT,
          remote_dq_for_all_matches INTEGER NOT NULL DEFAULT 0,
          remote_dq_approved    INTEGER NOT NULL DEFAULT 0,
          is_duplicate_tournament_id INTEGER,
          thread_id             TEXT,
          parent_message_id     TEXT,
          root_message_id       TEXT,
          thread_resolved       INTEGER NOT NULL DEFAULT 0,
          thread_resolved_at    TEXT,
          thread_resolved_by_tournament_id TEXT,
          thread_resolved_by_tournament_name TEXT,
          direction             TEXT NOT NULL,
          timestamp             TEXT NOT NULL,
          created_at            TEXT NOT NULL,
          PRIMARY KEY (id, tournament_id)
        );
      `);
      await db.execute(`
        INSERT OR IGNORE INTO tournament_messages_v2 (
          id, tournament_id, event_code, source_tournament_id, source_tournament_db_id,
          source_tournament_name, attribute, title, body, comment, target_tournament_ids_json,
          target_player_id, target_player_name, target_user_code, requested_tournament_id,
          match_card_id, match_slot, remote_dq_target_player_id, remote_dq_target_player_name,
          remote_dq_target_user_code, remote_dq_requested_by_tournament_id, remote_dq_requested_by_tournament_name, remote_dq_for_all_matches, remote_dq_approved,
          is_duplicate_tournament_id, thread_id, parent_message_id, root_message_id,
          thread_resolved, thread_resolved_at, thread_resolved_by_tournament_id, thread_resolved_by_tournament_name,
          direction, timestamp, created_at
        )
        SELECT
          id, tournament_id, event_code, source_tournament_id, source_tournament_db_id,
          source_tournament_name, attribute, title, body, comment, target_tournament_ids_json,
          target_player_id, target_player_name, target_user_code, requested_tournament_id,
          match_card_id, match_slot, remote_dq_target_player_id, remote_dq_target_player_name,
          remote_dq_target_user_code, remote_dq_requested_by_tournament_id, remote_dq_requested_by_tournament_name, COALESCE(remote_dq_for_all_matches, 0), COALESCE(remote_dq_approved, 0),
          is_duplicate_tournament_id, thread_id, parent_message_id, root_message_id,
          COALESCE(thread_resolved, 0), thread_resolved_at, thread_resolved_by_tournament_id, thread_resolved_by_tournament_name,
          direction, timestamp, created_at
        FROM tournament_messages;
      `);
      await db.execute(`DROP TABLE tournament_messages`);
      await db.execute(`ALTER TABLE tournament_messages_v2 RENAME TO tournament_messages`);
    }
  } catch {
    // Keep app usable even if migration introspection fails.
  }
}

async function ensureUnmatchedMessagesTable(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS unmatched_messages (
      id                    TEXT PRIMARY KEY,
      event_code            TEXT NOT NULL,
      source_tournament_id  TEXT NOT NULL,
      source_tournament_db_id TEXT,
      source_tournament_name TEXT NOT NULL,
      attribute             TEXT NOT NULL,
      title                 TEXT NOT NULL,
      body                  TEXT NOT NULL,
      comment               TEXT,
      target_tournament_ids_json TEXT,
      target_player_id      TEXT,
      target_player_name    TEXT,
      target_user_code      TEXT,
      requested_tournament_id TEXT,
      match_card_id         TEXT,
      match_slot            INTEGER,
      remote_dq_target_player_id TEXT,
      remote_dq_target_player_name TEXT,
      remote_dq_target_user_code TEXT,
      remote_dq_requested_by_tournament_id TEXT,
      remote_dq_requested_by_tournament_name TEXT,
      remote_dq_for_all_matches INTEGER NOT NULL DEFAULT 0,
      remote_dq_approved    INTEGER NOT NULL DEFAULT 0,
      is_duplicate_tournament_id INTEGER,
      thread_id             TEXT,
      parent_message_id     TEXT,
      root_message_id       TEXT,
      thread_resolved       INTEGER NOT NULL DEFAULT 0,
      thread_resolved_at    TEXT,
      thread_resolved_by_tournament_id TEXT,
      thread_resolved_by_tournament_name TEXT,
      timestamp             TEXT NOT NULL,
      created_at            TEXT NOT NULL
    );
  `);

  try {
    await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN thread_resolved INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // exists
  }
  try { await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN match_card_id TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN match_slot INTEGER`); } catch {}
  try { await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN remote_dq_target_player_id TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN remote_dq_target_player_name TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN remote_dq_target_user_code TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN remote_dq_requested_by_tournament_id TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN remote_dq_requested_by_tournament_name TEXT`); } catch {}
  try { await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN remote_dq_for_all_matches INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN remote_dq_approved INTEGER NOT NULL DEFAULT 0`); } catch {}
  try {
    await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN thread_resolved_at TEXT`);
  } catch {
    // exists
  }
  try {
    await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN thread_resolved_by_tournament_id TEXT`);
  } catch {
    // exists
  }
  try {
    await db.execute(`ALTER TABLE unmatched_messages ADD COLUMN thread_resolved_by_tournament_name TEXT`);
  } catch {
    // exists
  }
}

export async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load("sqlite:tournament.db");
    await initSchema(_db);
  }
  return _db;
}

// ----------------------
// Schema initialisation
// ----------------------
async function initSchema(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS players (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      character_name TEXT,
      attributes    TEXT NOT NULL DEFAULT '{}',
      dq            INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS character_master (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS character_lists (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      category_name  TEXT NOT NULL DEFAULT 'キャラクター',
      characters_json TEXT NOT NULL DEFAULT '[]',
      created_at     TEXT NOT NULL,
      UNIQUE(name, category_name)
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tournament (
      id                 TEXT PRIMARY KEY,
      event_code         TEXT NOT NULL DEFAULT '0000',
      tournament_code    TEXT NOT NULL DEFAULT '0000',
      type               TEXT NOT NULL,
      max_participants   INTEGER NOT NULL DEFAULT 256,
      status             TEXT NOT NULL DEFAULT 'setup',
      grand_final_reset  INTEGER NOT NULL DEFAULT 1,
      character_input_mode TEXT NOT NULL DEFAULT 'free_input',
      default_player_side TEXT NOT NULL DEFAULT 'upper_1p',
      result_auth_mode   TEXT NOT NULL DEFAULT 'none',
      forfeit_auth_mode       TEXT NOT NULL DEFAULT 'target_player',
      dq_auth_mode TEXT NOT NULL DEFAULT 'admin',
      character_list_json TEXT,
      character_selection_config_json TEXT,
      created_at         TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tournament_players (
      tournament_id TEXT NOT NULL,
      player_id     TEXT NOT NULL,
      player_code   TEXT NOT NULL DEFAULT '',
      player_sequence INTEGER NOT NULL DEFAULT 0,
      player_id_4   TEXT NOT NULL DEFAULT '0000',
      seed          INTEGER NOT NULL,
      PRIMARY KEY (tournament_id, player_id)
    );
  `);

  await ensureTournamentAdminsTable(db);
  await ensureMatchActionLogsTable(db);
  await ensureTournamentMessagesTable(db);
  await ensureUnmatchedMessagesTable(db);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS matches (
      id                     TEXT PRIMARY KEY,
      tournament_id          TEXT NOT NULL,
      tree_id                TEXT NOT NULL DEFAULT '',
      round                  INTEGER NOT NULL,
      position               INTEGER NOT NULL,
      bracket                TEXT NOT NULL,
      player1_id             TEXT,
      player2_id             TEXT,
      winner_id              TEXT,
      player1_wins           INTEGER NOT NULL DEFAULT 0,
      player2_wins           INTEGER NOT NULL DEFAULT 0,
      player1_character_name TEXT,
      player2_character_name TEXT,
      player1_side           TEXT NOT NULL DEFAULT '1P',
      player2_side           TEXT NOT NULL DEFAULT '2P',
      status                 TEXT NOT NULL DEFAULT 'pending',
      result_finalized_at    TEXT,
      forfeit_player_id           TEXT,
      next_match_id          TEXT,
      next_match_slot        INTEGER,
      loser_next_match_id    TEXT,
      loser_next_match_slot  INTEGER
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bracket_trees (
      id            TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL,
      name          TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS round_locks (
      tournament_id TEXT NOT NULL,
      tree_id       TEXT NOT NULL,
      bracket       TEXT NOT NULL,
      round         INTEGER NOT NULL,
      locked        INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (tournament_id, tree_id, bracket, round)
    );
  `);

  // Migration: add name column to tournament if missing
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN name TEXT NOT NULL DEFAULT '大会'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN tournament_code TEXT NOT NULL DEFAULT '0000'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN character_input_mode TEXT NOT NULL DEFAULT 'free_input'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN default_player_side TEXT NOT NULL DEFAULT 'upper_1p'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN result_auth_mode TEXT NOT NULL DEFAULT 'none'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN forfeit_auth_mode TEXT NOT NULL DEFAULT 'target_player'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN dq_auth_mode TEXT NOT NULL DEFAULT 'admin'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN character_list_name TEXT`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN character_list_json TEXT`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN character_selection_config_json TEXT`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament ADD COLUMN event_code TEXT NOT NULL DEFAULT '0000'`);
  } catch { /* exists */ }
  await db.execute(`UPDATE tournament SET event_code = printf('%04d', CAST(event_code AS INTEGER)) WHERE event_code IS NOT NULL AND length(event_code) < 4`);

  // Migration: extend character_lists to item-list schema (name + category_name)
  let characterListsNeedsRebuild = false;
  try {
    await db.execute(`ALTER TABLE character_lists ADD COLUMN category_name TEXT NOT NULL DEFAULT 'キャラクター'`);
    characterListsNeedsRebuild = true;
  } catch { /* exists */ }
  if (characterListsNeedsRebuild) {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS character_lists_v2 (
          id              TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          category_name   TEXT NOT NULL DEFAULT 'キャラクター',
          characters_json TEXT NOT NULL DEFAULT '[]',
          created_at      TEXT NOT NULL,
          UNIQUE(name, category_name)
        );
      `);
      await db.execute(`
        INSERT OR IGNORE INTO character_lists_v2 (id, name, category_name, characters_json, created_at)
        SELECT id, name, COALESCE(NULLIF(category_name, ''), 'キャラクター'), characters_json, created_at
        FROM character_lists;
      `);
      await db.execute(`DROP TABLE character_lists`);
      await db.execute(`ALTER TABLE character_lists_v2 RENAME TO character_lists`);
    } catch {
      // ignore migration failures to keep backward compatibility
    }
  }

  // Migration: add per-tournament participant fields
  try {
    await db.execute(`ALTER TABLE tournament_players ADD COLUMN name TEXT NOT NULL DEFAULT ''`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament_players ADD COLUMN character_name TEXT`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament_players ADD COLUMN attributes TEXT NOT NULL DEFAULT '{}'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament_players ADD COLUMN dq INTEGER NOT NULL DEFAULT 0`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament_players ADD COLUMN player_code TEXT NOT NULL DEFAULT ''`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament_players ADD COLUMN player_sequence INTEGER NOT NULL DEFAULT 0`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament_players ADD COLUMN player_id_4 TEXT NOT NULL DEFAULT '0000'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE tournament_players ADD COLUMN selected_characters_json TEXT`);
  } catch { /* exists */ }
  // Migration: add tree_id to matches
  try {
    await db.execute(`ALTER TABLE matches ADD COLUMN tree_id TEXT NOT NULL DEFAULT ''`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE matches ADD COLUMN player1_character_name TEXT`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE matches ADD COLUMN player2_character_name TEXT`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE matches ADD COLUMN player1_side TEXT NOT NULL DEFAULT '1P'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE matches ADD COLUMN player2_side TEXT NOT NULL DEFAULT '2P'`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE matches ADD COLUMN result_finalized_at TEXT`);
  } catch { /* exists */ }
  try {
    await db.execute(`ALTER TABLE matches ADD COLUMN forfeit_player_id TEXT`);
  } catch { /* exists */ }
  try {
    // 旧カラム dq_player_id から新カラムへ移送（旧DB互換）
    await db.execute(
      `UPDATE matches
       SET forfeit_player_id = dq_player_id
       WHERE forfeit_player_id IS NULL AND dq_player_id IS NOT NULL`
    );
  } catch { /* dq_player_id が無い新規DBでは失敗して問題なし */ }

  try {
    // 旧命名 -> 新命名の認証モードを移送（旧DB互換）
    await db.execute(
      `UPDATE tournament
       SET forfeit_auth_mode = dq_auth_mode
       WHERE (forfeit_auth_mode IS NULL OR forfeit_auth_mode = '')
         AND dq_auth_mode IS NOT NULL`
    );
  } catch { /* ignore */ }
  try {
    await db.execute(
      `UPDATE tournament
       SET dq_auth_mode = forced_loss_auth_mode
       WHERE forced_loss_auth_mode IS NOT NULL`
    );
  } catch { /* forced_loss_auth_mode が無い新規DBでは失敗して問題なし */ }
}

// ----------------------
// Player helpers
// ----------------------
function rowToPlayer(row: PlayerRow): Player {
  let attributes: Record<string, string> = {};
  try {
    attributes = JSON.parse(row.attributes);
  } catch {
    // ignore
  }
  return {
    id: row.id,
    name: row.name,
    character_name: row.character_name,
    attributes,
    dq: row.dq === 1,
    created_at: row.created_at,
  };
}

export async function getAllPlayers(): Promise<Player[]> {
  const db = await getDb();
  const rows = await db.select<PlayerRow[]>(
    "SELECT * FROM players ORDER BY created_at ASC"
  );
  return rows.map(rowToPlayer);
}

export async function getPlayerById(id: string): Promise<Player | null> {
  const db = await getDb();
  const rows = await db.select<PlayerRow[]>(
    "SELECT * FROM players WHERE id = $1",
    [id]
  );
  return rows.length > 0 ? rowToPlayer(rows[0]) : null;
}

export async function createPlayer(
  id: string,
  name: string,
  character_name: string | null,
  attributes: Record<string, string>
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO players (id, name, character_name, attributes, dq, created_at)
     VALUES ($1, $2, $3, $4, 0, $5)`,
    [id, name, character_name, JSON.stringify(attributes), new Date().toISOString()]
  );
}

export async function updatePlayer(
  id: string,
  name: string,
  character_name: string | null,
  attributes: Record<string, string>
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE players SET name = $1, character_name = $2, attributes = $3 WHERE id = $4`,
    [name, character_name, JSON.stringify(attributes), id]
  );
}

export async function setPlayerDq(id: string, dq: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE players SET dq = $1 WHERE id = $2`, [dq ? 1 : 0, id]);
}

export async function deletePlayer(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM players WHERE id = $1`, [id]);
}

// ----------------------
// Character master helpers
// ----------------------
function rowToCharacterMaster(row: CharacterMasterRow): CharacterMaster {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
  };
}

export async function getCharacterMasters(): Promise<CharacterMaster[]> {
  const db = await getDb();
  const rows = await db.select<CharacterMasterRow[]>(
    "SELECT * FROM character_master ORDER BY name COLLATE NOCASE ASC"
  );
  return rows.map(rowToCharacterMaster);
}

export async function createCharacterMaster(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO character_master (id, name, created_at) VALUES ($1, $2, $3)`,
    [id, name, new Date().toISOString()]
  );
}

export async function deleteCharacterMaster(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM character_master WHERE id = $1`, [id]);
}

function rowToCharacterList(row: CharacterListRow): CharacterList {
  let items: string[] = [];
  try {
    const parsed = JSON.parse(row.characters_json);
    if (Array.isArray(parsed)) {
      items = parsed
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter((v) => v.length > 0);
    }
  } catch {
    // ignore invalid json
  }
  return {
    id: row.id,
    name: row.name,
    category_name: row.category_name?.trim() || "キャラクター",
    items,
    created_at: row.created_at,
  };
}

export async function getCharacterLists(): Promise<CharacterList[]> {
  const db = await getDb();
  const rows = await db.select<CharacterListRow[]>(
    "SELECT * FROM character_lists ORDER BY name COLLATE NOCASE ASC"
  );
  return rows.map(rowToCharacterList);
}

export async function createCharacterList(
  id: string,
  name: string,
  category_name: string,
  items: string[]
): Promise<void> {
  const db = await getDb();
  const normalized = normalizeCharacterList(items);
  const normalizedCategory = category_name.trim() || "キャラクター";
  await db.execute(
    `INSERT INTO character_lists (id, name, category_name, characters_json, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [id, name, normalizedCategory, JSON.stringify(normalized), new Date().toISOString()]
  );
}

export async function updateCharacterList(
  id: string,
  name: string,
  category_name: string,
  items: string[]
): Promise<void> {
  const db = await getDb();
  const normalized = normalizeCharacterList(items);
  const normalizedCategory = category_name.trim() || "キャラクター";
  await db.execute(
    `UPDATE character_lists SET name = $1, category_name = $2, characters_json = $3 WHERE id = $4`,
    [name, normalizedCategory, JSON.stringify(normalized), id]
  );
}

export async function deleteCharacterList(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM character_lists WHERE id = $1`, [id]);
}

// ----------------------
// Tournament helpers
// ----------------------
function rowToTournament(row: TournamentRow): Tournament {
  let characterList: string[] = [];
  if (row.character_list_json) {
    try {
      const parsed = JSON.parse(row.character_list_json);
      if (Array.isArray(parsed)) {
        characterList = parsed
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter((v) => v.length > 0);
      }
    } catch {
      // ignore invalid json
    }
  }

  let parsedConfig: TournamentCharacterSelectionConfig | null = null;
  if (row.character_selection_config_json) {
    try {
      parsedConfig = JSON.parse(row.character_selection_config_json);
    } catch {
      parsedConfig = null;
    }
  }

  const normalizedConfig = normalizeCharacterSelectionConfig(
    row.character_input_mode ?? "free_input",
    parsedConfig,
    row.character_list_name ?? null,
    characterList
  );

  const flattenedCharacterList = normalizedConfig.categories.length > 0
    ? [...new Set(normalizedConfig.categories.flatMap((cat) => cat.list))]
    : characterList;

  return {
    id: row.id,
    name: row.name,
    event_code: row.event_code ?? "0000",
    tournament_code: row.tournament_code ?? "0000",
    type: row.type,
    max_participants: row.max_participants,
    status: row.status,
    grand_final_reset: row.grand_final_reset === 1,
    character_input_mode: row.character_input_mode ?? "free_input",
    character_list_name: row.character_list_name ?? null,
    character_list: flattenedCharacterList,
    character_selection_config: normalizedConfig,
    default_player_side: row.default_player_side ?? "upper_1p",
    result_auth_mode: (row.result_auth_mode ?? "none") as MatchActionAuthMode,
    forfeit_auth_mode: ((row.forfeit_auth_mode ?? "target_player") === "admin_or_participant"
      ? "target_player"
      : (row.forfeit_auth_mode ?? "target_player")) as MatchActionAuthMode,
    dq_auth_mode: ((row.dq_auth_mode ?? "admin") === "admin_or_participant"
      ? "target_player"
      : (row.dq_auth_mode ?? "admin")) as MatchActionAuthMode,
    created_at: row.created_at,
  };
}

function normalizeCharacterList(character_list: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of character_list) {
    const name = raw.trim();
    if (!name) continue;
    unique.add(name);
  }
  return [...unique];
}

export async function getAllTournaments(): Promise<Tournament[]> {
  const db = await getDb();
  const rows = await db.select<TournamentRow[]>(
    "SELECT * FROM tournament ORDER BY created_at DESC"
  );
  return rows.map(rowToTournament);
}

export async function getTournamentById(id: string): Promise<Tournament | null> {
  const db = await getDb();
  const rows = await db.select<TournamentRow[]>(
    "SELECT * FROM tournament WHERE id = $1",
    [id]
  );
  return rows.length > 0 ? rowToTournament(rows[0]) : null;
}

export async function createTournament(
  id: string,
  event_code: string,
  tournament_code: string,
  type: "single_elimination" | "double_elimination",
  max_participants: number,
  grand_final_reset: boolean,
  name: string,
  character_input_mode: CharacterInputMode,
  character_list_name: string | null,
  character_list: string[],
  character_selection_config: TournamentCharacterSelectionConfig | null,
  default_player_side: TournamentDefaultPlayerSide,
  result_auth_mode: MatchActionAuthMode,
  forfeit_auth_mode: MatchActionAuthMode,
  dq_auth_mode: MatchActionAuthMode
): Promise<void> {
  const db = await getDb();
  const normalizedList = normalizeCharacterList(character_list);
  const normalizedConfig = normalizeCharacterSelectionConfig(
    character_input_mode,
    character_selection_config,
    character_list_name,
    normalizedList
  );
  const listJson = character_input_mode === "list_selection"
    ? JSON.stringify([...new Set(normalizedConfig.categories.flatMap((cat) => cat.list))])
    : null;
  const listName = character_input_mode === "list_selection"
    ? (character_list_name?.trim() || normalizedConfig.categories[0]?.list_name || "カスタムリスト")
    : null;
  const selectionConfigJson = JSON.stringify(normalizedConfig);
  await db.execute(
    `INSERT INTO tournament (id, name, event_code, tournament_code, type, max_participants, status, grand_final_reset, character_input_mode, default_player_side, result_auth_mode, forfeit_auth_mode, dq_auth_mode, character_list_name, character_list_json, character_selection_config_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'setup', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      id,
      name,
      event_code,
      tournament_code,
      type,
      max_participants,
      grand_final_reset ? 1 : 0,
      character_input_mode,
      default_player_side,
      result_auth_mode,
      forfeit_auth_mode,
      dq_auth_mode,
      listName,
      listJson,
      selectionConfigJson,
      new Date().toISOString(),
    ]
  );
}

export async function updateTournamentStatus(
  id: string,
  status: "setup" | "in_progress" | "completed" | "finalized"
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE tournament SET status = $1 WHERE id = $2`, [status, id]);
}

export async function updateTournamentSettings(
  id: string,
  event_code: string,
  tournament_code: string,
  type: "single_elimination" | "double_elimination",
  max_participants: number,
  grand_final_reset: boolean,
  character_input_mode: CharacterInputMode,
  character_list_name: string | null,
  character_list: string[],
  character_selection_config: TournamentCharacterSelectionConfig | null,
  default_player_side: TournamentDefaultPlayerSide,
  result_auth_mode: MatchActionAuthMode,
  forfeit_auth_mode: MatchActionAuthMode,
  dq_auth_mode: MatchActionAuthMode
): Promise<void> {
  const db = await getDb();
  const normalizedList = normalizeCharacterList(character_list);
  const normalizedConfig = normalizeCharacterSelectionConfig(
    character_input_mode,
    character_selection_config,
    character_list_name,
    normalizedList
  );
  const listJson = character_input_mode === "list_selection"
    ? JSON.stringify([...new Set(normalizedConfig.categories.flatMap((cat) => cat.list))])
    : null;
  const listName = character_input_mode === "list_selection"
    ? (character_list_name?.trim() || normalizedConfig.categories[0]?.list_name || "カスタムリスト")
    : null;
  const selectionConfigJson = JSON.stringify(normalizedConfig);
  await db.execute(
    `UPDATE tournament
     SET type = $1,
         event_code = $2,
         tournament_code = $3,
         max_participants = $4,
         grand_final_reset = $5,
         character_input_mode = $6,
         default_player_side = $7,
         result_auth_mode = $8,
         forfeit_auth_mode = $9,
         dq_auth_mode = $10,
         character_list_name = $11,
         character_list_json = $12,
         character_selection_config_json = $13
       WHERE id = $14`,
    [
      type,
      event_code,
      tournament_code,
      max_participants,
      grand_final_reset ? 1 : 0,
      character_input_mode,
      default_player_side,
      result_auth_mode,
      forfeit_auth_mode,
      dq_auth_mode,
      listName,
      listJson,
      selectionConfigJson,
      id,
    ]
  );
}

export async function deleteTournament(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM tournament_players WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM tournament_admins WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM matches WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM bracket_trees WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM round_locks WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM match_action_logs WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM tournament_messages WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM tournament WHERE id = $1`, [id]);
}

export async function getTournamentsByEventCode(event_code: string): Promise<Tournament[]> {
  const db = await getDb();
  const rows = await db.select<TournamentRow[]>(
    "SELECT * FROM tournament WHERE event_code = $1 ORDER BY created_at DESC",
    [event_code]
  );
  return rows.map(rowToTournament);
}

export async function hasTournamentMessageById(id: string): Promise<boolean> {
  const db = await getDb();
  await ensureTournamentMessagesTable(db);
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(1) as count FROM tournament_messages WHERE id = $1",
    [id]
  );
  return (rows[0]?.count ?? 0) > 0;
}

function rowToTournamentMessage(row: TournamentMessageRecordRow): TournamentMessageRecord {
  let targetTournamentIds: string[] = [];
  if (row.target_tournament_ids_json) {
    try {
      const parsed = JSON.parse(row.target_tournament_ids_json);
      if (Array.isArray(parsed)) {
        targetTournamentIds = parsed
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value) => value.length > 0);
      }
    } catch {
      targetTournamentIds = [];
    }
  }

  return {
    id: row.id,
    tournament_id: row.tournament_id,
    event_code: row.event_code,
    source_tournament_db_id: row.source_tournament_db_id,
    source_tournament_id: row.source_tournament_id,
    source_tournament_name: row.source_tournament_name,
    attribute: row.attribute,
    title: row.title,
    body: row.body,
    comment: row.comment,
    target_tournament_ids: targetTournamentIds,
    target_player_id: row.target_player_id,
    target_player_name: row.target_player_name,
    target_user_code: row.target_user_code,
    requested_tournament_id: row.requested_tournament_id,
    match_card_id: row.match_card_id,
    match_slot: row.match_slot,
    remote_dq_target_player_id: row.remote_dq_target_player_id,
    remote_dq_target_player_name: row.remote_dq_target_player_name,
    remote_dq_target_user_code: row.remote_dq_target_user_code,
    remote_dq_requested_by_tournament_id: row.remote_dq_requested_by_tournament_id,
    remote_dq_requested_by_tournament_name: row.remote_dq_requested_by_tournament_name,
    remote_dq_for_all_matches: row.remote_dq_for_all_matches === 1,
    remote_dq_approved: row.remote_dq_approved === 1,
    is_duplicate_tournament_id: row.is_duplicate_tournament_id === 1,
    thread_id: row.thread_id,
    parent_message_id: row.parent_message_id,
    root_message_id: row.root_message_id,
    thread_resolved: row.thread_resolved === 1,
    thread_resolved_at: row.thread_resolved_at,
    thread_resolved_by_tournament_id: row.thread_resolved_by_tournament_id,
    thread_resolved_by_tournament_name: row.thread_resolved_by_tournament_name,
    direction: row.direction,
    timestamp: row.timestamp,
    created_at: row.created_at,
  };
}

export async function getTournamentMessages(tournament_id: string): Promise<TournamentMessageRecord[]> {
  const db = await getDb();
  await ensureTournamentMessagesTable(db);
  const rows = await db.select<TournamentMessageRecordRow[]>(
    "SELECT * FROM tournament_messages WHERE tournament_id = $1 ORDER BY created_at DESC",
    [tournament_id]
  );
  return rows.map(rowToTournamentMessage);
}

export async function insertTournamentMessage(record: TournamentMessageRecord): Promise<void> {
  const db = await getDb();
  await ensureTournamentMessagesTable(db);
  await db.execute(
    `INSERT OR IGNORE INTO tournament_messages (
      id, tournament_id, event_code, source_tournament_id, source_tournament_db_id,
      source_tournament_name, attribute, title, body, comment, target_tournament_ids_json,
      target_player_id, target_player_name, target_user_code, requested_tournament_id,
      match_card_id, match_slot, remote_dq_target_player_id, remote_dq_target_player_name,
      remote_dq_target_user_code, remote_dq_requested_by_tournament_id, remote_dq_requested_by_tournament_name, remote_dq_for_all_matches, remote_dq_approved,
      is_duplicate_tournament_id, thread_id, parent_message_id, root_message_id,
      thread_resolved, thread_resolved_at, thread_resolved_by_tournament_id, thread_resolved_by_tournament_name,
      direction, timestamp, created_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15,
      $16, $17, $18, $19,
      $20, $21, $22, $23, $24,
      $25, $26, $27, $28,
      $29, $30, $31, $32,
      $33, $34, $35
    )`,
    [
      record.id,
      record.tournament_id,
      record.event_code,
      record.source_tournament_id,
      record.source_tournament_db_id,
      record.source_tournament_name,
      record.attribute,
      record.title,
      record.body,
      record.comment,
      JSON.stringify(record.target_tournament_ids ?? []),
      record.target_player_id,
      record.target_player_name,
      record.target_user_code,
      record.requested_tournament_id,
      record.match_card_id,
      record.match_slot,
      record.remote_dq_target_player_id,
      record.remote_dq_target_player_name,
      record.remote_dq_target_user_code,
      record.remote_dq_requested_by_tournament_id,
      record.remote_dq_requested_by_tournament_name,
      record.remote_dq_for_all_matches ? 1 : 0,
      record.remote_dq_approved ? 1 : 0,
      record.is_duplicate_tournament_id ? 1 : 0,
      record.thread_id,
      record.parent_message_id,
      record.root_message_id,
      record.thread_resolved ? 1 : 0,
      record.thread_resolved_at,
      record.thread_resolved_by_tournament_id,
      record.thread_resolved_by_tournament_name,
      record.direction,
      record.timestamp,
      new Date().toISOString(),
    ]
  );
}

export async function deleteTournamentMessageThread(
  tournament_id: string,
  thread_id: string
): Promise<void> {
  const db = await getDb();
  await ensureTournamentMessagesTable(db);
  await db.execute(
    `DELETE FROM tournament_messages
     WHERE tournament_id = $1
       AND (id = $2 OR thread_id = $2 OR root_message_id = $2)`,
    [tournament_id, thread_id]
  );
}

function rowToUnmatchedMessage(row: UnmatchedMessageRecordRow): UnmatchedMessageRecord {
  let targetTournamentIds: string[] = [];
  if (row.target_tournament_ids_json) {
    try {
      const parsed = JSON.parse(row.target_tournament_ids_json);
      if (Array.isArray(parsed)) {
        targetTournamentIds = parsed
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value) => value.length > 0);
      }
    } catch {
      targetTournamentIds = [];
    }
  }

  return {
    id: row.id,
    event_code: row.event_code,
    source_tournament_db_id: row.source_tournament_db_id,
    source_tournament_id: row.source_tournament_id,
    source_tournament_name: row.source_tournament_name,
    attribute: row.attribute,
    title: row.title,
    body: row.body,
    comment: row.comment,
    target_tournament_ids: targetTournamentIds,
    target_player_id: row.target_player_id,
    target_player_name: row.target_player_name,
    target_user_code: row.target_user_code,
    requested_tournament_id: row.requested_tournament_id,
    match_card_id: row.match_card_id,
    match_slot: row.match_slot,
    remote_dq_target_player_id: row.remote_dq_target_player_id,
    remote_dq_target_player_name: row.remote_dq_target_player_name,
    remote_dq_target_user_code: row.remote_dq_target_user_code,
    remote_dq_requested_by_tournament_id: row.remote_dq_requested_by_tournament_id,
    remote_dq_requested_by_tournament_name: row.remote_dq_requested_by_tournament_name,
    remote_dq_for_all_matches: row.remote_dq_for_all_matches === 1,
    remote_dq_approved: row.remote_dq_approved === 1,
    is_duplicate_tournament_id: row.is_duplicate_tournament_id === 1,
    thread_id: row.thread_id,
    parent_message_id: row.parent_message_id,
    root_message_id: row.root_message_id,
    thread_resolved: row.thread_resolved === 1,
    thread_resolved_at: row.thread_resolved_at,
    thread_resolved_by_tournament_id: row.thread_resolved_by_tournament_id,
    thread_resolved_by_tournament_name: row.thread_resolved_by_tournament_name,
    timestamp: row.timestamp,
    created_at: row.created_at,
  };
}

export async function getUnmatchedMessages(): Promise<UnmatchedMessageRecord[]> {
  const db = await getDb();
  await ensureUnmatchedMessagesTable(db);
  const rows = await db.select<UnmatchedMessageRecordRow[]>(
    "SELECT * FROM unmatched_messages ORDER BY created_at DESC"
  );
  return rows.map(rowToUnmatchedMessage);
}

export async function insertUnmatchedMessage(record: UnmatchedMessageRecord): Promise<void> {
  const db = await getDb();
  await ensureUnmatchedMessagesTable(db);
  await db.execute(
    `INSERT OR IGNORE INTO unmatched_messages (
      id, event_code, source_tournament_id, source_tournament_db_id,
      source_tournament_name, attribute, title, body, comment, target_tournament_ids_json,
      target_player_id, target_player_name, target_user_code, requested_tournament_id,
      match_card_id, match_slot, remote_dq_target_player_id, remote_dq_target_player_name,
      remote_dq_target_user_code, remote_dq_requested_by_tournament_id, remote_dq_requested_by_tournament_name, remote_dq_for_all_matches, remote_dq_approved,
      is_duplicate_tournament_id, thread_id, parent_message_id, root_message_id,
      thread_resolved, thread_resolved_at, thread_resolved_by_tournament_id, thread_resolved_by_tournament_name,
      timestamp, created_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14,
      $15, $16, $17, $18,
      $19, $20, $21, $22, $23,
      $24, $25, $26, $27,
      $28, $29, $30, $31,
      $32, $33
    )`,
    [
      record.id,
      record.event_code,
      record.source_tournament_id,
      record.source_tournament_db_id,
      record.source_tournament_name,
      record.attribute,
      record.title,
      record.body,
      record.comment,
      JSON.stringify(record.target_tournament_ids ?? []),
      record.target_player_id,
      record.target_player_name,
      record.target_user_code,
      record.requested_tournament_id,
      record.match_card_id,
      record.match_slot,
      record.remote_dq_target_player_id,
      record.remote_dq_target_player_name,
      record.remote_dq_target_user_code,
      record.remote_dq_requested_by_tournament_id,
      record.remote_dq_requested_by_tournament_name,
      record.remote_dq_for_all_matches ? 1 : 0,
      record.remote_dq_approved ? 1 : 0,
      record.is_duplicate_tournament_id ? 1 : 0,
      record.thread_id,
      record.parent_message_id,
      record.root_message_id,
      record.thread_resolved ? 1 : 0,
      record.thread_resolved_at,
      record.thread_resolved_by_tournament_id,
      record.thread_resolved_by_tournament_name,
      record.timestamp,
      record.created_at,
    ]
  );
}

export async function deleteUnmatchedMessageThread(thread_id: string): Promise<void> {
  const db = await getDb();
  await ensureUnmatchedMessagesTable(db);
  await db.execute(
    `DELETE FROM unmatched_messages
     WHERE id = $1 OR thread_id = $1 OR root_message_id = $1`,
    [thread_id]
  );
}

// ----------------------
// Tournament Players
// ----------------------
function rowToTournamentPlayer(row: TournamentPlayerRow): TournamentPlayer {
  let attributes: Record<string, string> = {};
  try { attributes = JSON.parse(row.attributes); } catch { /* ignore */ }
  let selectedCharacters: Record<string, string[]> = {};
  if (row.selected_characters_json) {
    try { selectedCharacters = JSON.parse(row.selected_characters_json); } catch { /* ignore */ }
  }
  return {
    tournament_id: row.tournament_id,
    player_id: row.player_id,
    player_code: row.player_code ?? "",
    player_sequence: row.player_sequence ?? 0,
    player_id_4: row.player_id_4 ?? "0000",
    seed: row.seed,
    name: row.name,
    character_name: row.character_name,
    selected_characters: selectedCharacters,
    attributes,
    dq: row.dq === 1,
  };
}

export async function getTournamentPlayers(
  tournament_id: string
): Promise<TournamentPlayer[]> {
  const db = await getDb();
  const rows = await db.select<TournamentPlayerRow[]>(
    "SELECT * FROM tournament_players WHERE tournament_id = $1 ORDER BY seed ASC",
    [tournament_id]
  );
  return rows.map(rowToTournamentPlayer);
}

export async function addTournamentPlayer(
  tournament_id: string,
  player_id: string,
  player_code: string,
  player_sequence: number,
  player_id_4: string,
  seed: number,
  name: string,
  character_name: string | null,
  attributes: Record<string, string>,
  selected_characters: Record<string, string[]> = {}
): Promise<void> {
  const db = await getDb();
  const selectedCharactersJson = JSON.stringify(selected_characters);
  try {
    await db.execute(
      `INSERT OR REPLACE INTO tournament_players
       (tournament_id, player_id, player_code, player_sequence, player_id_4, seed, name, character_name, selected_characters_json, attributes, dq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0)`,
      [tournament_id, player_id, player_code, player_sequence, player_id_4, seed, name, character_name, selectedCharactersJson, JSON.stringify(attributes)]
    );
  } catch {
    // Fallback for legacy schema that does not yet have player code columns.
    await db.execute(
      `INSERT OR REPLACE INTO tournament_players
       (tournament_id, player_id, seed, name, character_name, selected_characters_json, attributes, dq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`,
      [tournament_id, player_id, seed, name, character_name, selectedCharactersJson, JSON.stringify(attributes)]
    );
  }
}

export async function updateTournamentPlayerCode(
  tournament_id: string,
  player_id: string,
  player_code: string,
  player_sequence: number,
  player_id_4: string
): Promise<void> {
  const db = await getDb();
  try {
    await db.execute(
      `UPDATE tournament_players
       SET player_code = $1, player_sequence = $2, player_id_4 = $3
       WHERE tournament_id = $4 AND player_id = $5`,
      [player_code, player_sequence, player_id_4, tournament_id, player_id]
    );
  } catch {
    // Legacy schema fallback: skip silently to keep app usable.
  }
}

function rowToTournamentAdmin(row: TournamentAdminRow): TournamentAdmin {
  let attributes: Record<string, string> = {};
  try {
    attributes = JSON.parse(row.attributes);
  } catch {
    // ignore
  }
  return {
    tournament_id: row.tournament_id,
    admin_id: row.admin_id,
    admin_code: row.admin_code ?? "",
    admin_sequence: row.admin_sequence ?? 0,
    admin_id_4: row.admin_id_4 ?? "0000",
    name: row.name,
    attributes,
    created_at: row.created_at,
  };
}

export async function getTournamentAdmins(tournament_id: string): Promise<TournamentAdmin[]> {
  const db = await getDb();
  await ensureTournamentAdminsTable(db);
  const rows = await db.select<TournamentAdminRow[]>(
    `SELECT * FROM tournament_admins WHERE tournament_id = $1 ORDER BY admin_sequence ASC, created_at ASC`,
    [tournament_id]
  );
  return rows.map(rowToTournamentAdmin);
}

export async function addTournamentAdmin(
  tournament_id: string,
  admin_id: string,
  admin_code: string,
  admin_sequence: number,
  admin_id_4: string,
  name: string,
  attributes: Record<string, string>
): Promise<void> {
  const db = await getDb();
  await ensureTournamentAdminsTable(db);
  await db.execute(
    `INSERT OR REPLACE INTO tournament_admins
     (tournament_id, admin_id, admin_code, admin_sequence, admin_id_4, name, attributes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      tournament_id,
      admin_id,
      admin_code,
      admin_sequence,
      admin_id_4,
      name,
      JSON.stringify(attributes),
      new Date().toISOString(),
    ]
  );
}

export async function removeTournamentAdmin(tournament_id: string, admin_id: string): Promise<void> {
  const db = await getDb();
  await ensureTournamentAdminsTable(db);
  await db.execute(
    `DELETE FROM tournament_admins WHERE tournament_id = $1 AND admin_id = $2`,
    [tournament_id, admin_id]
  );
}

export async function updateTournamentAdminName(
  tournament_id: string,
  admin_id: string,
  name: string
): Promise<void> {
  const db = await getDb();
  await ensureTournamentAdminsTable(db);
  await db.execute(
    `UPDATE tournament_admins SET name = $1 WHERE tournament_id = $2 AND admin_id = $3`,
    [name, tournament_id, admin_id]
  );
}

export async function updateTournamentAdminCode(
  tournament_id: string,
  admin_id: string,
  admin_code: string,
  admin_sequence: number,
  admin_id_4: string
): Promise<void> {
  const db = await getDb();
  await ensureMatchActionLogsTable(db);
  await db.execute(
    `UPDATE tournament_admins
     SET admin_code = $1, admin_sequence = $2, admin_id_4 = $3
     WHERE tournament_id = $4 AND admin_id = $5`,
    [admin_code, admin_sequence, admin_id_4, tournament_id, admin_id]
  );
}

function rowToMatchActionLog(row: MatchActionLogRow): MatchActionLog {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    match_id: row.match_id,
    action_type: row.action_type,
    target_player_id: row.target_player_id,
    confirmed_by_type: row.confirmed_by_type,
    confirmed_by_id: row.confirmed_by_id,
    confirmed_by_name: row.confirmed_by_name,
    confirmed_by_code: row.confirmed_by_code,
    created_at: row.created_at,
  };
}

export async function insertMatchActionLog(
  id: string,
  tournament_id: string,
  match_id: string,
  action_type: MatchActionType,
  target_player_id: string | null,
  confirmed_by_type: MatchActionConfirmerType,
  confirmed_by_id: string,
  confirmed_by_name: string,
  confirmed_by_code: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO match_action_logs
     (id, tournament_id, match_id, action_type, target_player_id, confirmed_by_type, confirmed_by_id, confirmed_by_name, confirmed_by_code, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      tournament_id,
      match_id,
      action_type,
      target_player_id,
      confirmed_by_type,
      confirmed_by_id,
      confirmed_by_name,
      confirmed_by_code,
      new Date().toISOString(),
    ]
  );
}

export async function getMatchActionLogsByTournament(tournament_id: string): Promise<MatchActionLog[]> {
  const db = await getDb();
  await ensureMatchActionLogsTable(db);
  const rows = await db.select<MatchActionLogRow[]>(
    `SELECT * FROM match_action_logs WHERE tournament_id = $1 ORDER BY created_at DESC`,
    [tournament_id]
  );
  return rows.map(rowToMatchActionLog);
}

export async function removeTournamentPlayer(
  tournament_id: string,
  player_id: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM tournament_players WHERE tournament_id = $1 AND player_id = $2`,
    [tournament_id, player_id]
  );
}

export async function updateTournamentPlayerSeed(
  tournament_id: string,
  player_id: string,
  seed: number
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tournament_players SET seed = $1 WHERE tournament_id = $2 AND player_id = $3`,
    [seed, tournament_id, player_id]
  );
}

export async function updateTournamentPlayerCharacter(
  tournament_id: string,
  player_id: string,
  character_name: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tournament_players SET character_name = $1 WHERE tournament_id = $2 AND player_id = $3`,
    [character_name, tournament_id, player_id]
  );
}

export async function updateTournamentPlayerSelectedCharacters(
  tournament_id: string,
  player_id: string,
  selected_characters: Record<string, string[]>
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tournament_players SET selected_characters_json = $1 WHERE tournament_id = $2 AND player_id = $3`,
    [JSON.stringify(selected_characters), tournament_id, player_id]
  );
}

export async function updateTournamentPlayerName(
  tournament_id: string,
  player_id: string,
  name: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tournament_players SET name = $1 WHERE tournament_id = $2 AND player_id = $3`,
    [name, tournament_id, player_id]
  );
}

// ----------------------
// Match helpers
// ----------------------
function rowToMatch(row: MatchRow): Match {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    tree_id: row.tree_id ?? '',
    round: row.round,
    position: row.position,
    bracket: row.bracket,
    player1_id: row.player1_id,
    player2_id: row.player2_id,
    winner_id: row.winner_id,
    player1_wins: row.player1_wins,
    player2_wins: row.player2_wins,
    player1_character_name: row.player1_character_name,
    player2_character_name: row.player2_character_name,
    player1_side: row.player1_side ?? "-",
    player2_side: row.player2_side ?? "-",
    status: row.status,
    result_finalized_at: row.result_finalized_at ?? null,
    forfeit_player_id: row.forfeit_player_id,
    next_match_id: row.next_match_id,
    next_match_slot: row.next_match_slot,
    loser_next_match_id: row.loser_next_match_id,
    loser_next_match_slot: row.loser_next_match_slot,
  };
}

export async function getMatchesByTournament(
  tournament_id: string
): Promise<Match[]> {
  const db = await getDb();
  const rows = await db.select<MatchRow[]>(
    "SELECT * FROM matches WHERE tournament_id = $1 ORDER BY bracket, round, position",
    [tournament_id]
  );
  return rows.map(rowToMatch);
}

export async function getActiveMatchByPlayer(
  tournament_id: string,
  player_id: string
): Promise<Match | null> {
  const db = await getDb();
  const rows = await db.select<MatchRow[]>(
    `SELECT * FROM matches
     WHERE tournament_id = $1
       AND (player1_id = $2 OR player2_id = $2)
       AND status != 'completed'
     ORDER BY round ASC
     LIMIT 1`,
    [tournament_id, player_id]
  );
  return rows.length > 0 ? rowToMatch(rows[0]) : null;
}

export async function getLatestMatchByTwoPlayers(
  tournament_id: string,
  player1_id: string,
  player2_id: string
): Promise<Match | null> {
  const db = await getDb();
  const rows = await db.select<MatchRow[]>(
    `SELECT * FROM matches
     WHERE tournament_id = $1
       AND (
         (player1_id = $2 AND player2_id = $3)
         OR
         (player1_id = $3 AND player2_id = $2)
       )
     ORDER BY round DESC
     LIMIT 1`,
    [tournament_id, player1_id, player2_id]
  );
  return rows.length > 0 ? rowToMatch(rows[0]) : null;
}

export async function insertMatch(match: Match): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO matches (
       id, tournament_id, tree_id, round, position, bracket,
       player1_id, player2_id, winner_id,
       player1_wins, player2_wins, player1_character_name, player2_character_name, player1_side, player2_side, status, forfeit_player_id,
       result_finalized_at,
       next_match_id, next_match_slot,
       loser_next_match_id, loser_next_match_slot
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9,
       $10, $11, $12, $13, $14, $15, $16, $17, $18,
       $19, $20,
       $21, $22
     )`,
    [
      match.id, match.tournament_id, match.tree_id, match.round, match.position, match.bracket,
      match.player1_id, match.player2_id, match.winner_id,
      match.player1_wins, match.player2_wins, match.player1_character_name, match.player2_character_name,
      match.player1_side, match.player2_side, match.status, match.forfeit_player_id, match.result_finalized_at ?? null,
      match.next_match_id, match.next_match_slot,
      match.loser_next_match_id, match.loser_next_match_slot,
    ]
  );
}

export async function updateMatchSides(
  id: string,
  player1_side: MatchPlayerSide,
  player2_side: MatchPlayerSide
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE matches SET player1_side = $1, player2_side = $2 WHERE id = $3`,
    [player1_side, player2_side, id]
  );
}

export async function updateMatchCharacters(
  id: string,
  player1_character_name: string | null,
  player2_character_name: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE matches SET player1_character_name = $1, player2_character_name = $2 WHERE id = $3`,
    [player1_character_name, player2_character_name, id]
  );
}

export async function updateMatchScore(
  id: string,
  player1_wins: number,
  player2_wins: number,
  status: "pending" | "in_progress" | "completed",
  winner_id: string | null,
  forfeit_player_id: string | null
): Promise<void> {
  const db = await getDb();
  const resultFinalizedAt = status === "completed" ? new Date().toISOString() : null;
  await db.execute(
    `UPDATE matches SET player1_wins = $1, player2_wins = $2, status = $3, winner_id = $4, forfeit_player_id = $5, result_finalized_at = $6 WHERE id = $7`,
    [player1_wins, player2_wins, status, winner_id, forfeit_player_id, resultFinalizedAt, id]
  );
}

export async function updateMatchPlayer(
  id: string,
  slot: 1 | 2,
  player_id: string | null
): Promise<void> {
  const db = await getDb();
  const col = slot === 1 ? "player1_id" : "player2_id";
  await db.execute(`UPDATE matches SET ${col} = $1 WHERE id = $2`, [player_id, id]);
}

export async function updateMatchPlayerWithCharacter(
  id: string,
  slot: 1 | 2,
  player_id: string | null,
  character_name: string | null
): Promise<void> {
  const db = await getDb();
  const playerCol = slot === 1 ? "player1_id" : "player2_id";
  const characterCol = slot === 1 ? "player1_character_name" : "player2_character_name";
  await db.execute(
    `UPDATE matches SET ${playerCol} = $1, ${characterCol} = $2 WHERE id = $3`,
    [player_id, character_name, id]
  );
}

export async function updateMatchStatus(
  id: string,
  status: "pending" | "in_progress" | "completed"
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE matches SET status = $1 WHERE id = $2`, [status, id]);
}

export async function updateMatchProgressionLinks(
  id: string,
  next_match_id: string | null,
  next_match_slot: number | null,
  loser_next_match_id: string | null,
  loser_next_match_slot: number | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE matches
     SET next_match_id = $1,
         next_match_slot = $2,
         loser_next_match_id = $3,
         loser_next_match_slot = $4
     WHERE id = $5`,
    [next_match_id, next_match_slot, loser_next_match_id, loser_next_match_slot, id]
  );
}

export async function deleteMatchesByTournament(
  tournament_id: string
): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM matches WHERE tournament_id = $1`, [tournament_id]);
  await db.execute(`DELETE FROM round_locks WHERE tournament_id = $1`, [tournament_id]);
}

export async function deleteMatchById(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM matches WHERE id = $1`, [id]);
}

export async function resetMatchToPending(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE matches SET status = 'pending', player1_wins = 0, player2_wins = 0, winner_id = NULL, forfeit_player_id = NULL, result_finalized_at = NULL WHERE id = $1`,
    [id]
  );
}

// ----------------------
// BracketTree helpers
// ----------------------
export async function getBracketTrees(
  tournament_id: string
): Promise<BracketTree[]> {
  const db = await getDb();
  const rows = await db.select<BracketTreeRow[]>(
    "SELECT * FROM bracket_trees WHERE tournament_id = $1 ORDER BY created_at ASC",
    [tournament_id]
  );
  return rows;
}

export async function insertBracketTree(tree: BracketTree): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO bracket_trees (id, tournament_id, name, created_at) VALUES ($1, $2, $3, $4)`,
    [tree.id, tree.tournament_id, tree.name, tree.created_at]
  );
}

export async function renameBracketTree(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE bracket_trees SET name = $1 WHERE id = $2`, [name, id]);
}

export async function deleteBracketTree(id: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select<Array<{ tournament_id: string }>>(
    `SELECT tournament_id FROM bracket_trees WHERE id = $1 LIMIT 1`,
    [id]
  );
  // Detach matches from this tree (set tree_id to '') rather than deleting them
  await db.execute(`UPDATE matches SET tree_id = '' WHERE tree_id = $1`, [id]);
  if (rows.length > 0) {
    await db.execute(
      `DELETE FROM round_locks WHERE tournament_id = $1 AND tree_id = $2`,
      [rows[0].tournament_id, id]
    );
  }
  await db.execute(`DELETE FROM bracket_trees WHERE id = $1`, [id]);
}

export async function deleteBracketTreesByTournament(
  tournament_id: string
): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM bracket_trees WHERE tournament_id = $1`, [tournament_id]);
  await db.execute(`DELETE FROM round_locks WHERE tournament_id = $1`, [tournament_id]);
}

// ----------------------
// Round lock helpers
// ----------------------
function rowToRoundLock(row: RoundLockRow): RoundLock {
  return {
    tournament_id: row.tournament_id,
    tree_id: row.tree_id,
    bracket: row.bracket,
    round: row.round,
  };
}

export async function getRoundLocks(
  tournament_id: string
): Promise<RoundLock[]> {
  const db = await getDb();
  const rows = await db.select<RoundLockRow[]>(
    `SELECT * FROM round_locks WHERE tournament_id = $1 AND locked = 1 ORDER BY bracket, round`,
    [tournament_id]
  );
  return rows.map(rowToRoundLock);
}

export async function lockRound(
  tournament_id: string,
  tree_id: string,
  bracket: MatchBracket,
  round: number
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO round_locks (tournament_id, tree_id, bracket, round, locked)
     VALUES ($1, $2, $3, $4, 1)`,
    [tournament_id, tree_id, bracket, round]
  );
}

export async function unlockRoundAndLater(
  tournament_id: string,
  tree_id: string,
  bracket: MatchBracket,
  round: number
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM round_locks
     WHERE tournament_id = $1 AND tree_id = $2 AND bracket = $3 AND round >= $4`,
    [tournament_id, tree_id, bracket, round]
  );
}



