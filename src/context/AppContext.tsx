import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import {
  getAllPlayers,
  getPlayerById,
  createPlayer,
  updatePlayer,
  setPlayerDq,
  deletePlayer,
  getAllTournaments,
  getTournamentById,
  createTournament,
  updateTournamentStatus,
  updateTournamentSettings as updateTournamentSettingsDb,
  deleteTournament,
  getTournamentPlayers,
  addTournamentPlayer,
  updateTournamentPlayerCode,
  getTournamentAdmins,
  getMatchActionLogsByTournament,
  addTournamentAdmin,
  removeTournamentAdmin,
  updateTournamentAdminName,
  updateTournamentAdminCode,
  insertMatchActionLog,
  removeTournamentPlayer,
  updateTournamentPlayerSeed,
  getMatchesByTournament,
  deleteMatchesByTournament,
  insertMatch,
  updateMatchScore,
  updateMatchPlayer,
  updateMatchPlayerWithCharacter,
  updateMatchStatus,
  updateMatchProgressionLinks,
  getActiveMatchByPlayer,
  getLatestMatchByTwoPlayers,
  getBracketTrees,
  insertBracketTree,
  renameBracketTree,
  deleteBracketTree,
  deleteBracketTreesByTournament,
  deleteMatchById,
  resetMatchToPending,
  getRoundLocks,
  lockRound,
  unlockRoundAndLater,
  getCharacterMasters,
  createCharacterMaster,
  deleteCharacterMaster,
  getCharacterLists,
  createCharacterList,
  updateCharacterList,
  deleteCharacterList,
  updateTournamentPlayerCharacter,
  updateTournamentPlayerName,
  updateMatchCharacters,
  updateMatchSides,
  updateTournamentPlayerSelectedCharacters,
} from "../lib/database";
import {
  buildAdminCode,
  buildPlayerCode,
  isValidAdminCode,
  isValidPlayerCode,
  normalizeEventCode,
  normalizeTournamentCode,
} from "../lib/playerCode";
import {
  generateSingleElimination,
  generateDoubleElimination,
  shuffleArray,
  createGrandFinalResetMatch,
} from "../lib/bracket";
import { buildIncomingBySlot, getUiMatchState } from "../lib/matchState";
import type {
  Player,
  CharacterMaster,
  CharacterList,
  Tournament,
  TournamentPlayer,
  TournamentAdmin,
  BracketTree,
  Match,
  MatchBracket,
  CharacterInputMode,
  TournamentType,
  TournamentStatus,
  TournamentDefaultPlayerSide,
  TournamentCharacterSelectionConfig,
  RoundLock,
  MatchPlayerSide,
  MatchActionConfirmerType,
  MatchActionLog,
  MatchActionAuthMode,
} from "../lib/types";
import { normalizeCharacterSelectionConfig } from "../lib/characterSelection";

interface ActionConfirmer {
  type: MatchActionConfirmerType;
  id: string;
  name: string;
  code: string;
}

interface ScoreActionAuth {
  resultConfirmer?: ActionConfirmer | null;
  dqConfirmer?: ActionConfirmer | null;
  forcedLossConfirmer?: ActionConfirmer | null;
}

export interface AppNetworkMessageSettings {
  subnetMask: string;
  port: number;
  saveUnmatchedMessages: boolean;
  preventUnresolvedThreadDeletion: boolean;
}

const APP_NETWORK_MESSAGE_SETTINGS_KEY = "app.network-message-settings.v1";
const TOURNAMENT_WIDE_FORFEIT_KEY = "app.tournament-wide-forfeit-player-ids.v1";

const DEFAULT_APP_NETWORK_MESSAGE_SETTINGS: AppNetworkMessageSettings = {
  subnetMask: "255.255.255.0",
  port: 49777,
  saveUnmatchedMessages: true,
  preventUnresolvedThreadDeletion: true,
};

function sanitizePort(port: unknown): number {
  const normalized = Number(port);
  if (!Number.isInteger(normalized)) return DEFAULT_APP_NETWORK_MESSAGE_SETTINGS.port;
  return Math.min(65535, Math.max(1, normalized));
}

function loadAppNetworkMessageSettings(): AppNetworkMessageSettings {
  if (typeof window === "undefined") return DEFAULT_APP_NETWORK_MESSAGE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(APP_NETWORK_MESSAGE_SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_NETWORK_MESSAGE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppNetworkMessageSettings>;
    return {
      subnetMask:
        typeof parsed.subnetMask === "string" && parsed.subnetMask.trim().length > 0
          ? parsed.subnetMask.trim()
          : DEFAULT_APP_NETWORK_MESSAGE_SETTINGS.subnetMask,
      port: sanitizePort(parsed.port),
      saveUnmatchedMessages:
        typeof parsed.saveUnmatchedMessages === "boolean"
          ? parsed.saveUnmatchedMessages
          : DEFAULT_APP_NETWORK_MESSAGE_SETTINGS.saveUnmatchedMessages,
      preventUnresolvedThreadDeletion:
        typeof parsed.preventUnresolvedThreadDeletion === "boolean"
          ? parsed.preventUnresolvedThreadDeletion
          : DEFAULT_APP_NETWORK_MESSAGE_SETTINGS.preventUnresolvedThreadDeletion,
    };
  } catch {
    return DEFAULT_APP_NETWORK_MESSAGE_SETTINGS;
  }
}

function saveAppNetworkMessageSettings(settings: AppNetworkMessageSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_NETWORK_MESSAGE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage が使えない環境でも動作は継続
  }
}

function loadTournamentWideForfeitMap(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TOURNAMENT_WIDE_FORFEIT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized: Record<string, string[]> = {};
    for (const [tournamentId, value] of Object.entries(parsed)) {
      if (!tournamentId) continue;
      if (!Array.isArray(value)) continue;
      const ids = value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0);
      if (ids.length > 0) {
        normalized[tournamentId] = [...new Set(ids)];
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function saveTournamentWideForfeitMap(map: Record<string, string[]>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOURNAMENT_WIDE_FORFEIT_KEY, JSON.stringify(map));
  } catch {
    // localStorage が使えない環境でも動作は継続
  }
}

// -------------------------------------------------------
// Context value type
// -------------------------------------------------------
interface AppContextValue {
  initialized: boolean;

  networkMessageSettings: AppNetworkMessageSettings;
  updateNetworkMessageSettings: (patch: Partial<AppNetworkMessageSettings>) => void;

  // Players
  players: Player[];
  characters: CharacterMaster[];
  characterLists: CharacterList[];
  fetchCharacters: () => Promise<void>;
  fetchCharacterLists: () => Promise<void>;
  addCharacter: (name: string) => Promise<void>;
  removeCharacter: (id: string) => Promise<void>;
  addCharacterList: (name: string, categoryName: string, items: string[]) => Promise<void>;
  editCharacterList: (id: string, name: string, categoryName: string, items: string[]) => Promise<void>;
  removeCharacterList: (id: string) => Promise<void>;
  fetchPlayers: () => Promise<void>;
  addPlayer: (
    name: string,
    character_name: string | null,
    attributes: Record<string, string>
  ) => Promise<string>;
  editPlayer: (
    id: string,
    name: string,
    character_name: string | null,
    attributes: Record<string, string>
  ) => Promise<void>;
  dqPlayer: (id: string, dq: boolean) => Promise<void>;
  removePlayer: (id: string) => Promise<void>;
  getPlayer: (id: string) => Promise<Player | null>;

  // Tournament list
  tournamentList: Tournament[];
  pinnedTournament: Tournament | null;
  setPinnedTournament: (id: string | null) => Promise<void>;
  isReadOnly: boolean;
  selectTournament: (id: string | null) => Promise<void>;
  finalizeTournament: () => Promise<void>;

  // Active tournament
  tournament: Tournament | null;
  participants: TournamentPlayer[];
  admins: TournamentAdmin[];
  matches: Match[];
  matchActionLogs: MatchActionLog[];
  fetchTournament: () => Promise<void>;
  createNew: (
    event_code: string,
    tournament_code: string,
    type: TournamentType,
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
  ) => Promise<void>;
  removeTournament: (id?: string) => Promise<void>;
  addParticipant: (
    name: string,
    character_name: string | null,
    attributes: Record<string, string>,
    selected_characters?: Record<string, string[]>,
    player_id?: string
  ) => Promise<void>;
  editParticipantName: (player_id: string, name: string) => Promise<void>;
  setParticipantCharacter: (player_id: string, character_name: string | null) => Promise<void>;
  setParticipantSelectedCharacters: (player_id: string, selected_characters: Record<string, string[]>) => Promise<void>;
  addAdmin: (name: string, attributes?: Record<string, string>) => Promise<void>;
  editAdminName: (admin_id: string, name: string) => Promise<void>;
  removeAdmin: (admin_id: string) => Promise<void>;
  removeParticipant: (player_id: string) => Promise<void>;
  swapSeeds: (player_id_a: string, player_id_b: string) => Promise<void>;
  randomizeSeeds: () => Promise<boolean>;
  generateBracket: () => Promise<void>;
  clearBracket: () => Promise<void>;
  setGrandFinalReset: (enabled: boolean) => Promise<void>;
  setTournamentStatus: (status: TournamentStatus) => Promise<void>;
  updateTournamentSettings: (
    event_code: string,
    tournament_code: string,
    type: TournamentType,
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
  ) => Promise<void>;

  // Bracket trees
  trees: BracketTree[];
  roundLocks: RoundLock[];
  isRoundLocked: (tree_id: string, bracket: MatchBracket, round: number) => boolean;
  toggleRoundLock: (tree_id: string, bracket: MatchBracket, round: number) => Promise<void>;
  addBracketTree: (name: string) => Promise<string>;
  renameBracketTreeItem: (id: string, name: string) => Promise<void>;
  removeBracketTree: (id: string) => Promise<void>;

  correctScore: (
    match: Match,
    player1_wins: number,
    player2_wins: number,
    forfeit_player_ids: string[],
    forced_loser_id?: string | null,
    player1_character_name?: string | null,
    player2_character_name?: string | null,
    auth?: ScoreActionAuth,
    forfeit_all_matches_player_ids?: string[]
  ) => Promise<void>;

  // Mid-tournament match creation
  addMidTournamentMatch: (
    tree_id: string,
    round: number,
    bracket: MatchBracket,
    player1_id: string,
    player2_id: string | null
  ) => Promise<void>;
  addParticipantAndAssign: (
    name: string,
    character_name: string | null,
    bracket: MatchBracket,
    treeId: string,
    selected_characters?: Record<string, string[]>,
    player_id?: string
  ) => Promise<void>;
  swapMatchPlayers: (
    matchAId: string,
    slotA: 1 | 2,
    matchBId: string,
    slotB: 1 | 2
  ) => Promise<void>;

