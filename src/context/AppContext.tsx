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
  removeTournamentPlayer,
  updateTournamentPlayerSeed,
  getMatchesByTournament,
  deleteMatchesByTournament,
  insertMatch,
  updateMatchScore,
  updateMatchPlayer,
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
} from "../lib/database";
import {
  generateSingleElimination,
  generateDoubleElimination,
  shuffleArray,
  createGrandFinalResetMatch,
} from "../lib/bracket";
import { buildIncomingBySlot, getUiMatchState } from "../lib/matchState";
import type {
  Player,
  Tournament,
  TournamentPlayer,
  BracketTree,
  Match,
  MatchBracket,
  TournamentType,
  TournamentStatus,
  RoundLock,
} from "../lib/types";

// -------------------------------------------------------
// Context value type
// -------------------------------------------------------
interface AppContextValue {
  initialized: boolean;

  // Players
  players: Player[];
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
  isReadOnly: boolean;
  selectTournament: (id: string | null) => Promise<void>;
  finalizeTournament: () => Promise<void>;

  // Active tournament
  tournament: Tournament | null;
  participants: TournamentPlayer[];
  matches: Match[];
  fetchTournament: () => Promise<void>;
  createNew: (
    type: TournamentType,
    max_participants: number,
    grand_final_reset: boolean,
    name: string
  ) => Promise<void>;
  removeTournament: () => Promise<void>;
  addParticipant: (
    name: string,
    character_name: string | null,
    attributes: Record<string, string>,
    player_id?: string
  ) => Promise<void>;
  removeParticipant: (player_id: string) => Promise<void>;
  swapSeeds: (player_id_a: string, player_id_b: string) => Promise<void>;
  randomizeSeeds: () => Promise<void>;
  generateBracket: () => Promise<void>;
  setGrandFinalReset: (enabled: boolean) => Promise<void>;
  setTournamentStatus: (status: TournamentStatus) => Promise<void>;
  updateTournamentSettings: (
    type: TournamentType,
    max_participants: number,
    grand_final_reset: boolean
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
    dq_player_id: string | null
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
    bracket: MatchBracket,
    treeId: string
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
  recordScore: (
    match: Match,
    player1_wins: number,
    player2_wins: number,
    dq_player_id: string | null
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

const AppContext = createContext<AppContextValue | null>(null);

// -------------------------------------------------------
// Provider
// -------------------------------------------------------
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [tournamentList, setTournamentList] = useState<Tournament[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<TournamentPlayer[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [trees, setTrees] = useState<BracketTree[]>([]);
  const [roundLocks, setRoundLocks] = useState<RoundLock[]>([]);

  // Ref to track active tournament id (avoids stale closure in callbacks)
  const activeTournamentIdRef = useRef<string | null>(null);
  // Guard against double-load in React StrictMode dev
  const loadedRef = useRef(false);

  // ---- loaders ----
  const fetchPlayers = useCallback(async () => {
    const data = await getAllPlayers();
    setPlayers(data);
  }, []);

  // Load a specific tournament's data by id
  const loadTournamentData = useCallback(async (id: string | null) => {
    if (!id) {
      setTournament(null);
      setParticipants([]);
      setMatches([]);
      setTrees([]);
      setRoundLocks([]);
      return;
    }
    const t = await getTournamentById(id);
    setTournament(t);
    if (t) {
      const [p, m, tr, rl] = await Promise.all([
        getTournamentPlayers(t.id),
        getMatchesByTournament(t.id),
        getBracketTrees(t.id),
        getRoundLocks(t.id),
      ]);
      setParticipants(p);
      setMatches(m);
      setTrees(tr);
      setRoundLocks(rl);
    } else {
      setTournament(null);
      setParticipants([]);
      setMatches([]);
      setTrees([]);
      setRoundLocks([]);
    }
  }, []);

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
      const [playerData, tList] = await Promise.all([
        getAllPlayers(),
        getAllTournaments(),
      ]);
      setPlayers(playerData);
      setTournamentList(tList);

      // Restore saved active tournament, or pick the most recent non-finalized
      let activeId: string | null = null;
      if (savedId && tList.some((t) => t.id === savedId)) {
        activeId = savedId;
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

  const finalizeTournament = useCallback(async () => {
    if (!tournament) return;
    await updateTournamentStatus(tournament.id, "finalized");
    await fetchTournament();
  }, [tournament, fetchTournament]);

  const createNew = useCallback(
    async (
      type: TournamentType,
      max_participants: number,
      grand_final_reset: boolean,
      name: string
    ) => {
      const id = uuidv4();
      await createTournament(id, type, max_participants, grand_final_reset, name);
      activeTournamentIdRef.current = id;
      localStorage.setItem("activeTournamentId", id);
      await fetchTournament();
    },
    [fetchTournament]
  );

  const removeTournament = useCallback(async () => {
    if (!tournament) return;
    const removedId = tournament.id;
    await deleteTournament(removedId);
    activeTournamentIdRef.current = null;
    localStorage.removeItem("activeTournamentId");
    setTournament(null);
    setParticipants([]);
    setMatches([]);
    setRoundLocks([]);
    const list = await getAllTournaments();
    setTournamentList(list);
  }, [tournament]);

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
      player_id?: string
    ) => {
      if (!tournament) return;
      const id = player_id ?? uuidv4();
      const p = await getTournamentPlayers(tournament.id);
      const nextSeed = p.length + 1;
      await addTournamentPlayer(tournament.id, id, nextSeed, name, character_name, attributes);
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
    if (!tournament) return;
    const shuffled = shuffleArray(participants.map((p) => p.player_id));
    for (let i = 0; i < shuffled.length; i++) {
      await updateTournamentPlayerSeed(tournament.id, shuffled[i], i + 1);
    }
    await fetchTournament();
  }, [tournament, participants, fetchTournament]);

  const generateBracket = useCallback(async () => {
    if (!tournament) return;
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
      await insertMatch(m);
    }
    await updateTournamentStatus(tournament.id, "in_progress");
    await fetchTournament();
  }, [tournament, fetchTournament]);

  const setGrandFinalReset = useCallback(
    async (enabled: boolean) => {
      if (!tournament) return;
      await updateTournamentSettingsDb(tournament.id, tournament.type, tournament.max_participants, enabled);
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const updateTournamentSettings = useCallback(
    async (type: TournamentType, max_participants: number, grand_final_reset: boolean) => {
      if (!tournament) return;
      await updateTournamentSettingsDb(tournament.id, type, max_participants, grand_final_reset);
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const setTournamentStatus = useCallback(
    async (status: TournamentStatus) => {
      if (!tournament) return;
      await updateTournamentStatus(tournament.id, status);
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  // ---- Match mutations ----
  const startMatch = useCallback(async (match_id: string) => {
    const target = matches.find((m) => m.id === match_id);
    if (!target || target.status !== "pending") return;

    const incomingBySlot = buildIncomingBySlot(matches);
    if (getUiMatchState(target, incomingBySlot) !== "ready") return;

    await updateMatchStatus(match_id, "in_progress");
    // Refresh matches list
    setMatches((prev) =>
      prev.map((m) =>
        m.id === match_id ? { ...m, status: "in_progress" } : m
      )
    );
  }, [matches]);

  const setMatchReady = useCallback(async (match_id: string) => {
    const target = matches.find((m) => m.id === match_id);
    if (!target || target.status !== "in_progress") return;

    await resetMatchToPending(match_id);
    setMatches((prev) =>
      prev.map((m) =>
        m.id === match_id
          ? {
              ...m,
              status: "pending",
              player1_wins: 0,
              player2_wins: 0,
              winner_id: null,
              dq_player_id: null,
            }
          : m
      )
    );
  }, [matches]);

  const recordScore = useCallback(
    async (
      match: Match,
      player1_wins: number,
      player2_wins: number,
      dq_player_id: string | null
    ) => {
      if (!tournament) return;

      let winner_id: string | null = null;
      let loser_id: string | null = null;
      let status = match.status;

      if (dq_player_id) {
        winner_id =
          dq_player_id === match.player1_id
            ? match.player2_id
            : match.player1_id;
        loser_id = dq_player_id;
        status = "completed";
      } else if (player1_wins > player2_wins && match.player1_id) {
        winner_id = match.player1_id;
        loser_id = match.player2_id;
        status = "completed";
      } else if (player2_wins > player1_wins && match.player2_id) {
        winner_id = match.player2_id;
        loser_id = match.player1_id;
        status = "completed";
      } else {
        status = "in_progress";
      }

      await updateMatchScore(
        match.id,
        player1_wins,
        player2_wins,
        status,
        winner_id,
        dq_player_id
      );

      if (status === "completed" && winner_id) {
        if (match.next_match_id && match.next_match_slot) {
          await updateMatchPlayer(
            match.next_match_id,
            match.next_match_slot as 1 | 2,
            winner_id
          );
        }
        if (
          tournament.type === "double_elimination" &&
          loser_id &&
          match.loser_next_match_id &&
          match.loser_next_match_slot
        ) {
          await updateMatchPlayer(
            match.loser_next_match_id,
            match.loser_next_match_slot as 1 | 2,
            loser_id
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
          await insertMatch(resetMatch);
        }

        // Check if tournament is complete (no more non-completed matches with both players)
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
    [tournament, fetchTournament]
  );

  // ---- Bracket tree mutations ----
  const addBracketTree = useCallback(
    async (name: string): Promise<string> => {
      if (!tournament) return "";
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
    [tournament, fetchTournament]
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
        status: "pending",
        dq_player_id: null,
        next_match_id: null,
        next_match_slot: null,
        loser_next_match_id: null,
        loser_next_match_slot: null,
      };
      await insertMatch(match);
      await fetchTournament();
    },
    [tournament, matches, fetchTournament]
  );

  const correctScore = useCallback(
    async (
      match: Match,
      player1_wins: number,
      player2_wins: number,
      dq_player_id: string | null
    ) => {
      if (!tournament) return;

      let newWinnerId: string | null = null;
      let newLoserId: string | null = null;
      if (dq_player_id) {
        newWinnerId = dq_player_id === match.player1_id ? match.player2_id : match.player1_id;
        newLoserId = dq_player_id;
      } else if (player1_wins > player2_wins && match.player1_id) {
        newWinnerId = match.player1_id;
        newLoserId = match.player2_id;
      } else if (player2_wins > player1_wins && match.player2_id) {
        newWinnerId = match.player2_id;
        newLoserId = match.player1_id;
      }

      const oldWinnerId = match.winner_id;
      const oldLoserId =
        oldWinnerId
          ? match.player1_id === oldWinnerId
            ? match.player2_id
            : match.player1_id
          : null;

      const newStatus = newWinnerId ? "completed" : "in_progress";

      if (newWinnerId !== oldWinnerId) {
        // Cascade-reset all downstream matches first
        await performCascadeReset(match, oldWinnerId, oldLoserId, matches);

        // Update this match with the corrected result
        await updateMatchScore(match.id, player1_wins, player2_wins, newStatus, newWinnerId, dq_player_id);

        // Place the new winner/loser in their downstream slots
        if (newWinnerId && match.next_match_id && match.next_match_slot) {
          await updateMatchPlayer(match.next_match_id, match.next_match_slot as 1 | 2, newWinnerId);
        }
        if (
          tournament.type === "double_elimination" &&
          newLoserId &&
          match.loser_next_match_id &&
          match.loser_next_match_slot
        ) {
          await updateMatchPlayer(
            match.loser_next_match_id,
            match.loser_next_match_slot as 1 | 2,
            newLoserId
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
          await insertMatch(resetMatch);
        }
      } else {
        // Winner unchanged — just update the scores
        await updateMatchScore(match.id, player1_wins, player2_wins, newStatus, newWinnerId, dq_player_id);
      }

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
    [tournament, matches, fetchTournament]
  );

  const addParticipantAndAssign = useCallback(
    async (name: string, bracket: MatchBracket, treeId: string) => {
      if (!tournament) return;
      if (tournament.type !== "double_elimination" && bracket === "losers") {
        throw new Error("シングルエリミネーションではルーザーズ参加はできません");
      }
      const p = await getTournamentPlayers(tournament.id);
      const joinFromLosersAsDummyLoss =
        tournament.type === "double_elimination" && bracket === "losers";
      const requiredSlots = joinFromLosersAsDummyLoss ? 2 : 1;

      if (p.length + requiredSlots > tournament.max_participants) {
        throw new Error("参加者上限に達しているため追加できません");
      }

      const playerId = uuidv4();
      const nextSeed = p.length + 1;
      await addTournamentPlayer(tournament.id, playerId, nextSeed, name, null, {});

      let dummyId: string | null = null;
      if (joinFromLosersAsDummyLoss) {
        dummyId = `dummy-${uuidv4()}`;
        await addTournamentPlayer(
          tournament.id,
          dummyId,
          nextSeed + 1,
          `${name} 用ダミー`,
          null,
          { role: "dummy" }
        );
      }

      const assignmentBracket: MatchBracket = joinFromLosersAsDummyLoss ? "winners" : bracket;

      const currentMatches = await getMatchesByTournament(tournament.id);
      const scoped = currentMatches.filter(
        (m) => m.bracket === assignmentBracket && m.tree_id === treeId
      );
      const incomingBySlot = buildIncomingBySlot(currentMatches);
      const unfinished = scoped.filter((m) => m.status !== "completed");
      const targetRound =
        unfinished.length > 0 ? Math.min(...unfinished.map((m) => m.round)) : 1;

      if (isRoundLocked(treeId, assignmentBracket, targetRound)) {
        throw new Error(`Round ${targetRound} は確定済みのため追加できません`);
      }

      // Reopen an auto-BYE completed match first (one real player, 0-0, no DQ).
      // This prevents creating an extra Round 1 BYE match when a late player joins.
      const autoByeCompleted = joinFromLosersAsDummyLoss
        ? undefined
        : scoped
        .filter((m) => {
          if (m.round !== targetRound) return false;
          const incoming = incomingBySlot.get(m.id) ?? { slot1: false, slot2: false };
          const isByeSlot1 = m.player1_id === null && !incoming.slot1;
          const isByeSlot2 = m.player2_id === null && !incoming.slot2;
          const oneSideOnly =
            (m.player1_id !== null && isByeSlot2) ||
            (isByeSlot1 && m.player2_id !== null);
          const lonePlayer = m.player1_id ?? m.player2_id;
          return (
            m.status === "completed" &&
            oneSideOnly &&
            m.winner_id !== null &&
            m.winner_id === lonePlayer &&
            m.player1_wins === 0 &&
            m.player2_wins === 0 &&
            m.dq_player_id === null
          );
        })
        .sort((a, b) => a.round - b.round || a.position - b.position)[0];

      if (autoByeCompleted) {
        const emptySlot = autoByeCompleted.player1_id === null ? 1 : 2;
        const autoAdvancedPlayerId =
          autoByeCompleted.player1_id ?? autoByeCompleted.player2_id;

        await updateMatchPlayer(autoByeCompleted.id, emptySlot, playerId);
        await updateMatchScore(autoByeCompleted.id, 0, 0, "pending", null, null);

        if (
          autoAdvancedPlayerId &&
          autoByeCompleted.next_match_id &&
          autoByeCompleted.next_match_slot
        ) {
          const downstream = currentMatches.find(
            (m) => m.id === autoByeCompleted.next_match_id
          );
          if (downstream) {
            const slotValue =
              autoByeCompleted.next_match_slot === 1
                ? downstream.player1_id
                : downstream.player2_id;
            if (slotValue === autoAdvancedPlayerId) {
              await updateMatchPlayer(
                autoByeCompleted.next_match_id,
                autoByeCompleted.next_match_slot as 1 | 2,
                null
              );
            }
          }
        }

        await fetchTournament();
        return;
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
      const byeMatch = joinFromLosersAsDummyLoss
        ? undefined
        : pending.find(
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
        await fetchTournament();
        return;
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
        player2_id: joinFromLosersAsDummyLoss ? dummyId : null,
        winner_id: null,
        player1_wins: 0,
        player2_wins: 0,
        status: "pending",
        dq_player_id: null,
        next_match_id: null,
        next_match_slot: null,
        loser_next_match_id: null,
        loser_next_match_slot: null,
      };
      await insertMatch(match);

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
          status: "pending",
          dq_player_id: null,
          next_match_id: null,
          next_match_slot: null,
          loser_next_match_id: null,
          loser_next_match_slot: null,
        };
        await insertMatch(created);
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
            const nextPos = b === "losers" && r % 2 === 1 && r !== 1
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

      if (joinFromLosersAsDummyLoss && dummyId) {
        await updateMatchScore(match.id, 0, 1, "completed", dummyId, null);
        if (match.next_match_id && match.next_match_slot) {
          await updateMatchPlayer(match.next_match_id, match.next_match_slot as 1 | 2, dummyId);
        }
        if (match.loser_next_match_id && match.loser_next_match_slot) {
          await updateMatchPlayer(match.loser_next_match_id, match.loser_next_match_slot as 1 | 2, playerId);
        }
      }

      await fetchTournament();
    },
    [tournament, fetchTournament, isRoundLocked]
  );

  const swapMatchPlayers = useCallback(
    async (matchAId: string, slotA: 1 | 2, matchBId: string, slotB: 1 | 2) => {
      const matchA = matches.find((m) => m.id === matchAId);
      const matchB = matches.find((m) => m.id === matchBId);
      if (!matchA || !matchB) return;
      const playerA = slotA === 1 ? matchA.player1_id : matchA.player2_id;
      const playerB = slotB === 1 ? matchB.player1_id : matchB.player2_id;
      await updateMatchPlayer(matchAId, slotA, playerB);
      await updateMatchPlayer(matchBId, slotB, playerA);
      setMatches((prev) =>
        prev.map((m) => {
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

  const isReadOnly = tournament?.status === "finalized";

  const value: AppContextValue = {
    initialized,
    players,
    fetchPlayers,
    addPlayer,
    editPlayer,
    dqPlayer,
    removePlayer,
    getPlayer,
    tournamentList,
    isReadOnly,
    selectTournament,
    finalizeTournament,
    tournament,
    participants,
    matches,
    trees,
    roundLocks,
    isRoundLocked,
    toggleRoundLock,
    fetchTournament,
    createNew,
    removeTournament,
    addParticipant,
    removeParticipant,
    swapSeeds,
    randomizeSeeds,
    generateBracket,
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
