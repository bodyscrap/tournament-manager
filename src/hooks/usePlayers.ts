import { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  getAllPlayers,
  getPlayerById,
  createPlayer,
  updatePlayer,
  setPlayerDq,
  deletePlayer,
} from "../lib/database";
import type { Player } from "../lib/types";

export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlayers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAllPlayers();
      setPlayers(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

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

  const getPlayer = useCallback(async (id: string) => {
    return getPlayerById(id);
  }, []);

  return {
    players,
    loading,
    error,
    fetchPlayers,
    addPlayer,
    editPlayer,
    dqPlayer,
    removePlayer,
    getPlayer,
  };
}