  // Matches
  startMatch: (match_id: string) => Promise<void>;
  setMatchReady: (match_id: string) => Promise<void>;
  setMatchCharacters: (
    match: Match,
    player1_character_name: string | null,
    player2_character_name: string | null
  ) => Promise<void>;
  swapMatchSides: (match_id: string) => Promise<void>;
  randomizeMatchSides: (match_id: string) => Promise<{ player1_side: "1P" | "2P"; player2_side: "1P" | "2P" }>;
  recordScore: (
    match: Match,
    player1_wins: number,
    player2_wins: number,
    forfeit_player_ids: string[],
    forced_loser_id?: string | null,
    player1_character_name?: string | null,
    player2_character_name?: string | null,
    auth?: ScoreActionAuth,
    forfeit_all_matches_player_ids?: string[]
  ) => Promise<void>;
  findActiveMatch: (player_id: string) => Promise<Match | null>;
  findMatchByTwoPlayers: (
    player1_id: string,
    player2_id: string
  ) => Promise<Match | null>;
}

// -------------------------------------------------------
// Cascade reset helper (module-level)
// -------------------------------------------------------
async function performCascadeReset(
  startMatch: Match,
  oldWinnerId: string | null,
  oldLoserId: string | null,
  allMatches: Match[]
): Promise<void> {
  const matchLookup = new Map<string, Match>(allMatches.map((m) => [m.id, m]));
  const queue: Array<{ matchId: string; slot: 1 | 2 }> = [];

  if (startMatch.next_match_id && startMatch.next_match_slot && oldWinnerId) {
    queue.push({ matchId: startMatch.next_match_id, slot: startMatch.next_match_slot as 1 | 2 });
  }
  if (startMatch.loser_next_match_id && startMatch.loser_next_match_slot && oldLoserId) {
    queue.push({ matchId: startMatch.loser_next_match_id, slot: startMatch.loser_next_match_slot as 1 | 2 });
  }
  // Delete any GF reset match in the same tree if this is a grand_final
  if (startMatch.bracket === "grand_final") {
    const gfResets = allMatches.filter(
      (m) => m.bracket === "grand_final_reset" && m.tree_id === startMatch.tree_id
    );
    for (const gfr of gfResets) await deleteMatchById(gfr.id);
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const { matchId, slot } = queue.shift()!;
    const key = `${matchId}:${slot}`;
    if (visited.has(key)) continue;
    visited.add(key);

    // Remove the cascaded player from this slot
    await updateMatchPlayer(matchId, slot, null);

    const m = matchLookup.get(matchId);
    if (!m || m.status === "pending") continue;

    if (m.status === "completed") {
      const oldW = m.winner_id;
      const oldL = m.player1_id === oldW ? m.player2_id : m.player1_id;
      if (m.next_match_id && m.next_match_slot && oldW) {
        queue.push({ matchId: m.next_match_id, slot: m.next_match_slot as 1 | 2 });
      }
      if (m.loser_next_match_id && m.loser_next_match_slot && oldL) {
        queue.push({ matchId: m.loser_next_match_id, slot: m.loser_next_match_slot as 1 | 2 });
      }
      if (m.bracket === "grand_final") {
        const gfResets = allMatches.filter(
          (x) => x.bracket === "grand_final_reset" && x.tree_id === m.tree_id
        );
        for (const gfr of gfResets) await deleteMatchById(gfr.id);
      }
    }
    // Reset this match to pending regardless of previous status
    await resetMatchToPending(matchId);
  }
}

function isDummyPlayerId(id: string | null): boolean {
  return !!id && id.startsWith("dummy-");
}

function normalizeCharacterList(values: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of values) {
    const name = raw.trim();
    if (!name) continue;
    unique.add(name);
  }
  return [...unique];
}

function sanitizeCharacterByTournament(
  tournament: Tournament,
  character_name: string | null
): string | null {
  const normalized = character_name?.trim() || null;
  if (!normalized) return null;
  if (tournament.character_input_mode !== "list_selection") return normalized;
  return tournament.character_list.includes(normalized) ? normalized : null;
}

function resolveDefaultMatchSides(
  default_player_side: TournamentDefaultPlayerSide
): { player1_side: "1P" | "2P"; player2_side: "1P" | "2P" } {
  if (default_player_side === "upper_2p") {
    return { player1_side: "2P", player2_side: "1P" };
  }
  if (default_player_side === "random") {
    return Math.random() < 0.5
      ? { player1_side: "1P", player2_side: "2P" }
      : { player1_side: "2P", player2_side: "1P" };
  }
  return { player1_side: "1P", player2_side: "2P" };
}

function applyDefaultMatchSides(match: Match, default_player_side: TournamentDefaultPlayerSide): Match {
  return {
    ...match,
    ...resolveDefaultMatchSides(default_player_side),
  };
}

async function syncPendingMatchSides(tournament: Tournament): Promise<void> {
  const allMatches = await getMatchesByTournament(tournament.id);
  const incomingBySlot = buildIncomingBySlot(allMatches);

  for (const m of allMatches) {
    if (m.status !== "pending") continue;

    const uiState = getUiMatchState(m, incomingBySlot);
    if (uiState === "undecided") {
      if (m.player1_side !== "-" || m.player2_side !== "-") {
        await updateMatchSides(m.id, "-", "-");
      }
      continue;
    }

    const hasUnsetSide = m.player1_side === "-" || m.player2_side === "-";
    if (!hasUnsetSide) continue;

    const nextSides = resolveDefaultMatchSides(tournament.default_player_side);
    await updateMatchSides(m.id, nextSides.player1_side, nextSides.player2_side);
  }
}

function validateRequiredCharacterSelection(
  tournament: Tournament,
  character_name: string | null,
  label: string
): string | null {
  const raw = character_name?.trim() || null;
  const sanitized = sanitizeCharacterByTournament(tournament, character_name);

  if (tournament.character_input_mode !== "list_selection") {
    return sanitized;
  }
  if (!raw) {
    throw new Error(`${label}の使用キャラは必須です`);
  }
  if (!sanitized) {
    throw new Error(`${label}の使用キャラは大会の使用可能キャラリストから選択してください`);
  }
  return sanitized;
}

function getNextPlayerSequence(participants: TournamentPlayer[]): number {
  const maxSequence = participants.reduce((max, p) => {
    const n = Number.isFinite(p.player_sequence) ? p.player_sequence : 0;
    return n > max ? n : max;
  }, 0);
  return maxSequence + 1;
}

async function ensureParticipantCodes(
  tournament: Tournament,
  participants: TournamentPlayer[]
): Promise<boolean> {
  const normalizedEventCode = normalizeEventCode(tournament.event_code);
  const normalizedTournamentCode = normalizeTournamentCode(tournament.tournament_code);
  let changed = false;

  const ordered = [...participants].sort((a, b) => a.seed - b.seed);
  for (let i = 0; i < ordered.length; i++) {
    const participant = ordered[i];
    const needsSequence = !participant.player_sequence || participant.player_sequence <= 0;
    const nextSequence = needsSequence ? i + 1 : participant.player_sequence;
    const needsPlayerId4 = !/^\d{4}$/.test(participant.player_id_4 ?? "");
    const needsCode = !isValidPlayerCode(participant.player_code ?? "", normalizedEventCode);

    if (!needsSequence && !needsPlayerId4 && !needsCode) continue;

    const generated = buildPlayerCode(
      normalizedEventCode,
      normalizedTournamentCode,
      nextSequence,
      participant.name
    );
    await updateTournamentPlayerCode(
      tournament.id,
      participant.player_id,
      generated.playerCode,
      nextSequence,
      generated.playerId4
    );
    changed = true;
  }

  return changed;
}

function getNextAdminSequence(admins: TournamentAdmin[]): number {
  const maxSequence = admins.reduce((max, a) => {
    const n = Number.isFinite(a.admin_sequence) ? a.admin_sequence : 0;
    return n > max ? n : max;
  }, 0);
  return maxSequence + 1;
}

async function ensureAdminCodes(
  tournament: Tournament,
  admins: TournamentAdmin[]
): Promise<boolean> {
  const normalizedEventCode = normalizeEventCode(tournament.event_code);
  const normalizedTournamentCode = normalizeTournamentCode(tournament.tournament_code);
  let changed = false;

  const ordered = [...admins].sort((a, b) => a.admin_sequence - b.admin_sequence);
  for (let i = 0; i < ordered.length; i++) {
    const admin = ordered[i];
    const sequence = admin.admin_sequence > 0 ? admin.admin_sequence : i + 1;
    const needsId4 = !/^\d{4}$/.test(admin.admin_id_4 ?? "");
    const needsCode = !isValidAdminCode(admin.admin_code ?? "", normalizedEventCode);
    if (!needsId4 && !needsCode) continue;

    const generated = buildAdminCode(
      normalizedEventCode,
      normalizedTournamentCode,
      tournament.max_participants,
      sequence
    );
    await updateTournamentAdminCode(
      tournament.id,
      admin.admin_id,
      generated.adminCode,
      sequence,
      generated.adminId4
    );
    changed = true;
  }

  return changed;
}

async function writeMatchActionLogs(
  tournamentId: string,
  matchId: string,
  forfeitPlayerIds: string[],
  dqLoserId: string | null,
  auth?: ScoreActionAuth
): Promise<void> {
  const noneConfirmer = {
    type: "none" as const,
    id: "",
    name: "認証なし",
    code: "",
  };
  if (dqLoserId) {
    const forcedConfirmer = auth?.forcedLossConfirmer ?? noneConfirmer;
    await insertMatchActionLog(
      uuidv4(),
      tournamentId,
      matchId,
      "dq",
      dqLoserId,
      forcedConfirmer.type,
      forcedConfirmer.id,
      forcedConfirmer.name,
      forcedConfirmer.code
    );
    return;
  }

  if (forfeitPlayerIds.length > 0) {
    const dqConfirmer = auth?.dqConfirmer ?? noneConfirmer;
    for (const targetPlayerId of forfeitPlayerIds) {
      await insertMatchActionLog(
        uuidv4(),
        tournamentId,
        matchId,
        "forfeit",
        targetPlayerId,
        dqConfirmer.type,
        dqConfirmer.id,
        dqConfirmer.name,
        dqConfirmer.code
      );
    }
    return;
  }

  const resultConfirmer = auth?.resultConfirmer ?? noneConfirmer;
  await insertMatchActionLog(
    uuidv4(),
    tournamentId,
    matchId,
    "result",
    null,
    resultConfirmer.type,
    resultConfirmer.id,
    resultConfirmer.name,
    resultConfirmer.code
  );
}

