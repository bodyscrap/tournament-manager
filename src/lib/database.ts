import Database from "@tauri-apps/plugin-sql";
import type {
  Player,
  PlayerRow,
  Tournament,
  TournamentRow,
  TournamentPlayer,
  TournamentPlayerRow,
  Match,
  MatchRow,
  BracketTree,
  BracketTreeRow,
  MatchBracket,
  RoundLock,
  RoundLockRow,
} from "./types";

// ----------------------
// Singleton DB connection
// ----------------------
let _db: Database | null = null;

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
    CREATE TABLE IF NOT EXISTS tournament (
      id                 TEXT PRIMARY KEY,
      type               TEXT NOT NULL,
      max_participants   INTEGER NOT NULL DEFAULT 256,
      status             TEXT NOT NULL DEFAULT 'setup',
      grand_final_reset  INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tournament_players (
      tournament_id TEXT NOT NULL,
      player_id     TEXT NOT NULL,
      seed          INTEGER NOT NULL,
      PRIMARY KEY (tournament_id, player_id)
    );
  `);

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
      status                 TEXT NOT NULL DEFAULT 'pending',
      dq_player_id           TEXT,
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
  // Migration: add tree_id to matches
  try {
    await db.execute(`ALTER TABLE matches ADD COLUMN tree_id TEXT NOT NULL DEFAULT ''`);
  } catch { /* exists */ }
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
// Tournament helpers
// ----------------------
function rowToTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    max_participants: row.max_participants,
    status: row.status,
    grand_final_reset: row.grand_final_reset === 1,
    created_at: row.created_at,
  };
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

export async function getTournament(): Promise<Tournament | null> {
  const db = await getDb();
  const rows = await db.select<TournamentRow[]>(
    "SELECT * FROM tournament ORDER BY created_at DESC LIMIT 1"
  );
  return rows.length > 0 ? rowToTournament(rows[0]) : null;
}

export async function createTournament(
  id: string,
  type: "single_elimination" | "double_elimination",
  max_participants: number,
  grand_final_reset: boolean,
  name: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO tournament (id, name, type, max_participants, status, grand_final_reset, created_at)
     VALUES ($1, $2, $3, $4, 'setup', $5, $6)`,
    [id, name, type, max_participants, grand_final_reset ? 1 : 0, new Date().toISOString()]
  );
}

export async function updateTournamentStatus(
  id: string,
  status: "setup" | "in_progress" | "completed" | "finalized"
): Promise<void> {
  const db = await getDb();
  await db.execute(`UPDATE tournament SET status = $1 WHERE id = $2`, [status, id]);
}

export async function updateGrandFinalReset(
  id: string,
  grand_final_reset: boolean
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tournament SET grand_final_reset = $1 WHERE id = $2`,
    [grand_final_reset ? 1 : 0, id]
  );
}

export async function updateTournamentSettings(
  id: string,
  type: "single_elimination" | "double_elimination",
  max_participants: number,
  grand_final_reset: boolean
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tournament SET type = $1, max_participants = $2, grand_final_reset = $3 WHERE id = $4`,
    [type, max_participants, grand_final_reset ? 1 : 0, id]
  );
}

export async function deleteTournament(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM tournament_players WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM matches WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM bracket_trees WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM round_locks WHERE tournament_id = $1`, [id]);
  await db.execute(`DELETE FROM tournament WHERE id = $1`, [id]);
}

// ----------------------
// Tournament Players
// ----------------------
function rowToTournamentPlayer(row: TournamentPlayerRow): TournamentPlayer {
  let attributes: Record<string, string> = {};
  try { attributes = JSON.parse(row.attributes); } catch { /* ignore */ }
  return {
    tournament_id: row.tournament_id,
    player_id: row.player_id,
    seed: row.seed,
    name: row.name,
    character_name: row.character_name,
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
  seed: number,
  name: string,
  character_name: string | null,
  attributes: Record<string, string>
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO tournament_players
     (tournament_id, player_id, seed, name, character_name, attributes, dq)
     VALUES ($1, $2, $3, $4, $5, $6, 0)`,
    [tournament_id, player_id, seed, name, character_name, JSON.stringify(attributes)]
  );
}

export async function updateTournamentParticipantDq(
  tournament_id: string,
  player_id: string,
  dq: boolean
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE tournament_players SET dq = $1 WHERE tournament_id = $2 AND player_id = $3`,
    [dq ? 1 : 0, tournament_id, player_id]
  );
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
    status: row.status,
    dq_player_id: row.dq_player_id,
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

export async function getMatchById(id: string): Promise<Match | null> {
  const db = await getDb();
  const rows = await db.select<MatchRow[]>(
    "SELECT * FROM matches WHERE id = $1",
    [id]
  );
  return rows.length > 0 ? rowToMatch(rows[0]) : null;
}

export async function getMatchesByPlayer(
  tournament_id: string,
  player_id: string
): Promise<Match[]> {
  const db = await getDb();
  const rows = await db.select<MatchRow[]>(
    `SELECT * FROM matches
     WHERE tournament_id = $1
       AND (player1_id = $2 OR player2_id = $2)
     ORDER BY round ASC`,
    [tournament_id, player_id]
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
       player1_wins, player2_wins, status, dq_player_id,
       next_match_id, next_match_slot,
       loser_next_match_id, loser_next_match_slot
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9,
       $10, $11, $12, $13,
       $14, $15,
       $16, $17
     )`,
    [
      match.id, match.tournament_id, match.tree_id, match.round, match.position, match.bracket,
      match.player1_id, match.player2_id, match.winner_id,
      match.player1_wins, match.player2_wins, match.status, match.dq_player_id,
      match.next_match_id, match.next_match_slot,
      match.loser_next_match_id, match.loser_next_match_slot,
    ]
  );
}

export async function updateMatchScore(
  id: string,
  player1_wins: number,
  player2_wins: number,
  status: "pending" | "in_progress" | "completed",
  winner_id: string | null,
  dq_player_id: string | null
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE matches SET player1_wins = $1, player2_wins = $2, status = $3, winner_id = $4, dq_player_id = $5 WHERE id = $6`,
    [player1_wins, player2_wins, status, winner_id, dq_player_id, id]
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
    `UPDATE matches SET status = 'pending', player1_wins = 0, player2_wins = 0, winner_id = NULL, dq_player_id = NULL WHERE id = $1`,
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
