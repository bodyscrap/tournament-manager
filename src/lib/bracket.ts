import { v4 as uuidv4 } from "uuid";
import type { Match, MatchBracket } from "./types";

// =====================================================
// Utility
// =====================================================

/** 2の累乗に切り上げ */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Fisher-Yates shuffle (in-place) */
export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeMatch(
  tournamentId: string,
  treeId: string,
  round: number,
  position: number,
  bracket: MatchBracket
): Match {
  return {
    id: uuidv4(),
    tournament_id: tournamentId,
    tree_id: treeId,
    round,
    position,
    bracket,
    player1_id: null,
    player2_id: null,
    winner_id: null,
    player1_wins: 0,
    player2_wins: 0,
    player1_character_name: null,
    player2_character_name: null,
    player1_side: "1P",
    player2_side: "2P",
    status: "pending",
    forfeit_player_id: null,
    next_match_id: null,
    next_match_slot: null,
    loser_next_match_id: null,
    loser_next_match_slot: null,
  };
}

// =====================================================
// Single Elimination
// =====================================================

/**
 * シングルエリミネーションのMatch配列を生成する。
 * playerIds は seed 順 (index 0 = seed 1) で渡す。
 * bye の場合はプレイヤーIDが null になる。
 */
export function generateSingleElimination(
  tournamentId: string,
  playerIds: (string | null)[],
  treeId: string
): Match[] {
  const size = nextPow2(playerIds.length);

  // padded list (bye = null)
  const seeded: (string | null)[] = [...playerIds];
  while (seeded.length < size) seeded.push(null);

  // Standard bracket pairing: seed 1 vs size, seed 2 vs size-1, ...
  const firstRoundOrder = bracketOrder(size);

  const rounds = Math.log2(size);
  const allMatches: Match[] = [];

  // Build all match stubs first, then wire next_match_id
  const matchGrid: Match[][] = [];

  // Round 1
  const r1Matches: Match[] = [];
  for (let i = 0; i < size / 2; i++) {
    const m = makeMatch(tournamentId, treeId, 1, i, "winners");
    const p1idx = firstRoundOrder[i * 2];
    const p2idx = firstRoundOrder[i * 2 + 1];
    m.player1_id = seeded[p1idx] ?? null;
    m.player2_id = seeded[p2idx] ?? null;
    r1Matches.push(m);
  }
  matchGrid.push(r1Matches);

  // Subsequent rounds
  for (let r = 2; r <= rounds; r++) {
    const prev = matchGrid[r - 2];
    const count = prev.length / 2;
    const rMatches: Match[] = [];
    for (let i = 0; i < count; i++) {
      const m = makeMatch(tournamentId, treeId, r, i, "winners");
      // wire previous round
      prev[i * 2].next_match_id = m.id;
      prev[i * 2].next_match_slot = 1;
      prev[i * 2 + 1].next_match_id = m.id;
      prev[i * 2 + 1].next_match_slot = 2;
      rMatches.push(m);
    }
    matchGrid.push(rMatches);
  }

  for (const round of matchGrid) {
    for (const m of round) {
      allMatches.push(m);
    }
  }

  return allMatches;
}

// =====================================================
// Double Elimination
// =====================================================

/**
 * ダブルエリミネーションのMatch配列を生成する。
 * ウィナーズブラケット + ルーザーズブラケット + グランドファイナル(+ オプションリセット)
 */