function resolveMatchOutcome(
  match: Match,
  allMatches: Match[],
  player1_wins: number,
  player2_wins: number,
  forfeit_player_ids: string[],
  dq_loser_id: string | null = null
): {
  status: "pending" | "in_progress" | "completed";
  winner_id: string | null;
  loser_id: string | null;
  forfeit_player_id: string | null;
} {
  const incomingBySlot = buildIncomingBySlot(allMatches);
  const incoming = incomingBySlot.get(match.id) ?? { slot1: false, slot2: false };

  const p1Id = match.player1_id;
  const p2Id = match.player2_id;

  const dqSet = new Set(
    forfeit_player_ids.filter(
      (id): id is string => !!id && (id === p1Id || id === p2Id)
    )
  );
  const p1Dq = !!p1Id && dqSet.has(p1Id);
  const p2Dq = !!p2Id && dqSet.has(p2Id);

  const slot1IsBye = p1Id === null && !incoming.slot1;
  const slot2IsBye = p2Id === null && !incoming.slot2;
  const p1IsReal = !!p1Id && !isDummyPlayerId(p1Id);
  const p2IsReal = !!p2Id && !isDummyPlayerId(p2Id);

  // 両側とも BYE なら、0-0 のまま自動完了扱いにする。
  if (slot1IsBye && slot2IsBye) {
    return {
      status: "completed",
      winner_id: null,
      loser_id: null,
      forfeit_player_id: null,
    };
  }

  // 両者棄権は勝者なしで試合完了。次ラウンド側は BYE/TBD 扱いにする。
  if (p1Dq && p2Dq) {
    return {
      status: "completed",
      winner_id: null,
      loser_id: null,
      forfeit_player_id: null,
    };
  }

  // 片側棄権は得失ラウンドに関係なく反対側を勝者にする。
  if (p1Dq) {
    return {
      status: "completed",
      winner_id: p2Id,
      loser_id: p1Id,
      forfeit_player_id: p1Id,
    };
  }
  if (p2Dq) {
    return {
      status: "completed",
      winner_id: p1Id,
      loser_id: p2Id,
      forfeit_player_id: p2Id,
    };
  }

  // スコア同点時のみ、DQを適用する(入力済みスコア優先)。
  if (player1_wins === player2_wins && dq_loser_id && (dq_loser_id === p1Id || dq_loser_id === p2Id)) {
    const winnerId = dq_loser_id === p1Id ? p2Id : p1Id;
    return {
      status: "completed",
      winner_id: winnerId,
      loser_id: dq_loser_id,
      forfeit_player_id: null,
    };
  }

  // BYE / DUMMY 戦は 0-0 でも実プレイヤー側を勝者扱いにする。
  const p1AutoWin = p1IsReal && (slot2IsBye || isDummyPlayerId(p2Id));
  const p2AutoWin = p2IsReal && (slot1IsBye || isDummyPlayerId(p1Id));

  // ただしBYE/DUMMY側のスコアを上回らせた場合は、実プレイヤーを敗北扱いにできる。
  // (遅延参加者を疑似的にルーザーズから参加させる用途)
  if (p1AutoWin && !p2AutoWin && player2_wins > player1_wins) {
    return {
      status: "completed",
      winner_id: p2Id,
      loser_id: p1Id,
      forfeit_player_id: null,
    };
  }
  if (p2AutoWin && !p1AutoWin && player1_wins > player2_wins) {
    return {
      status: "completed",
      winner_id: p1Id,
      loser_id: p2Id,
      forfeit_player_id: null,
    };
  }

  if (p1AutoWin && !p2AutoWin) {
    return {
      status: "completed",
      winner_id: p1Id,
      loser_id: p2Id,
      forfeit_player_id: null,
    };
  }
  if (p2AutoWin && !p1AutoWin) {
    return {
      status: "completed",
      winner_id: p2Id,
      loser_id: p1Id,
      forfeit_player_id: null,
    };
  }

  // 通常対戦は得失ラウンドでのみ勝敗を確定する。
  if (player1_wins > player2_wins && p1Id) {
    return {
      status: "completed",
      winner_id: p1Id,
      loser_id: p2Id,
      forfeit_player_id: null,
    };
  }
  if (player2_wins > player1_wins && p2Id) {
    return {
      status: "completed",
      winner_id: p2Id,
      loser_id: p1Id,
      forfeit_player_id: null,
    };
  }

  return {
    status: "in_progress",
    winner_id: null,
    loser_id: null,
    forfeit_player_id: null,
  };
}

const AppContext = createContext<AppContextValue | null>(null);

