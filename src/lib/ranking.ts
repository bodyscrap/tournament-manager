import type { Match, TournamentPlayer } from "./types";

interface PlayerRanking {
  player_id: string;
  name: string;
  seed: number;
  placement: number;
  level_score: number;
  total_round_diff: number;
  total_round_wins: number;
  total_round_losses: number;
  match_wins: number;
  match_losses: number;
}

interface MutablePlayerRanking {
  player_id: string;
  name: string;
  seed: number;
  placement: number;
  level_score: number;
  total_round_diff: number;
  total_round_wins: number;
  total_round_losses: number;
  match_wins: number;
  match_losses: number;
}

function buildMatchStageMap(matches: Match[]): Map<string, number> {
  const stageByMatchId = new Map<string, number>();
  const matchIdSet = new Set(matches.map((m) => m.id));

  for (const m of matches) {
    stageByMatchId.set(m.id, 1);
  }

  // Propagate stage depth through winner/loser links in the bracket DAG.
  for (let i = 0; i < matches.length * 2; i++) {
    let changed = false;

    for (const m of matches) {
      const srcStage = stageByMatchId.get(m.id) ?? 1;
      const destinations = [m.next_match_id, m.loser_next_match_id];

      for (const destId of destinations) {
        if (!destId || !matchIdSet.has(destId)) continue;
        const nextStage = srcStage + 1;
        const current = stageByMatchId.get(destId) ?? 1;
        if (nextStage > current) {
          stageByMatchId.set(destId, nextStage);
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  // Grand final reset can be added as a standalone match, so force it above GF.
  for (const reset of matches.filter((m) => m.bracket === "grand_final_reset")) {
    const gf = matches.find(
      (m) => m.tree_id === reset.tree_id && m.bracket === "grand_final"
    );
    if (!gf) continue;
    const gfStage = stageByMatchId.get(gf.id) ?? 1;
    const resetStage = stageByMatchId.get(reset.id) ?? 1;
    if (resetStage <= gfStage) {
      stageByMatchId.set(reset.id, gfStage + 1);
    }
  }

  return stageByMatchId;
}

function isSamePlacementLevel(a: PlayerRanking, b: PlayerRanking): boolean {
  return a.level_score === b.level_score && a.total_round_diff === b.total_round_diff;
}

export function computePlayerRankings(
  participants: TournamentPlayer[],
  matches: Match[]
): PlayerRanking[] {
  const rankingMap = new Map<string, MutablePlayerRanking>();
  const stageByMatchId = buildMatchStageMap(matches);

  for (const p of participants) {
    rankingMap.set(p.player_id, {
      player_id: p.player_id,
      name: p.name,
      seed: p.seed,
      placement: 0,
      level_score: 0,
      total_round_diff: 0,
      total_round_wins: 0,
      total_round_losses: 0,
      match_wins: 0,
      match_losses: 0,
    });
  }

  for (const m of matches) {
    if (m.status !== "completed") continue;

    const stage = stageByMatchId.get(m.id) ?? 1;
    const p1 = m.player1_id ? rankingMap.get(m.player1_id) : undefined;
    const p2 = m.player2_id ? rankingMap.get(m.player2_id) : undefined;

    if (p1) {
      const p1Level = stage * 2 + (m.winner_id === m.player1_id ? 1 : 0);
      p1.level_score = Math.max(p1.level_score, p1Level);
      if (m.winner_id === m.player1_id) p1.match_wins += 1;
      if (m.winner_id && m.winner_id !== m.player1_id) p1.match_losses += 1;
    }

    if (p2) {
      const p2Level = stage * 2 + (m.winner_id === m.player2_id ? 1 : 0);
      p2.level_score = Math.max(p2.level_score, p2Level);
      if (m.winner_id === m.player2_id) p2.match_wins += 1;
      if (m.winner_id && m.winner_id !== m.player2_id) p2.match_losses += 1;
    }

    // Round differential tie-break uses only real head-to-head matches.
    if (p1 && p2) {
      const p1Diff = m.player1_wins - m.player2_wins;
      const p2Diff = m.player2_wins - m.player1_wins;

      p1.total_round_wins += m.player1_wins;
      p1.total_round_losses += m.player2_wins;
      p1.total_round_diff += p1Diff;

      p2.total_round_wins += m.player2_wins;
      p2.total_round_losses += m.player1_wins;
      p2.total_round_diff += p2Diff;
    }
  }

  const sorted = [...rankingMap.values()].sort((a, b) => {
    if (b.level_score !== a.level_score) return b.level_score - a.level_score;
    if (b.total_round_diff !== a.total_round_diff) {
      return b.total_round_diff - a.total_round_diff;
    }
    if (b.total_round_wins !== a.total_round_wins) {
      return b.total_round_wins - a.total_round_wins;
    }
    if (b.match_wins !== a.match_wins) {
      return b.match_wins - a.match_wins;
    }
    if (a.seed !== b.seed) return a.seed - b.seed;
    return a.name.localeCompare(b.name, "ja");
  });

  let placement = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && !isSamePlacementLevel(sorted[i], sorted[i - 1])) {
      placement = i + 1;
    }
    sorted[i].placement = placement;
  }

  return sorted;
}