export function generateDoubleElimination(
  tournamentId: string,
  playerIds: (string | null)[],
  treeId: string
): Match[] {
  const size = nextPow2(playerIds.length);
  const seeded: (string | null)[] = [...playerIds];
  while (seeded.length < size) seeded.push(null);

  const wRounds = Math.log2(size); // e.g. 8 players → 3 rounds
  const firstRoundOrder = bracketOrder(size);

  // ---- Winners bracket ----
  const wMatchGrid: Match[][] = [];

  const wR1: Match[] = [];
  for (let i = 0; i < size / 2; i++) {
    const m = makeMatch(tournamentId, treeId, 1, i, "winners");
    m.player1_id = seeded[firstRoundOrder[i * 2]] ?? null;
    m.player2_id = seeded[firstRoundOrder[i * 2 + 1]] ?? null;
    wR1.push(m);
  }
  wMatchGrid.push(wR1);

  for (let r = 2; r <= wRounds; r++) {
    const prev = wMatchGrid[r - 2];
    const count = prev.length / 2;
    const rMatches: Match[] = [];
    for (let i = 0; i < count; i++) {
      const m = makeMatch(tournamentId, treeId, r, i, "winners");
      prev[i * 2].next_match_id = m.id;
      prev[i * 2].next_match_slot = 1;
      prev[i * 2 + 1].next_match_id = m.id;
      prev[i * 2 + 1].next_match_slot = 2;
      rMatches.push(m);
    }
    wMatchGrid.push(rMatches);
  }

  // ---- Losers bracket ----
  // Losers bracket has 2*(wRounds-1) rounds
  // LR1: losers from W-R1 (size/2 players → size/4 matches)
  // LR2: winners of LR1 vs losers from W-R2
  // LR3: winners of LR2 vs each other
  // ...
  // For n players (power of 2), losers bracket structure:
  //   LR odd rounds: fed by winners bracket losers
  //   LR even rounds: only internal matches
  // Standard pattern:
  //   LR_1: W-R1 losers play each other (size/4 matches)
  //   LR_2: LR_1 winners vs W-R2 losers (size/4 matches)
  //   LR_3: LR_2 winners play each other (size/8 matches)
  //   LR_4: LR_3 winners vs W-R3 losers
  //   ...
  //   Final LR match: 1 match → winner goes to Grand Final

  const lMatchGrid: Match[][] = [];
  const wRoundsCount = wRounds; // e.g. 3

  // W-R1 losers → LR1
  const wR1LoserCount = wR1.length; // size/2
  const lr1Count = wR1LoserCount / 2; // size/4
  const lr1: Match[] = [];
  for (let i = 0; i < lr1Count; i++) {
    lr1.push(makeMatch(tournamentId, treeId, 1, i, "losers"));
  }
  // Wire W-R1 losers into LR1
  for (let i = 0; i < wR1.length; i++) {
    const lrMatchIdx = Math.floor(i / 2);
    const slot = (i % 2) + 1 as 1 | 2;
    wR1[i].loser_next_match_id = lr1[lrMatchIdx].id;
    wR1[i].loser_next_match_slot = slot;
  }
  lMatchGrid.push(lr1);

  // For each subsequent winners round (W-R2 onward), generate two LR rounds
  let lRound = 2;
  for (let wr = 2; wr <= wRoundsCount - 1; wr++) {
    const prevLR = lMatchGrid[lMatchGrid.length - 1];
    const wCurrent = wMatchGrid[wr - 1]; // W-Rwr losers

    // Feed LR (even): prevLR winners vs W-Rwr losers
    const feedCount = prevLR.length; // same count
    const lrFeed: Match[] = [];
    for (let i = 0; i < feedCount; i++) {
      const m = makeMatch(tournamentId, treeId, lRound, i, "losers");
      prevLR[i].next_match_id = m.id;
      prevLR[i].next_match_slot = 1;
      // W-Rwr losers → slot 2
      if (wCurrent[i]) {
        wCurrent[i].loser_next_match_id = m.id;
        wCurrent[i].loser_next_match_slot = 2;
      }
      lrFeed.push(m);
    }
    lMatchGrid.push(lrFeed);
    lRound++;

    // Consolidation LR (odd): lrFeed winners play each other
    const consolidCount = Math.max(1, lrFeed.length / 2);
    if (consolidCount < lrFeed.length) {
      const lrConsol: Match[] = [];
      for (let i = 0; i < consolidCount; i++) {
        const m = makeMatch(tournamentId, treeId, lRound, i, "losers");
        lrFeed[i * 2].next_match_id = m.id;
        lrFeed[i * 2].next_match_slot = 1;
        lrFeed[i * 2 + 1].next_match_id = m.id;
        lrFeed[i * 2 + 1].next_match_slot = 2;
        lrConsol.push(m);
      }
      lMatchGrid.push(lrConsol);
      lRound++;
    } else {
      // Only one match in feed, it continues directly
    }
  }

  // Last W round loser → final LR feed
  if (wRoundsCount >= 2) {
    const prevLR = lMatchGrid[lMatchGrid.length - 1];
    const wFinal = wMatchGrid[wRoundsCount - 1]; // Winners final loser

    if (prevLR.length > 0) {
      // final LR feed: prevLR winner vs W-final loser
      const finalLRFeed = makeMatch(tournamentId, treeId, lRound, 0, "losers");
      if (prevLR.length === 1) {
        prevLR[0].next_match_id = finalLRFeed.id;
        prevLR[0].next_match_slot = 1;
      } else {
        // consolidation needed
        const consol = makeMatch(tournamentId, treeId, lRound, 0, "losers");
        for (let i = 0; i < prevLR.length; i++) {
          prevLR[i].next_match_id = consol.id;
          prevLR[i].next_match_slot = (i % 2 + 1) as 1 | 2;
        }
        lMatchGrid.push([consol]);
        lRound++;

        const finalFeed = makeMatch(tournamentId, treeId, lRound, 0, "losers");
        consol.next_match_id = finalFeed.id;
        consol.next_match_slot = 1;
        if (wFinal[0]) {
          wFinal[0].loser_next_match_id = finalFeed.id;
          wFinal[0].loser_next_match_slot = 2;
        }
        lMatchGrid.push([finalFeed]);
        lRound++;

        // Grand Final
        const grandFinal = makeMatch(tournamentId, treeId, 1, 0, "grand_final");
        const wFinalsMatch = wMatchGrid[wRoundsCount - 1][0];
        wFinalsMatch.next_match_id = grandFinal.id;
        wFinalsMatch.next_match_slot = 1;
        finalFeed.next_match_id = grandFinal.id;
        finalFeed.next_match_slot = 2;

        const allMatches: Match[] = [
          ...wMatchGrid.flat(),
          ...lMatchGrid.flat(),
          grandFinal,
        ];
        return allMatches;
      }

      if (wFinal[0]) {
        wFinal[0].loser_next_match_id = finalLRFeed.id;
        wFinal[0].loser_next_match_slot = 2;
      }
      lMatchGrid.push([finalLRFeed]);
      lRound++;
    }
  }

  // Grand Final
  const grandFinal = makeMatch(tournamentId, treeId, 1, 0, "grand_final");
  const wFinalsMatch = wMatchGrid[wRoundsCount - 1][0];
  wFinalsMatch.next_match_id = grandFinal.id;
  wFinalsMatch.next_match_slot = 1;

  const lastLR = lMatchGrid[lMatchGrid.length - 1];
  if (lastLR && lastLR.length > 0) {
    lastLR[0].next_match_id = grandFinal.id;
    lastLR[0].next_match_slot = 2;
  }

  const allMatches: Match[] = [
    ...wMatchGrid.flat(),
    ...lMatchGrid.flat(),
    grandFinal,
  ];
  return allMatches;
}

// =====================================================
// Bracket seed ordering
// Standard seeding: 1 vs 2^n, 2 vs 2^n-1, ...
// Returns array of 0-based indices for the bracket
// =====================================================
function bracketOrder(size: number): number[] {
  if (size === 2) return [0, 1];
  const half = bracketOrder(size / 2);
  const result: number[] = [];
  for (const h of half) {
    result.push(h);
    result.push(size - 1 - h);
  }
  return result;
}

// =====================================================
// Grand Final Reset match factory
// =====================================================
export function createGrandFinalResetMatch(
  tournamentId: string,
  treeId: string,
  _grandFinalMatch: Match,
  losersWinnerId: string,
  winnersWinnerId: string
): Match {
  const reset = makeMatch(tournamentId, treeId, 2, 0, "grand_final_reset");
  // loser bracket winner (who just won GF) is player1, winners side is player2
  reset.player1_id = losersWinnerId;
  reset.player2_id = winnersWinnerId;
  return reset;
}