// -------------------------------------------------------
// Provider
// -------------------------------------------------------
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [networkMessageSettings, setNetworkMessageSettings] = useState<AppNetworkMessageSettings>(
    loadAppNetworkMessageSettings
  );
  const [players, setPlayers] = useState<Player[]>([]);
  const [characters, setCharacters] = useState<CharacterMaster[]>([]);
  const [characterLists, setCharacterLists] = useState<CharacterList[]>([]);
  const [tournamentList, setTournamentList] = useState<Tournament[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<TournamentPlayer[]>([]);
  const [admins, setAdmins] = useState<TournamentAdmin[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchActionLogs, setMatchActionLogs] = useState<MatchActionLog[]>([]);
  const [trees, setTrees] = useState<BracketTree[]>([]);
  const [roundLocks, setRoundLocks] = useState<RoundLock[]>([]);
  const [pinnedTournamentId, setPinnedTournamentId] = useState<string | null>(null);

  // Ref to track active tournament id (avoids stale closure in callbacks)
  const activeTournamentIdRef = useRef<string | null>(null);
  // Guard against double-load in React StrictMode dev
  const loadedRef = useRef(false);
  const tournamentWideForfeitMapRef = useRef<Record<string, string[]>>(loadTournamentWideForfeitMap());

  const mergeTournamentWideForfeitPlayerIds = useCallback(
    (tournamentId: string, playerIds: string[]): string[] => {
      const normalized = playerIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && !isDummyPlayerId(id));
      const existing = tournamentWideForfeitMapRef.current[tournamentId] ?? [];
      if (normalized.length === 0) return existing;
      const merged = [...new Set([...existing, ...normalized])];
      tournamentWideForfeitMapRef.current = {
        ...tournamentWideForfeitMapRef.current,
        [tournamentId]: merged,
      };
      saveTournamentWideForfeitMap(tournamentWideForfeitMapRef.current);
      return merged;
    },
    []
  );

  const removeTournamentWideForfeitPlayerIds = useCallback(
    (tournamentId: string, playerIds: string[]): string[] => {
      const normalized = playerIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && !isDummyPlayerId(id));
      if (normalized.length === 0) {
        return tournamentWideForfeitMapRef.current[tournamentId] ?? [];
      }

      const removalSet = new Set(normalized);
      const existing = tournamentWideForfeitMapRef.current[tournamentId] ?? [];
      const next = existing.filter((id) => !removalSet.has(id));

      if (next.length === existing.length) return existing;

      const updated = { ...tournamentWideForfeitMapRef.current };
      if (next.length > 0) {
        updated[tournamentId] = next;
      } else {
        delete updated[tournamentId];
      }

      tournamentWideForfeitMapRef.current = updated;
      saveTournamentWideForfeitMap(updated);
      return next;
    },
    []
  );

  // ---- loaders ----
  const fetchPlayers = useCallback(async () => {
    const data = await getAllPlayers();
    setPlayers(data);
  }, []);

  const fetchCharacters = useCallback(async () => {
    const data = await getCharacterMasters();
    setCharacters(data);
  }, []);

  const fetchCharacterLists = useCallback(async () => {
    const data = await getCharacterLists();
    setCharacterLists(data);
  }, []);

  const repairDoubleElimGrandFinal = useCallback(
    async (t: Tournament, allMatches: Match[]): Promise<boolean> => {
      if (t.type !== "double_elimination") return false;

      const treeIds = new Set(allMatches.map((m) => m.tree_id));
      let changed = false;

      for (const treeId of treeIds) {
        const scoped = allMatches.filter((m) => m.tree_id === treeId);
        const grandFinal = scoped.find((m) => m.bracket === "grand_final");
        if (!grandFinal) continue;

        const winnersFinal = [...scoped]
          .filter((m) => m.bracket === "winners")
          .sort((a, b) => b.round - a.round || b.position - a.position)[0];
        const losersFinal = [...scoped]
          .filter((m) => m.bracket === "losers")
          .sort((a, b) => b.round - a.round || b.position - a.position)[0];

        if (
          winnersFinal &&
          (winnersFinal.next_match_id !== grandFinal.id || winnersFinal.next_match_slot !== 1)
        ) {
          await updateMatchProgressionLinks(
            winnersFinal.id,
            grandFinal.id,
            1,
            winnersFinal.loser_next_match_id,
            winnersFinal.loser_next_match_slot
          );
          changed = true;
        }

        if (
          losersFinal &&
          (losersFinal.next_match_id !== grandFinal.id || losersFinal.next_match_slot !== 2)
        ) {
          await updateMatchProgressionLinks(
            losersFinal.id,
            grandFinal.id,
            2,
            losersFinal.loser_next_match_id,
            losersFinal.loser_next_match_slot
          );
          changed = true;
        }

        if (winnersFinal?.status === "completed" && winnersFinal.winner_id) {
          const winnerCharacterName =
            winnersFinal.winner_id === winnersFinal.player1_id
              ? winnersFinal.player1_character_name
              : winnersFinal.winner_id === winnersFinal.player2_id
              ? winnersFinal.player2_character_name
              : null;
          if (grandFinal.player1_id !== winnersFinal.winner_id) {
            await updateMatchPlayerWithCharacter(
              grandFinal.id,
              1,
              winnersFinal.winner_id,
              winnerCharacterName ?? null
            );
            changed = true;
          }
        }

        if (losersFinal?.status === "completed" && losersFinal.winner_id) {
          const winnerCharacterName =
            losersFinal.winner_id === losersFinal.player1_id
              ? losersFinal.player1_character_name
              : losersFinal.winner_id === losersFinal.player2_id
              ? losersFinal.player2_character_name
              : null;
          if (grandFinal.player2_id !== losersFinal.winner_id) {
            await updateMatchPlayerWithCharacter(
              grandFinal.id,
              2,
              losersFinal.winner_id,
              winnerCharacterName ?? null
            );
            changed = true;
          }
        }
      }

      return changed;
    },
    []
  );

  // Load a specific tournament's data by id
  const loadTournamentData = useCallback(async (id: string | null) => {
    if (!id) {
      setTournament(null);
      setParticipants([]);
      setAdmins([]);
      setMatches([]);
      setMatchActionLogs([]);
      setTrees([]);
      setRoundLocks([]);
      return;
    }
    const t = await getTournamentById(id);
    setTournament(t);
    if (t) {
      const [loadedParticipants, loadedAdmins, loadedMatches, loadedActionLogs, tr, rl] = await Promise.all([
        getTournamentPlayers(t.id),
        getTournamentAdmins(t.id).catch((error) => {
          console.error("管理者一覧の取得に失敗しました", error);
          return [];
        }),
        getMatchesByTournament(t.id),
        getMatchActionLogsByTournament(t.id).catch((error) => {
          console.error("認証履歴の取得に失敗しました", error);
          return [];
        }),
        getBracketTrees(t.id),
        getRoundLocks(t.id),
      ]);

      const repairedParticipantCodes = await ensureParticipantCodes(t, loadedParticipants).catch((error) => {
        console.error("参加者コード補完に失敗しました", error);
        return false;
      });
      const repairedAdminCodes = await ensureAdminCodes(t, loadedAdmins).catch((error) => {
        console.error("管理者コード補完に失敗しました", error);
        return false;
      });
      const p = repairedParticipantCodes
        ? await getTournamentPlayers(t.id)
        : loadedParticipants;
      const a = repairedAdminCodes
        ? await getTournamentAdmins(t.id)
        : loadedAdmins;

      const repaired = await repairDoubleElimGrandFinal(t, loadedMatches);
      const m = repaired ? await getMatchesByTournament(t.id) : loadedMatches;

      setParticipants(p);
      setAdmins(a);
      setMatches(m);
      setMatchActionLogs(loadedActionLogs);
      setTrees(tr);
      setRoundLocks(rl);
    } else {
      setTournament(null);
      setParticipants([]);
      setAdmins([]);
      setMatches([]);
      setMatchActionLogs([]);
      setTrees([]);
      setRoundLocks([]);
    }
  }, [repairDoubleElimGrandFinal]);

  const fetchTournament = useCallback(async () => {
    const [list] = await Promise.all([
      getAllTournaments(),
      loadTournamentData(activeTournamentIdRef.current),
    ]);
    setTournamentList(list);
  }, [loadTournamentData]);

  // Initial load on mount
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const init = async () => {
      const savedId = localStorage.getItem("activeTournamentId");
      const savedPinnedId = localStorage.getItem("pinnedTournamentId");
      const [playerData, tList] = await Promise.all([
        getAllPlayers(),
        getAllTournaments(),
      ]);
      setPlayers(playerData);
      setTournamentList(tList);
      setCharacters(await getCharacterMasters());
      setCharacterLists(await getCharacterLists());
      setPinnedTournamentId(savedPinnedId && tList.some((t) => t.id === savedPinnedId) ? savedPinnedId : null);

      // Restore saved active tournament, or pick the most recent non-finalized
      let activeId: string | null = null;
      if (savedId && tList.some((t) => t.id === savedId)) {
        activeId = savedId;
      } else if (savedPinnedId && tList.some((t) => t.id === savedPinnedId)) {
        activeId = savedPinnedId;
      } else if (tList.length > 0) {
        const nonFinal = tList.filter((t) => t.status !== "finalized");
        activeId = (nonFinal[0] ?? tList[0])?.id ?? null;
      }

      activeTournamentIdRef.current = activeId;
      if (activeId) {
        if (activeId !== savedId) localStorage.setItem("activeTournamentId", activeId);
        await loadTournamentData(activeId);
      }
    };

    init().finally(() => setInitialized(true));
  }, [loadTournamentData]);

  // ---- Player mutations ----
  const addPlayer = useCallback(
    async (
      name: string,
      character_name: string | null,
      attributes: Record<string, string>
    ) => {
      const id = uuidv4();
      await createPlayer(id, name, character_name, attributes);
      await fetchPlayers();
      return id;
    },
    [fetchPlayers]
  );

  const editPlayer = useCallback(
    async (
      id: string,
      name: string,
      character_name: string | null,
      attributes: Record<string, string>
    ) => {
      await updatePlayer(id, name, character_name, attributes);
      await fetchPlayers();
    },
    [fetchPlayers]
  );

  const dqPlayer = useCallback(
    async (id: string, dq: boolean) => {
      await setPlayerDq(id, dq);
      await fetchPlayers();
    },
    [fetchPlayers]
  );

  const removePlayer = useCallback(
    async (id: string) => {
      await deletePlayer(id);
      await fetchPlayers();
    },
    [fetchPlayers]
  );

  const getPlayer = useCallback(
    async (id: string) => getPlayerById(id),
    []
  );

  const addCharacter = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await createCharacterMaster(uuidv4(), trimmed);
    await fetchCharacters();
  }, [fetchCharacters]);

  const removeCharacter = useCallback(async (id: string) => {
    await deleteCharacterMaster(id);
    await fetchCharacters();
  }, [fetchCharacters]);

  const addCharacterList = useCallback(async (name: string, categoryName: string, items: string[]) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await createCharacterList(uuidv4(), trimmed, categoryName, normalizeCharacterList(items));
    await fetchCharacterLists();
  }, [fetchCharacterLists]);

  const editCharacterList = useCallback(async (id: string, name: string, categoryName: string, items: string[]) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await updateCharacterList(id, trimmed, categoryName, normalizeCharacterList(items));
    await fetchCharacterLists();
  }, [fetchCharacterLists]);

  const removeCharacterList = useCallback(async (id: string) => {
    await deleteCharacterList(id);
    await fetchCharacterLists();
  }, [fetchCharacterLists]);

  // ---- Tournament mutations ----
  const selectTournament = useCallback(
    async (id: string | null) => {
      activeTournamentIdRef.current = id;
      if (id) {
        localStorage.setItem("activeTournamentId", id);
      } else {
        localStorage.removeItem("activeTournamentId");
      }
      await loadTournamentData(id);
    },
    [loadTournamentData]
  );

  const setPinnedTournament = useCallback(async (id: string | null) => {
    if (id === null) {
      setPinnedTournamentId(null);
      localStorage.removeItem("pinnedTournamentId");
      return;
    }

    const target = tournamentList.find((t) => t.id === id);
    if (!target) {
      throw new Error("指定された大会が見つかりません");
    }
    if (target.status === "finalized") {
      throw new Error("結果確定済みの大会はピン留めできません");
    }

    setPinnedTournamentId(id);
    localStorage.setItem("pinnedTournamentId", id);
  }, [tournamentList]);

  const finalizeTournament = useCallback(async () => {
    if (!tournament) return;
    await updateTournamentStatus(tournament.id, "finalized");
    if (pinnedTournamentId === tournament.id) {
      setPinnedTournamentId(null);
      localStorage.removeItem("pinnedTournamentId");
    }
    await fetchTournament();
  }, [tournament, fetchTournament, pinnedTournamentId]);

  const createNew = useCallback(
    async (
      event_code: string,
      tournament_code: string,
      type: TournamentType,
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
    ) => {
      const id = uuidv4();
      const normalizedEventCode = normalizeEventCode(event_code);
      const normalizedTournamentCode = normalizeTournamentCode(tournament_code);
      await createTournament(
        id,
        normalizedEventCode,
        normalizedTournamentCode,
        type,
        max_participants,
        grand_final_reset,
        name,
        character_input_mode,
        character_list_name,
        normalizeCharacterList(character_list),
        normalizeCharacterSelectionConfig(
          character_input_mode,
          character_selection_config,
          character_list_name,
          normalizeCharacterList(character_list)
        ),
        default_player_side,
        result_auth_mode,
        forfeit_auth_mode,
        dq_auth_mode
      );

      try {
        const initialAdmin = buildAdminCode(normalizedEventCode, normalizedTournamentCode, max_participants, 1);
        await addTournamentAdmin(
          id,
          uuidv4(),
          initialAdmin.adminCode,
          1,
          initialAdmin.adminId4,
          "管理者",
          {}
        );
      } catch (error) {
        console.error("初期管理者の作成に失敗しました。大会作成は継続します。", error);
      }

      activeTournamentIdRef.current = id;
      localStorage.setItem("activeTournamentId", id);
      await fetchTournament();
    },
    [fetchTournament]
  );

  const removeTournament = useCallback(async (id?: string) => {
    const targetId = id ?? activeTournamentIdRef.current;
    if (!targetId) return;

    const removingActive = activeTournamentIdRef.current === targetId;
    const removingPinned = pinnedTournamentId === targetId;
    await deleteTournament(targetId);

    if (removingActive) {
      activeTournamentIdRef.current = null;
      localStorage.removeItem("activeTournamentId");
      await loadTournamentData(null);
    }
    if (removingPinned) {
      setPinnedTournamentId(null);
      localStorage.removeItem("pinnedTournamentId");
    }

    const list = await getAllTournaments();
    setTournamentList(list);
  }, [loadTournamentData, pinnedTournamentId]);

  const isRoundLocked = useCallback(
    (tree_id: string, bracket: MatchBracket, round: number) =>
      roundLocks.some(
        (r) =>
          r.tree_id === tree_id &&
          r.bracket === bracket &&
          r.round === round
      ),
    [roundLocks]
  );

  const toggleRoundLock = useCallback(
    async (tree_id: string, bracket: MatchBracket, round: number) => {
      if (!tournament) return;
      const locked = isRoundLocked(tree_id, bracket, round);
      if (locked) {
        await unlockRoundAndLater(tournament.id, tree_id, bracket, round);
      } else {
        await lockRound(tournament.id, tree_id, bracket, round);
      }
      await fetchTournament();
    },
    [tournament, isRoundLocked, fetchTournament]
  );

  const addParticipant = useCallback(
    async (
      name: string,
      character_name: string | null,
      attributes: Record<string, string>,
      selected_characters: Record<string, string[]> = {},
      player_id?: string
    ) => {
      if (!tournament) return;
      const id = player_id ?? uuidv4();
      const p = await getTournamentPlayers(tournament.id);
      const nextSequence = getNextPlayerSequence(p);
      const generatedCode = buildPlayerCode(
        tournament.event_code,
        tournament.tournament_code,
        nextSequence,
        name
      );
      const nextSeed = p.length + 1;
      const sanitizedCharacter = validateRequiredCharacterSelection(
        tournament,
        character_name,
        name
      );
      await addTournamentPlayer(
        tournament.id,
        id,
        generatedCode.playerCode,
        nextSequence,
        generatedCode.playerId4,
        nextSeed,
        name,
        sanitizedCharacter,
        attributes,
        selected_characters
      );
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const addAdmin = useCallback(
    async (name: string, attributes: Record<string, string> = {}) => {
      if (!tournament) return;
      const trimmedName = name.trim();
      if (!trimmedName) return;

      const currentAdmins = await getTournamentAdmins(tournament.id);
      const nextSequence = getNextAdminSequence(currentAdmins);
      const generated = buildAdminCode(
        tournament.event_code,
        tournament.tournament_code,
        tournament.max_participants,
        nextSequence
      );
      await addTournamentAdmin(
        tournament.id,
        uuidv4(),
        generated.adminCode,
        nextSequence,
        generated.adminId4,
        trimmedName,
        attributes
      );
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const removeAdmin = useCallback(
    async (admin_id: string) => {
      if (!tournament) return;
      const currentAdmins = await getTournamentAdmins(tournament.id);
      if (currentAdmins.length <= 1) {
        throw new Error("管理者が1名のみのため削除できません");
      }
      await removeTournamentAdmin(tournament.id, admin_id);
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const editAdminName = useCallback(
    async (admin_id: string, name: string) => {
      if (!tournament) return;
      const trimmed = name.trim();
      if (!trimmed) return;

      const currentAdmins = await getTournamentAdmins(tournament.id);
      const current = currentAdmins.find((a) => a.admin_id === admin_id);
      if (!current) return;
      const ordered = [...currentAdmins].sort((a, b) => a.admin_sequence - b.admin_sequence);
      const fallbackSequence = ordered.findIndex((a) => a.admin_id === admin_id) + 1;
      const sequence = current.admin_sequence > 0 ? current.admin_sequence : Math.max(1, fallbackSequence);

      const generated = buildAdminCode(
        normalizeEventCode(tournament.event_code),
        normalizeTournamentCode(tournament.tournament_code),
        tournament.max_participants,
        sequence
      );

      await updateTournamentAdminName(tournament.id, admin_id, trimmed);
      await updateTournamentAdminCode(
        tournament.id,
        admin_id,
        generated.adminCode,
        sequence,
        generated.adminId4
      );
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const removeParticipant = useCallback(
    async (player_id: string) => {
      if (!tournament) return;
      await removeTournamentPlayer(tournament.id, player_id);
      const p = await getTournamentPlayers(tournament.id);
      for (let i = 0; i < p.length; i++) {
        await updateTournamentPlayerSeed(tournament.id, p[i].player_id, i + 1);
      }
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const setParticipantCharacter = useCallback(
    async (player_id: string, character_name: string | null) => {
      if (!tournament) return;
      const participantName =
        participants.find((p) => p.player_id === player_id)?.name ?? "参加者";
      const sanitizedCharacter = validateRequiredCharacterSelection(
        tournament,
        character_name,
        participantName
      );
      await updateTournamentPlayerCharacter(tournament.id, player_id, sanitizedCharacter);
      await fetchTournament();
    },
    [tournament, participants, fetchTournament]
  );

  const setParticipantSelectedCharacters = useCallback(
    async (player_id: string, selected_characters: Record<string, string[]>) => {
      if (!tournament) return;
      await updateTournamentPlayerSelectedCharacters(
        tournament.id,
        player_id,
        selected_characters
      );
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const editParticipantName = useCallback(
    async (player_id: string, name: string) => {
      if (!tournament) return;
      const trimmed = name.trim();
      if (!trimmed) return;

      const currentParticipants = await getTournamentPlayers(tournament.id);
      const current = currentParticipants.find((p) => p.player_id === player_id);
      if (!current) return;
      const ordered = [...currentParticipants].sort((a, b) => a.seed - b.seed);
      const fallbackSequence = ordered.findIndex((p) => p.player_id === player_id) + 1;
      const sequence = current.player_sequence > 0 ? current.player_sequence : Math.max(1, fallbackSequence);

      const generated = buildPlayerCode(
        normalizeEventCode(tournament.event_code),
        normalizeTournamentCode(tournament.tournament_code),
        sequence,
        trimmed
      );

      await updateTournamentPlayerName(tournament.id, player_id, trimmed);
      await updateTournamentPlayerCode(
        tournament.id,
        player_id,
        generated.playerCode,
        sequence,
        generated.playerId4
      );
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const swapSeeds = useCallback(
    async (player_id_a: string, player_id_b: string) => {
      if (!tournament) return;
      const a = participants.find((p) => p.player_id === player_id_a);
      const b = participants.find((p) => p.player_id === player_id_b);
      if (!a || !b) return;
      await updateTournamentPlayerSeed(tournament.id, player_id_a, b.seed);
      await updateTournamentPlayerSeed(tournament.id, player_id_b, a.seed);
      await fetchTournament();
    },
    [tournament, participants, fetchTournament]
  );

  const randomizeSeeds = useCallback(async () => {
    if (!tournament) return false;
    const currentOrder = [...participants]
      .sort((a, b) => a.seed - b.seed)
      .map((p) => p.player_id);
    const shuffled = shuffleArray(currentOrder);
    const changed = shuffled.some((playerId, idx) => playerId !== currentOrder[idx]);
    for (let i = 0; i < shuffled.length; i++) {
      await updateTournamentPlayerSeed(tournament.id, shuffled[i], i + 1);
    }
    await fetchTournament();
    return changed;
  }, [tournament, participants, fetchTournament]);

  const generateBracket = useCallback(async () => {
    if (!tournament) return;

    // Freeze character-list snapshot and list name at tournament start.
    await updateTournamentSettingsDb(
      tournament.id,
      tournament.event_code,
      normalizeTournamentCode(tournament.tournament_code),
      tournament.type,
      tournament.max_participants,
      tournament.grand_final_reset,
      tournament.character_input_mode,
      tournament.character_list_name,
      tournament.character_list,
      tournament.character_selection_config,
      tournament.default_player_side,
      tournament.result_auth_mode,
      tournament.forfeit_auth_mode,
      tournament.dq_auth_mode
    );

    await deleteMatchesByTournament(tournament.id);
    await deleteBracketTreesByTournament(tournament.id);

    // Create the main bracket tree
    const treeId = uuidv4();
    await insertBracketTree({
      id: treeId,
      tournament_id: tournament.id,
      name: "メインブラケット",
      created_at: new Date().toISOString(),
    });

    const p = await getTournamentPlayers(tournament.id);
    const sorted = [...p].sort((a, b) => a.seed - b.seed);
    const playerIds: (string | null)[] = sorted.map((tp) => tp.player_id);

    const newMatches =
      tournament.type === "single_elimination"
        ? generateSingleElimination(tournament.id, playerIds, treeId)
        : generateDoubleElimination(tournament.id, playerIds, treeId);

    for (const m of newMatches) {
      await insertMatch(applyDefaultMatchSides(m, tournament.default_player_side));
    }
    await syncPendingMatchSides(tournament);
    await updateTournamentStatus(tournament.id, "in_progress");
    setPinnedTournamentId(tournament.id);
    localStorage.setItem("pinnedTournamentId", tournament.id);
    await fetchTournament();
  }, [tournament, fetchTournament]);

  const clearBracket = useCallback(async () => {
    if (!tournament) return;
    await deleteMatchesByTournament(tournament.id);
    await deleteBracketTreesByTournament(tournament.id);
    await fetchTournament();
  }, [tournament, fetchTournament]);

  const setGrandFinalReset = useCallback(
    async (enabled: boolean) => {
      if (!tournament) return;
      await updateTournamentSettingsDb(
        tournament.id,
        tournament.event_code,
        normalizeTournamentCode(tournament.tournament_code),
        tournament.type,
        tournament.max_participants,
        enabled,
        tournament.character_input_mode,
        tournament.character_list_name,
        tournament.character_list,
        tournament.character_selection_config,
        tournament.default_player_side,
        tournament.result_auth_mode,
        tournament.forfeit_auth_mode,
        tournament.dq_auth_mode
      );
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const updateTournamentSettings = useCallback(
    async (
      event_code: string,
      tournament_code: string,
      type: TournamentType,
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
    ) => {
      if (!tournament) return;
      const normalizedEventCode = normalizeEventCode(event_code);
      const normalizedTournamentCode = normalizeTournamentCode(tournament_code);
      await updateTournamentSettingsDb(
        tournament.id,
        normalizedEventCode,
        normalizedTournamentCode,
        type,
        max_participants,
        grand_final_reset,
        character_input_mode,
        character_list_name,
        normalizeCharacterList(character_list),
        normalizeCharacterSelectionConfig(
          character_input_mode,
          character_selection_config,
          character_list_name,
          normalizeCharacterList(character_list)
        ),
        default_player_side,
        result_auth_mode,
        forfeit_auth_mode,
        dq_auth_mode
      );

      if (
        normalizedEventCode !== normalizeEventCode(tournament.event_code) ||
        normalizedTournamentCode !== normalizeTournamentCode(tournament.tournament_code)
      ) {
        const allParticipants = await getTournamentPlayers(tournament.id);
        for (const participant of allParticipants) {
          const sequence = participant.player_sequence > 0 ? participant.player_sequence : participant.seed;
          const generated = buildPlayerCode(
            normalizedEventCode,
            normalizedTournamentCode,
            sequence,
            participant.name
          );
          await updateTournamentPlayerCode(
            tournament.id,
            participant.player_id,
            generated.playerCode,
            sequence,
            generated.playerId4
          );
        }
      }

      if (
        normalizedEventCode !== normalizeEventCode(tournament.event_code) ||
        normalizedTournamentCode !== normalizeTournamentCode(tournament.tournament_code) ||
        max_participants !== tournament.max_participants
      ) {
        const allAdmins = await getTournamentAdmins(tournament.id);
        for (const admin of allAdmins) {
          const sequence = admin.admin_sequence > 0 ? admin.admin_sequence : 1;
          const generated = buildAdminCode(
            normalizedEventCode,
            normalizedTournamentCode,
            max_participants,
            sequence
          );
          await updateTournamentAdminCode(
            tournament.id,
            admin.admin_id,
            generated.adminCode,
            sequence,
            generated.adminId4
          );
        }
      }

      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const setTournamentStatus = useCallback(
    async (status: TournamentStatus) => {
      if (!tournament) return;
      await updateTournamentStatus(tournament.id, status);
      if (status === "in_progress") {
        setPinnedTournamentId(tournament.id);
        localStorage.setItem("pinnedTournamentId", tournament.id);
      }
      if (status === "finalized" && pinnedTournamentId === tournament.id) {
        setPinnedTournamentId(null);
        localStorage.removeItem("pinnedTournamentId");
      }
      await fetchTournament();
    },
    [tournament, fetchTournament, pinnedTournamentId]
  );

  // ---- Match mutations ----
  const startMatch = useCallback(async (match_id: string) => {
    const target = matches.find((m) => m.id === match_id);
    if (!target || target.status !== "pending") return;

    const incomingBySlot = buildIncomingBySlot(matches);
    if (getUiMatchState(target, incomingBySlot) !== "ready") return;

    let nextP1Side: MatchPlayerSide = target.player1_side;
    let nextP2Side: MatchPlayerSide = target.player2_side;
    if (nextP1Side === "-" || nextP2Side === "-") {
      const resolvedSides = resolveDefaultMatchSides(tournament?.default_player_side ?? "upper_1p");
      nextP1Side = resolvedSides.player1_side;
      nextP2Side = resolvedSides.player2_side;
      await updateMatchSides(match_id, nextP1Side, nextP2Side);
    }

    await updateMatchStatus(match_id, "in_progress");
    // Refresh matches list
    setMatches((prev) =>
      prev.map((m) =>
        m.id === match_id
          ? {
              ...m,
              status: "in_progress",
              player1_side: nextP1Side,
              player2_side: nextP2Side,
            }
          : m
      )
    );
  }, [matches, tournament]);

  const setMatchReady = useCallback(async (match_id: string) => {
    const target = matches.find((m) => m.id === match_id);
    if (!target || target.status !== "in_progress") return;

    await resetMatchToPending(match_id);
    const nextSides = resolveDefaultMatchSides(tournament?.default_player_side ?? "upper_1p");
    await updateMatchSides(match_id, nextSides.player1_side, nextSides.player2_side);
    setMatches((prev) =>
      prev.map((m) =>
        m.id === match_id
          ? {
              ...m,
              status: "pending",
              player1_wins: 0,
              player2_wins: 0,
              winner_id: null,
              forfeit_player_id: null,
              player1_side: nextSides.player1_side,
              player2_side: nextSides.player2_side,
            }
          : m
      )
    );
  }, [matches]);

  const setMatchCharacters = useCallback(
    async (
      match: Match,
      player1_character_name: string | null,
      player2_character_name: string | null
    ) => {
      if (!tournament) return;

      const validatedP1Character =
        match.player1_id && !isDummyPlayerId(match.player1_id)
          ? validateRequiredCharacterSelection(tournament, player1_character_name, "プレイヤー1")
          : sanitizeCharacterByTournament(tournament, player1_character_name);
      const validatedP2Character =
        match.player2_id && !isDummyPlayerId(match.player2_id)
          ? validateRequiredCharacterSelection(tournament, player2_character_name, "プレイヤー2")
          : sanitizeCharacterByTournament(tournament, player2_character_name);

      await updateMatchCharacters(
        match.id,
        validatedP1Character,
        validatedP2Character
      );

      setMatches((prev) =>
        prev.map((m) =>
          m.id === match.id
            ? {
                ...m,
                player1_character_name: validatedP1Character,
                player2_character_name: validatedP2Character,
              }
            : m
        )
      );
    },
    [tournament]
  );

  const swapMatchSides = useCallback(async (match_id: string) => {
    const target = matches.find((m) => m.id === match_id);
    if (!target) return;

    const nextP1Side = target.player2_side;
    const nextP2Side = target.player1_side;
    await updateMatchSides(match_id, nextP1Side, nextP2Side);
    setMatches((prev) =>
      prev.map((m) =>
        m.id === match_id
          ? { ...m, player1_side: nextP1Side, player2_side: nextP2Side }
          : m
      )
    );
  }, [matches]);

  const randomizeMatchSides = useCallback(async (match_id: string) => {
    const target = matches.find((m) => m.id === match_id);
    if (!target) {
      return { player1_side: "1P" as const, player2_side: "2P" as const };
    }

    const keepDefault = Math.random() < 0.5;
    const nextP1Side: "1P" | "2P" = keepDefault ? "1P" : "2P";
    const nextP2Side: "1P" | "2P" = keepDefault ? "2P" : "1P";
    await updateMatchSides(match_id, nextP1Side, nextP2Side);
    setMatches((prev) =>
      prev.map((m) =>
        m.id === match_id
          ? { ...m, player1_side: nextP1Side, player2_side: nextP2Side }
          : m
      )
    );
    return { player1_side: nextP1Side, player2_side: nextP2Side };
  }, [matches]);

  const applyTournamentWideForfeits = useCallback(
    async (tournamentId: string, playerIds: string[]): Promise<boolean> => {
      if (!tournament) return false;
      const targetPlayerIds = [...new Set(playerIds.filter((id) => !!id && !isDummyPlayerId(id)))];
      if (targetPlayerIds.length === 0) return false;

      let changed = false;
      let guard = 0;

      while (guard < 512) {
        guard += 1;
        const snapshot = await getMatchesByTournament(tournamentId);
        let progressed = false;

        outer: for (const targetPlayerId of targetPlayerIds) {
          for (const m of snapshot) {
            if (m.status === "completed") continue;
            if (m.player1_id !== targetPlayerId && m.player2_id !== targetPlayerId) continue;

            const outcome = resolveMatchOutcome(
              m,
              snapshot,
              m.player1_wins,
              m.player2_wins,
              [targetPlayerId],
              null
            );
            if (outcome.status !== "completed") continue;

            await updateMatchScore(
              m.id,
              m.player1_wins,
              m.player2_wins,
              "completed",
              outcome.winner_id,
              outcome.forfeit_player_id
            );

            await writeMatchActionLogs(tournamentId, m.id, [targetPlayerId], null);

            const winnerCharacterName =
              outcome.winner_id === m.player1_id
                ? m.player1_character_name
                : outcome.winner_id === m.player2_id
                ? m.player2_character_name
                : null;
            const loserCharacterName =
              outcome.loser_id === m.player1_id
                ? m.player1_character_name
                : outcome.loser_id === m.player2_id
                ? m.player2_character_name
                : null;

            if (outcome.winner_id && m.next_match_id && m.next_match_slot) {
              await updateMatchPlayerWithCharacter(
                m.next_match_id,
                m.next_match_slot as 1 | 2,
                outcome.winner_id,
                winnerCharacterName
              );
            }
            if (
              tournament.type === "double_elimination" &&
              outcome.loser_id &&
              m.loser_next_match_id &&
              m.loser_next_match_slot
            ) {
              await updateMatchPlayerWithCharacter(
                m.loser_next_match_id,
                m.loser_next_match_slot as 1 | 2,
                outcome.loser_id,
                loserCharacterName
              );
            }

            if (
              m.bracket === "grand_final" &&
              tournament.type === "double_elimination" &&
              tournament.grand_final_reset &&
              outcome.winner_id === m.player2_id &&
              m.player1_id &&
              m.player2_id
            ) {
              const hasResetMatch = snapshot.some(
                (candidate) => candidate.tree_id === m.tree_id && candidate.bracket === "grand_final_reset"
              );
              if (!hasResetMatch) {
                const resetMatch = createGrandFinalResetMatch(
                  tournament.id,
                  m.tree_id,
                  m,
                  m.player2_id,
                  m.player1_id
                );
                await insertMatch(applyDefaultMatchSides(resetMatch, tournament.default_player_side));
              }
            }

            progressed = true;
            changed = true;
            break outer;
          }
        }

        if (!progressed) break;
      }

      return changed;
    },
    [tournament]
  );

  const recordScore = useCallback(
    async (
      match: Match,
      player1_wins: number,
      player2_wins: number,
      forfeit_player_ids: string[],
      forced_loser_id: string | null = null,
      player1_character_name: string | null = null,
      player2_character_name: string | null = null,
      auth?: ScoreActionAuth,
      forfeit_all_matches_player_ids: string[] = []
    ) => {
      if (!tournament) return;

      let activeTournamentWideForfeitIds = mergeTournamentWideForfeitPlayerIds(
        tournament.id,
        forfeit_all_matches_player_ids
      );

      const currentForfeitSet = new Set(forfeit_player_ids);
      const clearForfeitCandidates =
        forced_loser_id == null
          ? [match.player1_id, match.player2_id]
              .filter((id): id is string => !!id && !isDummyPlayerId(id))
              .filter((id) => !currentForfeitSet.has(id))
          : [];
      if (clearForfeitCandidates.length > 0) {
        activeTournamentWideForfeitIds = removeTournamentWideForfeitPlayerIds(
          tournament.id,
          clearForfeitCandidates
        );
      }

      const validatedP1Character =
        match.player1_id && !isDummyPlayerId(match.player1_id)
          ? validateRequiredCharacterSelection(tournament, player1_character_name, "プレイヤー1")
          : sanitizeCharacterByTournament(tournament, player1_character_name);
      const validatedP2Character =
        match.player2_id && !isDummyPlayerId(match.player2_id)
          ? validateRequiredCharacterSelection(tournament, player2_character_name, "プレイヤー2")
          : sanitizeCharacterByTournament(tournament, player2_character_name);

      await updateMatchCharacters(
        match.id,
        validatedP1Character,
        validatedP2Character
      );

      const { status, winner_id, loser_id, forfeit_player_id } = resolveMatchOutcome(
        match,
        matches,
        player1_wins,
        player2_wins,
        forfeit_player_ids,
        forced_loser_id
      );

      await updateMatchScore(
        match.id,
        player1_wins,
        player2_wins,
        status,
        winner_id,
        forfeit_player_id
      );

      if (match.status !== "completed" && status === "completed") {
        await writeMatchActionLogs(
          tournament.id,
          match.id,
          forfeit_player_ids,
          forced_loser_id,
          auth
        );
      }

      if (status === "completed") {
        const winnerCharacterName =
          winner_id === match.player1_id
            ? validatedP1Character
            : winner_id === match.player2_id
            ? validatedP2Character
            : null;
        const loserCharacterName =
          loser_id === match.player1_id
            ? validatedP1Character
            : loser_id === match.player2_id
            ? validatedP2Character
            : null;

        if (winner_id && match.next_match_id && match.next_match_slot) {
          await updateMatchPlayerWithCharacter(
            match.next_match_id,
            match.next_match_slot as 1 | 2,
            winner_id,
            winnerCharacterName
          );
        }
        if (
          tournament.type === "double_elimination" &&
          loser_id &&
          match.loser_next_match_id &&
          match.loser_next_match_slot
        ) {
          await updateMatchPlayerWithCharacter(
            match.loser_next_match_id,
            match.loser_next_match_slot as 1 | 2,
            loser_id,
            loserCharacterName
          );
        }
        // Grand Final Reset: losers side (player2 slot) wins
        if (
          match.bracket === "grand_final" &&
          tournament.type === "double_elimination" &&
          tournament.grand_final_reset &&
          winner_id === match.player2_id &&
          match.player1_id &&
          match.player2_id
        ) {
          const resetMatch = createGrandFinalResetMatch(
            tournament.id,
            match.tree_id,
            match,
            match.player2_id,
            match.player1_id
          );
          await insertMatch(applyDefaultMatchSides(resetMatch, tournament.default_player_side));
        }
      }

      if (activeTournamentWideForfeitIds.length > 0) {
        await applyTournamentWideForfeits(tournament.id, activeTournamentWideForfeitIds);
      }

      await syncPendingMatchSides(tournament);

      // Check if tournament is complete (no more non-completed matches with both players)
      if (status === "completed") {
        const remaining = await getMatchesByTournament(tournament.id);
        const hasMore = remaining.some(
          (m) =>
            m.status !== "completed" &&
            (m.player1_id !== null || m.player2_id !== null)
        );
        if (!hasMore) {
          await updateTournamentStatus(tournament.id, "completed");
        }
      }

      await fetchTournament();
    },
    [
      tournament,
      fetchTournament,
      mergeTournamentWideForfeitPlayerIds,
      removeTournamentWideForfeitPlayerIds,
      applyTournamentWideForfeits,
    ]
  );

  // ---- Bracket tree mutations ----
  const addBracketTree = useCallback(
    async (name: string): Promise<string> => {
      if (!tournament) return "";
      const existingTreeId = trees[0]?.id;
      if (existingTreeId) {
        if (name.trim() && name.trim() !== trees[0]?.name) {
          await renameBracketTree(existingTreeId, name.trim());
          await fetchTournament();
        }
        return existingTreeId;
      }
      const id = uuidv4();
      await insertBracketTree({
        id,
        tournament_id: tournament.id,
        name,
        created_at: new Date().toISOString(),
      });
      await fetchTournament();
      return id;
    },
    [tournament, trees, fetchTournament]
  );

  const renameBracketTreeItem = useCallback(
    async (id: string, name: string) => {
      await renameBracketTree(id, name);
      await fetchTournament();
    },
    [fetchTournament]
  );

  const removeBracketTree = useCallback(
    async (id: string) => {
      await deleteBracketTree(id);
      await fetchTournament();
    },
    [fetchTournament]
  );

  const addMidTournamentMatch = useCallback(
    async (
      tree_id: string,
      round: number,
      bracket: MatchBracket,
      player1_id: string,
      player2_id: string | null
    ) => {
      if (!tournament) return;
      const pos = matches.filter(
        (m) => m.round === round && m.bracket === bracket && m.tree_id === tree_id
      ).length;
      const match: Match = {
        id: uuidv4(),
        tournament_id: tournament.id,
        tree_id,
        round,
        position: pos,
        bracket,
        player1_id,
        player2_id,
        winner_id: null,
        player1_wins: 0,
        player2_wins: 0,
        player1_character_name: null,
        player2_character_name: null,
        player1_side: "-",
        player2_side: "-",
        status: "pending",
        forfeit_player_id: null,
        next_match_id: null,
        next_match_slot: null,
        loser_next_match_id: null,
        loser_next_match_slot: null,
      };
      await insertMatch(applyDefaultMatchSides(match, tournament.default_player_side));
      await syncPendingMatchSides(tournament);
      await fetchTournament();
    },
    [tournament, matches, fetchTournament]
  );

  const correctScore = useCallback(
    async (
      match: Match,
      player1_wins: number,
      player2_wins: number,
      forfeit_player_ids: string[],
      forced_loser_id: string | null = null,
      player1_character_name: string | null = null,
      player2_character_name: string | null = null,
      auth?: ScoreActionAuth,
      forfeit_all_matches_player_ids: string[] = []
    ) => {
      if (!tournament) return;

      let activeTournamentWideForfeitIds = mergeTournamentWideForfeitPlayerIds(
        tournament.id,
        forfeit_all_matches_player_ids
      );

      const currentForfeitSet = new Set(forfeit_player_ids);
      const clearForfeitCandidates =
        forced_loser_id == null
          ? [match.player1_id, match.player2_id]
              .filter((id): id is string => !!id && !isDummyPlayerId(id))
              .filter((id) => !currentForfeitSet.has(id))
          : [];
      if (clearForfeitCandidates.length > 0) {
        activeTournamentWideForfeitIds = removeTournamentWideForfeitPlayerIds(
          tournament.id,
          clearForfeitCandidates
        );
      }

      const validatedP1Character =
        match.player1_id && !isDummyPlayerId(match.player1_id)
          ? validateRequiredCharacterSelection(tournament, player1_character_name, "プレイヤー1")
          : sanitizeCharacterByTournament(tournament, player1_character_name);
      const validatedP2Character =
        match.player2_id && !isDummyPlayerId(match.player2_id)
          ? validateRequiredCharacterSelection(tournament, player2_character_name, "プレイヤー2")
          : sanitizeCharacterByTournament(tournament, player2_character_name);

      await updateMatchCharacters(
        match.id,
        validatedP1Character,
        validatedP2Character
      );

      const {
        winner_id: newWinnerId,
        loser_id: newLoserId,
        forfeit_player_id,
        status: resolvedStatus,
      } = resolveMatchOutcome(
        match,
        matches,
        player1_wins,
        player2_wins,
        forfeit_player_ids,
        forced_loser_id
      );

      const oldWinnerId = match.winner_id;
      const oldLoserId =
        oldWinnerId
          ? match.player1_id === oldWinnerId
            ? match.player2_id
            : match.player1_id
          : null;

      const bothDq = forfeit_player_ids.length >= 2;
      const newStatus =
        resolvedStatus === "completed" || newWinnerId || newLoserId || bothDq
          ? "completed"
          : "in_progress";

      if (newWinnerId !== oldWinnerId) {
        const newWinnerCharacterName =
          newWinnerId === match.player1_id
            ? validatedP1Character
            : newWinnerId === match.player2_id
            ? validatedP2Character
            : null;
        const newLoserCharacterName =
          newLoserId === match.player1_id
            ? validatedP1Character
            : newLoserId === match.player2_id
            ? validatedP2Character
            : null;

        // Cascade-reset all downstream matches first
        await performCascadeReset(match, oldWinnerId, oldLoserId, matches);

        // Update this match with the corrected result
        await updateMatchScore(match.id, player1_wins, player2_wins, newStatus, newWinnerId, forfeit_player_id);

        if (match.status !== "completed" && newStatus === "completed") {
          await writeMatchActionLogs(
            tournament.id,
            match.id,
            forfeit_player_ids,
            forced_loser_id,
            auth
          );
        }

        // Place the new winner/loser in their downstream slots
        if (newWinnerId && match.next_match_id && match.next_match_slot) {
          await updateMatchPlayerWithCharacter(
            match.next_match_id,
            match.next_match_slot as 1 | 2,
            newWinnerId,
            newWinnerCharacterName
          );
        }
        if (
          tournament.type === "double_elimination" &&
          newLoserId &&
          match.loser_next_match_id &&
          match.loser_next_match_slot
        ) {
          await updateMatchPlayerWithCharacter(
            match.loser_next_match_id,
            match.loser_next_match_slot as 1 | 2,
            newLoserId,
            newLoserCharacterName
          );
        }
        // Recreate GF reset match if applicable
        if (
          match.bracket === "grand_final" &&
          tournament.type === "double_elimination" &&
          tournament.grand_final_reset &&
          newWinnerId === match.player2_id &&
          match.player1_id &&
          match.player2_id
        ) {
          const resetMatch = createGrandFinalResetMatch(
            tournament.id,
            match.tree_id,
            match,
            match.player2_id,
            match.player1_id
          );
          await insertMatch(applyDefaultMatchSides(resetMatch, tournament.default_player_side));
        }
      } else {
        // Winner unchanged — just update the scores
        await updateMatchScore(match.id, player1_wins, player2_wins, newStatus, newWinnerId, forfeit_player_id);
        if (match.status !== "completed" && newStatus === "completed") {
          await writeMatchActionLogs(
            tournament.id,
            match.id,
            forfeit_player_ids,
            forced_loser_id,
            auth
          );
        }
      }

      if (activeTournamentWideForfeitIds.length > 0) {
        await applyTournamentWideForfeits(tournament.id, activeTournamentWideForfeitIds);
      }

      await syncPendingMatchSides(tournament);

      // Re-sync tournament completion status
      const remaining = await getMatchesByTournament(tournament.id);
      const hasMore = remaining.some(
        (m) => m.status !== "completed" && (m.player1_id !== null || m.player2_id !== null)
      );
      if (!hasMore) {
        await updateTournamentStatus(tournament.id, "completed");
      } else if (tournament.status === "completed") {
        await updateTournamentStatus(tournament.id, "in_progress");
      }

      await fetchTournament();
    },
    [
      tournament,
      matches,
      fetchTournament,
      mergeTournamentWideForfeitPlayerIds,
      removeTournamentWideForfeitPlayerIds,
      applyTournamentWideForfeits,
    ]
  );

  const addParticipantAndAssign = useCallback(
    async (
      name: string,
      character_name: string | null,
      bracket: MatchBracket,
      treeId: string,
      selected_characters: Record<string, string[]> = {},
      player_id?: string
    ) => {
      if (!tournament) return;
      if (bracket !== "winners") {
        throw new Error("途中参加はウィナーズ Round 1 のみ対応しています");
      }
      const p = await getTournamentPlayers(tournament.id);
      const requiredSlots = 1;

      if (p.length + requiredSlots > tournament.max_participants) {
        throw new Error("参加者上限に達しているため追加できません");
      }

      const sanitizedCharacter = validateRequiredCharacterSelection(
        tournament,
        character_name,
        name
      );

      const playerId = player_id ?? uuidv4();
      const nextSequence = getNextPlayerSequence(p);
      const generatedCode = buildPlayerCode(
        tournament.event_code,
        tournament.tournament_code,
        nextSequence,
        name
      );
      const nextSeed = p.length + 1;
      await addTournamentPlayer(
        tournament.id,
        playerId,
        generatedCode.playerCode,
        nextSequence,
        generatedCode.playerId4,
        nextSeed,
        name,
        sanitizedCharacter,
        {},
        selected_characters
      );

      const assignmentBracket: MatchBracket = "winners";

      const currentMatches = await getMatchesByTournament(tournament.id);
      const scoped = currentMatches.filter(
        (m) => m.bracket === assignmentBracket && m.tree_id === treeId
      );
      const incomingBySlot = buildIncomingBySlot(currentMatches);
      const targetRound = 1;

      if (isRoundLocked(treeId, assignmentBracket, targetRound)) {
        throw new Error(`Round ${targetRound} は確定済みのため追加できません`);
      }

      const pending = currentMatches.filter(
        (m) =>
          m.bracket === assignmentBracket &&
          m.tree_id === treeId &&
          m.status === "pending" &&
          m.round === targetRound
      );

      // BYE slot = pending match that has exactly one player assigned
      // (both-null matches are TBD downstream slots, not BYEs)
      const byeMatch = pending.find(
        (m) => {
          const incoming = incomingBySlot.get(m.id) ?? { slot1: false, slot2: false };
          const isByeSlot1 = m.player1_id === null && !incoming.slot1;
          const isByeSlot2 = m.player2_id === null && !incoming.slot2;
          return (m.player1_id !== null && isByeSlot2) || (isByeSlot1 && m.player2_id !== null);
        }
      );
      if (byeMatch) {
        const incoming = incomingBySlot.get(byeMatch.id) ?? { slot1: false, slot2: false };
        const slot = byeMatch.player1_id === null && !incoming.slot1 ? 1 : 2;
        await updateMatchPlayer(byeMatch.id, slot, playerId);
        await syncPendingMatchSides(tournament);
        await fetchTournament();
        return;
      }

      const round1Capacity = scoped.filter((m) => m.round === targetRound).length * 2;
      if (round1Capacity >= tournament.max_participants) {
        throw new Error("Round 1 の空き枠がないため追加できません");
      }

      // No BYE — create a new pending match for this player
      const targetRoundMatches = scoped.filter((m) => m.round === targetRound);
      const pos = targetRoundMatches.length;
      const match: Match = {
        id: uuidv4(),
        tournament_id: tournament.id,
        tree_id: treeId,
        round: targetRound,
        position: pos,
        bracket: assignmentBracket,
        player1_id: playerId,
        player2_id: null,
        winner_id: null,
        player1_wins: 0,
        player2_wins: 0,
        player1_character_name: null,
        player2_character_name: null,
        player1_side: "-",
        player2_side: "-",
        status: "pending",
        forfeit_player_id: null,
        next_match_id: null,
        next_match_slot: null,
        loser_next_match_id: null,
        loser_next_match_slot: null,
      };
      await insertMatch(applyDefaultMatchSides(match, tournament.default_player_side));

      const all = [...currentMatches, match];

      const keyOf = (b: MatchBracket, r: number, p0: number) => `${b}:${r}:${p0}`;
      const byKey = new Map<string, Match>();
      for (const m of all) {
        if (m.tree_id !== treeId) continue;
        byKey.set(keyOf(m.bracket, m.round, m.position), m);
      }

      const getOrCreate = async (b: MatchBracket, r: number, p0: number): Promise<Match> => {
        const key = keyOf(b, r, p0);
        const existing = byKey.get(key);
        if (existing) return existing;
        const created: Match = {
          id: uuidv4(),
          tournament_id: tournament.id,
          tree_id: treeId,
          round: r,
          position: p0,
          bracket: b,
          player1_id: null,
          player2_id: null,
          winner_id: null,
          player1_wins: 0,
          player2_wins: 0,
          player1_character_name: null,
          player2_character_name: null,
          player1_side: "-",
          player2_side: "-",
          status: "pending",
          forfeit_player_id: null,
          next_match_id: null,
          next_match_slot: null,
          loser_next_match_id: null,
          loser_next_match_slot: null,
        };
        await insertMatch(applyDefaultMatchSides(created, tournament.default_player_side));
        byKey.set(key, created);
        all.push(created);
        return created;
      };

      const saveLinks = async (m: Match) => {
        await updateMatchProgressionLinks(
          m.id,
          m.next_match_id,
          m.next_match_slot,
          m.loser_next_match_id,
          m.loser_next_match_slot
        );
      };

      const sortedRound = (b: MatchBracket, r: number) =>
        all
          .filter((x) => x.tree_id === treeId && x.bracket === b && x.round === r)
          .sort((a, b2) => a.position - b2.position);

      const ensureLoserTargetForWinners = async (wm: Match): Promise<void> => {
        if (wm.bracket !== "winners" || tournament.type !== "double_elimination") return;

        if (wm.round === 1) {
          const lr = 1;
          const lp = Math.floor(wm.position / 2);
          const slot = (wm.position % 2 === 0 ? 1 : 2) as 1 | 2;
          const target = await getOrCreate("losers", lr, lp);
          wm.loser_next_match_id = target.id;
          wm.loser_next_match_slot = slot;
          await saveLinks(wm);
          return;
        }

        const lr = 2 * (wm.round - 1);
        const lp = wm.position;
        const target = await getOrCreate("losers", lr, lp);
        wm.loser_next_match_id = target.id;
        wm.loser_next_match_slot = 2;
        await saveLinks(wm);

        // Ensure feeder from previous losers odd round into slot 1.
        const prev = await getOrCreate("losers", lr - 1, lp);
        prev.next_match_id = target.id;
        prev.next_match_slot = 1;
        await saveLinks(prev);
      };

      const expandBracket = async (b: MatchBracket, startRound: number) => {
        let r = startRound;
        while (true) {
          const currentRound = sortedRound(b, r);
          if (currentRound.length === 0) break;

          let neededNext = 0;
          if (b === "winners") {
            neededNext = currentRound.length <= 1 ? 0 : Math.ceil(currentRound.length / 2);
          } else if (b === "losers") {
            if (r === 1) {
              neededNext = currentRound.length;
            } else if (r % 2 === 0) {
              neededNext = currentRound.length <= 1 ? 0 : Math.ceil(currentRound.length / 2);
            } else {
              neededNext = currentRound.length;
            }
          }

          if (neededNext <= 0) break;

          for (let i = 0; i < neededNext; i++) {
            await getOrCreate(b, r + 1, i);
          }

          for (const cm of currentRound) {
            const nextPos = b === "losers" && r % 2 === 1
              ? cm.position
              : Math.floor(cm.position / 2);
            const slot = b === "losers" && (r === 1 || (r % 2 === 1 && r !== 1))
              ? 1
              : ((cm.position % 2 === 0 ? 1 : 2) as 1 | 2);
            const nm = await getOrCreate(b, r + 1, nextPos);
            cm.next_match_id = nm.id;
            cm.next_match_slot = slot;
            await saveLinks(cm);

            if (b === "winners") {
              await ensureLoserTargetForWinners(cm);
            }
          }

          r += 1;
        }

        if (b === "winners" && tournament.type === "double_elimination") {
          const allW = all.filter((x) => x.tree_id === treeId && x.bracket === "winners");
          for (const wm of allW) {
            await ensureLoserTargetForWinners(wm);
          }
        }
      };

      await expandBracket(assignmentBracket, targetRound);
      if (assignmentBracket === "winners" && tournament.type === "double_elimination") {
        await expandBracket("losers", 1);
      }

      await syncPendingMatchSides(tournament);
      await fetchTournament();
    },
    [tournament, fetchTournament, isRoundLocked]
  );

  const swapMatchPlayers = useCallback(
    async (matchAId: string, slotA: 1 | 2, matchBId: string, slotB: 1 | 2) => {
      const matchA = matches.find((m) => m.id === matchAId);
      const matchB = matches.find((m) => m.id === matchBId);
      if (!matchA || !matchB) return;
      const incomingBySlot = buildIncomingBySlot(matches);
      if (getUiMatchState(matchA, incomingBySlot) !== "ready") return;
      if (getUiMatchState(matchB, incomingBySlot) !== "ready") return;
      const playerA = slotA === 1 ? matchA.player1_id : matchA.player2_id;
      const playerB = slotB === 1 ? matchB.player1_id : matchB.player2_id;
      await updateMatchPlayer(matchAId, slotA, playerB);
      await updateMatchPlayer(matchBId, slotB, playerA);
      setMatches((prev) =>
        prev.map((m) => {
          if (m.id === matchAId && m.id === matchBId) {
            const next = { ...m };
            if (slotA === 1) next.player1_id = playerB;
            else next.player2_id = playerB;
            if (slotB === 1) next.player1_id = playerA;
            else next.player2_id = playerA;
            return next;
          }
          if (m.id === matchAId)
            return slotA === 1 ? { ...m, player1_id: playerB } : { ...m, player2_id: playerB };
          if (m.id === matchBId)
            return slotB === 1 ? { ...m, player1_id: playerA } : { ...m, player2_id: playerA };
          return m;
        })
      );
    },
    [matches]
  );

  const findActiveMatch = useCallback(
    async (player_id: string) => {
      if (!tournament) return null;
      return getActiveMatchByPlayer(tournament.id, player_id);
    },
    [tournament]
  );

  const findMatchByTwoPlayers = useCallback(
    async (player1_id: string, player2_id: string) => {
      if (!tournament) return null;
      return getLatestMatchByTwoPlayers(tournament.id, player1_id, player2_id);
    },
    [tournament]
  );

  const pinnedTournament = pinnedTournamentId
    ? tournamentList.find((t) => t.id === pinnedTournamentId) ?? null
    : null;

  const isReadOnly = tournament?.status === "finalized";

  const updateNetworkMessageSettings = useCallback((patch: Partial<AppNetworkMessageSettings>) => {
    setNetworkMessageSettings((prev) => {
      const next: AppNetworkMessageSettings = {
        subnetMask:
          typeof patch.subnetMask === "string" && patch.subnetMask.trim().length > 0
            ? patch.subnetMask.trim()
            : prev.subnetMask,
        port: patch.port == null ? prev.port : sanitizePort(patch.port),
        saveUnmatchedMessages:
          typeof patch.saveUnmatchedMessages === "boolean"
            ? patch.saveUnmatchedMessages
            : prev.saveUnmatchedMessages,
        preventUnresolvedThreadDeletion:
          typeof patch.preventUnresolvedThreadDeletion === "boolean"
            ? patch.preventUnresolvedThreadDeletion
            : prev.preventUnresolvedThreadDeletion,
      };
      saveAppNetworkMessageSettings(next);
      return next;
    });
  }, []);

  const value: AppContextValue = {
    initialized,
    networkMessageSettings,
    updateNetworkMessageSettings,
    players,
    characters,
    characterLists,
    fetchCharacters,
    fetchCharacterLists,
    addCharacter,
    removeCharacter,
    addCharacterList,
    editCharacterList,
    removeCharacterList,
    fetchPlayers,
    addPlayer,
    editPlayer,
    dqPlayer,
    removePlayer,
    getPlayer,
    tournamentList,
    pinnedTournament,
    setPinnedTournament,
    isReadOnly,
    selectTournament,
    finalizeTournament,
    tournament,
    participants,
    admins,
    matches,
    matchActionLogs,
    trees,
    roundLocks,
    isRoundLocked,
    toggleRoundLock,
    fetchTournament,
    createNew,
    removeTournament,
    addParticipant,
    editParticipantName,
    addAdmin,
    editAdminName,
    removeAdmin,
    setParticipantCharacter,
    setParticipantSelectedCharacters,
    removeParticipant,
    swapSeeds,
    randomizeSeeds,
    generateBracket,
    clearBracket,
    setGrandFinalReset,
    setTournamentStatus,
    updateTournamentSettings,
    addBracketTree,
    renameBracketTreeItem,
    removeBracketTree,
    correctScore,
    addMidTournamentMatch,
    addParticipantAndAssign,
    swapMatchPlayers,
    startMatch,
    setMatchReady,
    setMatchCharacters,
    swapMatchSides,
    randomizeMatchSides,
    recordScore,
    findActiveMatch,
    findMatchByTwoPlayers,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}



