// =====================
// Player
// =====================
export interface Player {
  id: string;
  name: string;
  character_name: string | null;
  attributes: Record<string, string>; // parsed from JSON
  dq: boolean;
  created_at: string;
}

export interface PlayerRow {
  id: string;
  name: string;
  character_name: string | null;
  attributes: string; // raw JSON string
  dq: number;
  created_at: string;
}

// =====================
// Character Master
// =====================
export interface CharacterMaster {
  id: string;
  name: string;
  created_at: string;
}

export interface CharacterMasterRow {
  id: string;
  name: string;
  created_at: string;
}

export interface CharacterList {
  id: string;
  name: string;
  characters: string[];
  created_at: string;
}

export interface CharacterListRow {
  id: string;
  name: string;
  characters_json: string;
  created_at: string;
}

export interface TournamentCharacterCategory {
  category_id: string;
  category_name: string;
  list_name: string | null;
  list: string[];
  min_select: number;
  max_select: number;
  forbid_duplicate_item?: boolean;
}

export interface TournamentCharacterSelectionConfig {
  categories: TournamentCharacterCategory[];
  total_min_select: number;
  total_max_select: number;
}

// =====================
// Tournament
// =====================
export type TournamentType = "single_elimination" | "double_elimination";
export type TournamentStatus = "setup" | "in_progress" | "completed" | "finalized";
export type CharacterInputMode = "free_input" | "list_selection";
export type TournamentDefaultPlayerSide = "upper_1p" | "upper_2p" | "random";

export interface Tournament {
  id: string;
  name: string;
  event_code: string;
  tournament_code: string;
  type: TournamentType;
  max_participants: number;
  status: TournamentStatus;
  grand_final_reset: boolean;
  character_input_mode: CharacterInputMode;
  character_list_name: string | null;
  character_list: string[];
  character_selection_config: TournamentCharacterSelectionConfig | null;
  default_player_side: TournamentDefaultPlayerSide;
  created_at: string;
}

export interface TournamentRow {
  id: string;
  name: string;
  event_code: string;
  tournament_code: string;
  type: TournamentType;
  max_participants: number;
  status: TournamentStatus;
  grand_final_reset: number;
  character_input_mode: CharacterInputMode;
  character_list_name: string | null;
  character_list_json: string | null;
  character_selection_config_json: string | null;
  default_player_side: TournamentDefaultPlayerSide;
  created_at: string;
}

// =====================
// TournamentPlayer
// =====================
export interface TournamentPlayer {
  tournament_id: string;
  player_id: string;
  player_code: string;
  player_sequence: number;
  player_id_4: string;
  seed: number; // bracket position (1-indexed)
  name: string;
  character_name: string | null;
  selected_characters: Record<string, string[]>; // category_id => selected character names
  attributes: Record<string, string>;
  dq: boolean;
}

export interface TournamentPlayerRow {
  tournament_id: string;
  player_id: string;
  player_code: string;
  player_sequence: number;
  player_id_4: string;
  seed: number;
  name: string;
  character_name: string | null;
  selected_characters_json: string | null; // raw JSON: category_id => string[]
  attributes: string; // raw JSON
  dq: number;
}

// =====================
// Tournament Admin
// =====================
export interface TournamentAdmin {
  tournament_id: string;
  admin_id: string;
  admin_code: string;
  admin_sequence: number;
  admin_id_4: string;
  name: string;
  attributes: Record<string, string>;
  created_at: string;
}

export interface TournamentAdminRow {
  tournament_id: string;
  admin_id: string;
  admin_code: string;
  admin_sequence: number;
  admin_id_4: string;
  name: string;
  attributes: string;
  created_at: string;
}

export type MatchActionType = "dq" | "forced_loss";
export type MatchActionConfirmerType = "participant" | "admin";

export interface MatchActionLog {
  id: string;
  tournament_id: string;
  match_id: string;
  action_type: MatchActionType;
  target_player_id: string | null;
  confirmed_by_type: MatchActionConfirmerType;
  confirmed_by_id: string;
  confirmed_by_name: string;
  confirmed_by_code: string;
  created_at: string;
}

export interface MatchActionLogRow {
  id: string;
  tournament_id: string;
  match_id: string;
  action_type: MatchActionType;
  target_player_id: string | null;
  confirmed_by_type: MatchActionConfirmerType;
  confirmed_by_id: string;
  confirmed_by_name: string;
  confirmed_by_code: string;
  created_at: string;
}

// =====================
// BracketTree
// =====================
export interface BracketTree {
  id: string;
  tournament_id: string;
  name: string;
  created_at: string;
}

export interface BracketTreeRow {
  id: string;
  tournament_id: string;
  name: string;
  created_at: string;
}

// =====================
// Round lock
// =====================
export interface RoundLock {
  tournament_id: string;
  tree_id: string;
  bracket: MatchBracket;
  round: number;
}

export interface RoundLockRow {
  tournament_id: string;
  tree_id: string;
  bracket: MatchBracket;
  round: number;
  locked: number;
}

// =====================
// Match
// =====================
export type MatchBracket = "winners" | "losers" | "grand_final" | "grand_final_reset";
export type MatchStatus = "pending" | "in_progress" | "completed";
export type MatchPlayerSide = "1P" | "2P" | "-";

export interface Match {
  id: string;
  tournament_id: string;
  tree_id: string;
  round: number;
  position: number; // within round (0-indexed)
  bracket: MatchBracket;
  player1_id: string | null; // null = bye
  player2_id: string | null; // null = bye
  winner_id: string | null;
  player1_wins: number;
  player2_wins: number;
  player1_character_name: string | null;
  player2_character_name: string | null;
  player1_side: MatchPlayerSide;
  player2_side: MatchPlayerSide;
  status: MatchStatus;
  result_finalized_at?: string | null;
  dq_player_id: string | null;
  next_match_id: string | null;       // winner advances here
  next_match_slot: number | null;     // 1 or 2 — which slot (player1 or player2) in next_match
  loser_next_match_id: string | null; // double elim: loser goes here
  loser_next_match_slot: number | null;
}

export interface MatchRow {
  id: string;
  tournament_id: string;
  tree_id: string;
  round: number;
  position: number;
  bracket: MatchBracket;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  player1_wins: number;
  player2_wins: number;
  player1_character_name: string | null;
  player2_character_name: string | null;
  player1_side: MatchPlayerSide;
  player2_side: MatchPlayerSide;
  status: MatchStatus;
  result_finalized_at: string | null;
  dq_player_id: string | null;
  next_match_id: string | null;
  next_match_slot: number | null;
  loser_next_match_id: string | null;
  loser_next_match_slot: number | null;
}

// =====================
// UI helpers
// =====================
export interface PlayerWithSeed extends Player {
  seed: number;
}
