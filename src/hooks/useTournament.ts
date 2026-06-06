import { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  getTournament,
  createTournament,
  updateTournamentStatus,
  updateGrandFinalReset,
  deleteTournament,
  getTournamentPlayers,
  addTournamentPlayer,
  removeTournamentPlayer,
  updateTournamentPlayerSeed,
  getMatchesByTournament,
  deleteMatchesByTournament,
  insertMatch,
} from "../lib/database";
import {
  generateSingleElimination,
  generateDoubleElimination,
  shuffleArray,
} from "../lib/bracket";
import type { Tournament, TournamentPlayer, Match } from "../lib/types";

export function useTournament() {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<TournamentPlayer[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTournament = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await getTournament();
      setTournament(t);
      if (t) {
        const p = await getTournamentPlayers(t.id);
        setParticipants(p);
        const m = await getMatchesByTournament(t.id);
        setMatches(m);
      } else {
        setParticipants([]);
        setMatches([]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const createNew = useCallback(
    async (
      type: "single_elimination" | "double_elimination",
      max_participants: number,
      grand_final_reset: boolean
    ) => {
      const id = uuidv4();
      await createTournament(id, type, max_participants, grand_final_reset, "大会", "free_input", null, []);
      await fetchTournament();
    },
    [fetchTournament]
  );

  const removeTournament = useCallback(async () => {
    if (!tournament) return;
    await deleteTournament(tournament.id);
    setTournament(null);
    setParticipants([]);
    setMatches([]);
  }, [tournament]);

  const addParticipant = useCallback(
    async (name: string, character_name: string | null, attributes: Record<string, string>, player_id?: string) => {
      if (!tournament) return;
      const id = player_id ?? uuidv4();
      const nextSeed = participants.length + 1;
      await addTournamentPlayer(tournament.id, id, nextSeed, name, character_name, attributes);
      const p = await getTournamentPlayers(tournament.id);
      setParticipants(p);
    },
    [tournament, participants]
  );

  const removeParticipant = useCallback(
    async (player_id: string) => {
      if (!tournament) return;
      await removeTournamentPlayer(tournament.id, player_id);
      const p = await getTournamentPlayers(tournament.id);
      // Re-number seeds
      for (let i = 0; i < p.length; i++) {
        await updateTournamentPlayerSeed(tournament.id, p[i].player_id, i + 1);
        p[i].seed = i + 1;
      }
      setParticipants([...p]);
    },
    [tournament]
  );

  const swapSeeds = useCallback(
    async (player_id_a: string, player_id_b: string) => {
      if (!tournament) return;
      const a = participants.find((p) => p.player_id === player_id_a);
      const b = participants.find((p) => p.player_id === player_id_b);
      if (!a || !b) return;
      await updateTournamentPlayerSeed(tournament.id, player_id_a, b.seed);
      await updateTournamentPlayerSeed(tournament.id, player_id_b, a.seed);
      const p = await getTournamentPlayers(tournament.id);
      setParticipants(p);
    },
    [tournament, participants]
  );

  const randomizeSeeds = useCallback(async () => {
    if (!tournament) return;
    const shuffled = shuffleArray(participants.map((p) => p.player_id));
    for (let i = 0; i < shuffled.length; i++) {
      await updateTournamentPlayerSeed(tournament.id, shuffled[i], i + 1);
    }
    const p = await getTournamentPlayers(tournament.id);
    setParticipants(p);
  }, [tournament, participants]);

  const generateBracket = useCallback(async () => {
    if (!tournament) return;
    // Delete any existing matches
    await deleteMatchesByTournament(tournament.id);

    // Sorted by seed
    const sorted = [...participants].sort((a, b) => a.seed - b.seed);
    const playerIds: (string | null)[] = sorted.map((p) => p.player_id);

    let newMatches: Match[];
    if (tournament.type === "single_elimination") {
      newMatches = generateSingleElimination(tournament.id, playerIds, '');
    } else {
      newMatches = generateDoubleElimination(tournament.id, playerIds, '');
    }

    for (const m of newMatches) {
      await insertMatch(m);
    }

    await updateTournamentStatus(tournament.id, "in_progress");
    await fetchTournament();
  }, [tournament, participants, fetchTournament]);

  const setGrandFinalReset = useCallback(
    async (enabled: boolean) => {
      if (!tournament) return;
      await updateGrandFinalReset(tournament.id, enabled);
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  const setStatus = useCallback(
    async (status: "setup" | "in_progress" | "completed") => {
      if (!tournament) return;
      await updateTournamentStatus(tournament.id, status);
      await fetchTournament();
    },
    [tournament, fetchTournament]
  );

  return {
    tournament,
    participants,
    matches,
    loading,
    error,
    fetchTournament,
    createNew,
    removeTournament,
    addParticipant,
    removeParticipant,
    swapSeeds,
    randomizeSeeds,
    generateBracket,
    setGrandFinalReset,
    setStatus,
  };
}
