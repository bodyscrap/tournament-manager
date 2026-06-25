import type { Match } from "./types";

export type UiMatchState = "undecided" | "ready" | "in_progress" | "completed";

export interface IncomingBySlot {
  slot1: boolean;
  slot2: boolean;
}

export function buildIncomingBySlot(matches: Match[]): Map<string, IncomingBySlot> {
  const incomingBySlot = new Map<string, IncomingBySlot>();
  for (const m of matches) {
    // completed かつ winner_id がない場合、勝者側スロットへは今後も流入しない。
    const canFeedWinner = m.status !== "completed" || m.winner_id !== null;
    if (canFeedWinner && m.next_match_id && m.next_match_slot) {
      const incoming = incomingBySlot.get(m.next_match_id) ?? { slot1: false, slot2: false };
      if (m.next_match_slot === 1) incoming.slot1 = true;
      if (m.next_match_slot === 2) incoming.slot2 = true;
      incomingBySlot.set(m.next_match_id, incoming);
    }

    // 敗者側は以下の場合に流入しうる。
    // - 未完了: まだ敗者が確定していない
    // - completed + winner_id あり: 敗者を一意に算出可能
    // - completed + forfeit_player_id あり: DQ側が敗者
    const hasSingleAssignedParticipant =
      (m.player1_id !== null && m.player2_id === null) ||
      (m.player1_id === null && m.player2_id !== null);
    const canFeedLoserFromWinner =
      m.winner_id !== null &&
      ((m.winner_id === m.player1_id && m.player2_id !== null) ||
        (m.winner_id === m.player2_id && m.player1_id !== null));
    const canFeedLoser =
      // 未完了なら今後敗者が確定する可能性がある
      m.status !== "completed" ||
      // DQは forfeit_player_id 側が敗者として流せる
      m.forfeit_player_id !== null ||
      // 勝者がいて、かつ反対側プレイヤーが実在する場合のみ敗者を流せる
      canFeedLoserFromWinner ||
      // BYE・DQなどで winner_id が null でも敗者は一意に決まるケース
      (m.status === "completed" && m.winner_id === null && hasSingleAssignedParticipant);
    if (canFeedLoser && m.loser_next_match_id && m.loser_next_match_slot) {
      const incoming = incomingBySlot.get(m.loser_next_match_id) ?? { slot1: false, slot2: false };
      if (m.loser_next_match_slot === 1) incoming.slot1 = true;
      if (m.loser_next_match_slot === 2) incoming.slot2 = true;
      incomingBySlot.set(m.loser_next_match_id, incoming);
    }
  }
  return incomingBySlot;
}

export function getUiMatchState(
  match: Match,
  incomingBySlot: Map<string, IncomingBySlot>
): UiMatchState {
  if (match.status === "in_progress") return "in_progress";
  if (match.status === "completed") return "completed";

  const incoming = incomingBySlot.get(match.id) ?? { slot1: false, slot2: false };
  const slot1Undecided = match.player1_id === null && incoming.slot1;
  const slot2Undecided = match.player2_id === null && incoming.slot2;

  return slot1Undecided || slot2Undecided ? "undecided" : "ready";
}

export function getUiMatchStateLabel(state: UiMatchState): string {
  if (state === "undecided") return "未決定";
  if (state === "ready") return "準備完了";
  if (state === "in_progress") return "試合中";
  return "結果確定";
}



