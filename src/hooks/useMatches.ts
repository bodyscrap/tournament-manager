import { useState, useCallback } from "react";
import {
  getMatchesByTournament,
  getActiveMatchByPlayer,
  getLatestMatchByTwoPlayers,
  updateMatchScore,
  updateMatchPlayer,
  updateMatchStatus,
  insertMatch,
} from "../lib/database";
import { createGrandFinalResetMatch } from "../lib/bracket";
import type { Match, Tournament } from "../lib/types";

export function useMatches() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMatches = useCallback(async (tournament_id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMatchesByTournament(tournament_id);
      setMatches(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  /** プレイヤーIDからアクティブな試合を検索 */
  const findActiveMatch = useCallback(
    async (tournament_id: string, player_id: string): Promise<Match | null> => {
      return getActiveMatchByPlayer(tournament_id, player_id);
    },
    []
  );

  /** 2プレイヤーIDから最新の対戦を検索 */
  const findMatchByTwoPlayers = useCallback(
    async (
      tournament_id: string,
      player1_id: string,
      player2_id: string
    ): Promise<Match | null> => {
      return getLatestMatchByTwoPlayers(tournament_id, player1_id, player2_id);
    },
    []
  );

  /** 試合を「試合中」に設定 */
  const startMatch = useCallback(async (match_id: string) => {
    await updateMatchStatus(match_id, "in_progress");
  }, []);

  /** スコアを更新（勝者判定・次試合への自動昇格含む） */
  const recordScore = useCallback(
    async (
      tournament: Tournament,
      match: Match,
      player1_wins: number,
      player2_wins: number,
      dq_player_id: string | null
    ) => {
      let winner_id: string | null = null;
      let loser_id: string | null = null;
      let status = match.status;

      // DQ処理
      if (dq_player_id) {
        winner_id =
          dq_player_id === match.player1_id ? match.player2_id : match.player1_id;
        loser_id = dq_player_id;
        status = "completed";
      } else {
        // 勝者を判定 (どちらかが勝利数を記録していれば完了扱い)
        // ユーザーが明示的に「完了」を押したとき winner_id を決定
        // ここでは勝利数が多い方を自動判定
        if (player1_wins > player2_wins && match.player1_id) {
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
        // 勝者を次の試合へ昇格
        if (match.next_match_id && match.next_match_slot) {
          await updateMatchPlayer(
            match.next_match_id,
            match.next_match_slot as 1 | 2,
            winner_id
          );
        }

        // ダブルエリミネーション: 敗者をルーザーズブラケットへ
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

        // グランドファイナルでルーザーズ側が勝った場合のリセット処理
        if (
          match.bracket === "grand_final" &&
          tournament.type === "double_elimination" &&
          tournament.grand_final_reset
        ) {
          // player2 (slot 2 = losers side) が勝った場合
          if (winner_id === match.player2_id && match.player1_id && match.player2_id) {
            const resetMatch = createGrandFinalResetMatch(
              tournament.id,
              match.tree_id ?? '',
              match,
              match.player2_id,
              match.player1_id
            );
            await insertMatch(resetMatch);
          }
        }
      }

      if (match.tournament_id) {
        await fetchMatches(match.tournament_id);
      }
    },
    [fetchMatches]
  );

  /** DQのみを適用（スコア変更なし） */
  const applyDq = useCallback(
    async (tournament: Tournament, match: Match, dq_player_id: string) => {
      await recordScore(
        tournament,
        match,
        match.player1_wins,
        match.player2_wins,
        dq_player_id
      );
    },
    [recordScore]
  );

  return {
    matches,
    loading,
    error,
    fetchMatches,
    findActiveMatch,
    findMatchByTwoPlayers,
    startMatch,
    recordScore,
    applyDq,
  };
}
