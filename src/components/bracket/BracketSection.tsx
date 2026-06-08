import React from "react";
import type { Match, TournamentPlayer, MatchBracket } from "../../lib/types";
import { buildIncomingBySlot, getUiMatchState, getUiMatchStateLabel } from "../../lib/matchState";

export interface DragState {
  matchId: string;
  slot: 1 | 2;
  playerId: string | null;
}

interface Props {
  matches: Match[];
  allMatches: Match[];
  playerMap: Map<string, TournamentPlayer>;
  bracket: MatchBracket;
  title: string;
  lockedRounds?: Set<number>;
  onRoundClick?: (round: number) => void;
  onMatchClick?: (match: Match) => void;
  canEdit?: boolean;
  draggingFrom?: DragState | null;
  onPlayerDragStart?: (state: DragState | null) => void;
  onPlayerDrop?: (matchId: string, slot: 1 | 2, source?: DragState) => void;
  onDragEnd?: () => void;
}

function getPlayerLabel(
  playerId: string | null,
  playerMap: Map<string, TournamentPlayer>,
  hasIncomingFeeder: boolean
): string {
  if (playerId === null) return hasIncomingFeeder ? "TBD" : "BYE";
  const p = playerMap.get(playerId);
  return p ? p.name : playerId.slice(0, 8) + "…";
}

function isRealPlayerId(playerId: string | null): playerId is string {
  return !!playerId && !playerId.startsWith("dummy-");
}

function MatchCard({
  match,
  playerMap,
  incomingBySlot,
  onClick,
  canEdit,
  draggingFrom,
  onPlayerDragStart,
  onPlayerDrop,
  onDragEnd,
}: {
  match: Match;
  playerMap: Map<string, TournamentPlayer>;
  incomingBySlot: Map<string, { slot1: boolean; slot2: boolean }>;
  onClick?: () => void;
  canEdit?: boolean;
  draggingFrom?: DragState | null;
  onPlayerDragStart?: (state: DragState | null) => void;
  onPlayerDrop?: (matchId: string, slot: 1 | 2, source?: DragState) => void;
  onDragEnd?: () => void;
}) {
  const incoming = incomingBySlot.get(match.id) ?? { slot1: false, slot2: false };
  const suppressNextCardClickRef = React.useRef(false);
  const p1 = getPlayerLabel(match.player1_id, playerMap, incoming.slot1);
  const p2 = getPlayerLabel(match.player2_id, playerMap, incoming.slot2);

  const p1Win = match.winner_id === match.player1_id && match.winner_id !== null;
  const p2Win = match.winner_id === match.player2_id && match.winner_id !== null;
  const uiState = getUiMatchState(match, incomingBySlot);
  const sidePending = uiState === "undecided";
  const p1SideLabel = sidePending ? "-" : match.player1_side;
  const p2SideLabel = sidePending ? "-" : match.player2_side;

  const isReadyCard = uiState === "ready";
  const isDraggable = !!canEdit && isReadyCard;
  const isSource = draggingFrom?.matchId === match.id;

  const makeDragProps = (slot: 1 | 2, playerId: string | null) => {
    const isSourceSlot = isSource && draggingFrom?.slot === slot;
    const canDragSlot = !!isDraggable && isRealPlayerId(playerId);
    const isTarget =
      !!canEdit &&
      isReadyCard &&
      isRealPlayerId(playerId) &&
      !(draggingFrom?.matchId === match.id && draggingFrom?.slot === slot);
    return {
      onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        suppressNextCardClickRef.current = true;
        if (!canDragSlot) {
          onPlayerDragStart?.(null);
          return;
        }
        onPlayerDragStart?.({ matchId: match.id, slot, playerId });
      },
      onMouseUp: (e: React.MouseEvent<HTMLDivElement>) => {
        if (!draggingFrom) return;
        e.stopPropagation();
        suppressNextCardClickRef.current = true;
        if (isTarget) {
          onPlayerDrop?.(match.id, slot);
          return;
        }
        onDragEnd?.();
      },
      onClick: (e: React.MouseEvent<HTMLDivElement>) => {
        // Ctrl操作時のみカードクリックを抑制し、通常クリックはカード詳細を開く
        if (!draggingFrom) return;
        e.preventDefault();
        e.stopPropagation();
      },
      onMouseLeave: () => {
        // 選択中でないなら終了扱いにして次操作へ備える
        if (!draggingFrom) onDragEnd?.();
      },
      onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
        // ネイティブDnDは環境差が大きいため無効化
        e.preventDefault();
      },
      onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
      },
      onDrop: (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
      },
      className: `flex items-center justify-between gap-1 px-2 py-1.5 text-xs`,
      style: isSourceSlot ? { opacity: 0.4 } : undefined,
      role: "button" as const,
      tabIndex: 0,
      title: isDraggable ? "Ctrl+ドラッグでシードを入れ替え" : undefined,
      onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!e.ctrlKey) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!canDragSlot) {
            onPlayerDragStart?.(null);
            return;
          }
          onPlayerDragStart?.({ matchId: match.id, slot, playerId });
        }
      },
      onKeyUp: (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!e.ctrlKey || !draggingFrom) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (isTarget) {
            onPlayerDrop?.(match.id, slot);
            return;
          }
          onDragEnd?.();
        }
      },
    };
  };

  const statusColor =
    uiState === "in_progress"
      ? "border-yellow-400 shadow-yellow-100"
      : uiState === "completed"
      ? "border-green-400"
      : uiState === "ready"
      ? "border-blue-300"
      : "border-gray-200";

  const statusBadgeClass =
    uiState === "in_progress"
      ? "bg-yellow-400 text-yellow-900"
      : uiState === "completed"
      ? "bg-green-500 text-white"
      : uiState === "ready"
      ? "bg-blue-500 text-white"
      : "bg-gray-200 text-gray-700";

  const slot1Props = makeDragProps(1, match.player1_id);
  const slot2Props = makeDragProps(2, match.player2_id);

  return (
    <div
      className={`bg-white rounded-lg border-2 ${statusColor} shadow-sm w-44 cursor-pointer hover:shadow-md transition-shadow`}
      onClick={() => {
        if (suppressNextCardClickRef.current) {
          suppressNextCardClickRef.current = false;
          return;
        }
        onClick?.();
      }}
    >
      <div className={`${statusBadgeClass} text-[11px] text-center font-medium py-0.5 rounded-t-md`}>
        {getUiMatchStateLabel(uiState)}
      </div>
      <div
        {...slot1Props}
        className={`flex items-center justify-between gap-1 px-2 py-1.5 text-xs border-b border-gray-100 ${
          p1Win ? "bg-green-50 font-bold text-green-800" : "text-gray-700"
        } bg-blue-50 ${isDraggable ? "cursor-pointer" : ""} select-none`}
      >
        <span className={`inline-flex items-center justify-center w-9 rounded border px-1 py-0.5 text-[10px] font-bold ${p1SideLabel === "-" ? "border-gray-300 bg-gray-100 text-gray-500" : p1SideLabel === "1P" ? "border-blue-600 bg-blue-600 text-white" : "border-indigo-600 bg-indigo-600 text-white"}`}>
          {p1SideLabel}
        </span>
        <span className="flex-1 truncate">{p1}</span>
        {match.status !== "pending" && (
          <span className="font-mono text-gray-500">{match.player1_wins}</span>
        )}
        {p1Win && <span>✓</span>}
        {match.dq_player_id === match.player1_id && (
          <span className="text-red-500 text-[10px]">DQ</span>
        )}
      </div>
      <div
        {...slot2Props}
        className={`flex items-center justify-between gap-1 px-2 py-1.5 text-xs ${
          p2Win ? "bg-green-50 font-bold text-green-800" : "text-gray-700"
        } bg-indigo-50 ${isDraggable ? "cursor-pointer" : ""} select-none`}
      >
        <span className={`inline-flex items-center justify-center w-9 rounded border px-1 py-0.5 text-[10px] font-bold ${p2SideLabel === "-" ? "border-gray-300 bg-gray-100 text-gray-500" : p2SideLabel === "2P" ? "border-indigo-600 bg-indigo-600 text-white" : "border-blue-600 bg-blue-600 text-white"}`}>
          {p2SideLabel}
        </span>
        <span className="flex-1 truncate">{p2}</span>
        {match.status !== "pending" && (
          <span className="font-mono text-gray-500">{match.player2_wins}</span>
        )}
        {p2Win && <span>✓</span>}
        {match.dq_player_id === match.player2_id && (
          <span className="text-red-500 text-[10px]">DQ</span>
        )}
      </div>
    </div>
  );
}

export function BracketSection({
  matches,
  allMatches,
  playerMap,
  bracket,
  title,
  lockedRounds,
  onRoundClick,
  onMatchClick,
  canEdit,
  draggingFrom,
  onPlayerDragStart,
  onPlayerDrop,
  onDragEnd,
}: Props) {
  if (matches.length === 0) return null;

  const incomingBySlot = buildIncomingBySlot(allMatches);

  // Group by round
  const roundMap = new Map<number, Match[]>();
  for (const m of matches) {
    if (!roundMap.has(m.round)) roundMap.set(m.round, []);
    roundMap.get(m.round)!.push(m);
  }
  const rounds = Array.from(roundMap.entries()).sort(([a], [b]) => a - b);

  const isGrandFinal = bracket === "grand_final" || bracket === "grand_final_reset";

  return (
    <div className="mb-8">
      <h3 className="text-sm font-bold text-gray-600 uppercase tracking-wider mb-3">
        {title}
      </h3>
      <div className="flex gap-6 items-start overflow-x-auto pb-2">
        {rounds.map(([round, roundMatches]) => {
          const sorted = [...roundMatches].sort((a, b) => a.position - b.position);
          const roundLabel = isGrandFinal
            ? bracket === "grand_final_reset"
              ? "リセット"
              : "グランドファイナル"
            : `Round ${round}`;

          return (
            <div key={round} className="flex flex-col items-center shrink-0">
              <button
                type="button"
                onClick={() => onRoundClick?.(round)}
                className={`text-xs mb-2 font-medium px-2 py-1 rounded ${
                  onRoundClick ? "hover:bg-gray-100" : "cursor-default"
                } ${lockedRounds?.has(round) ? "text-amber-700 bg-amber-50" : "text-gray-400"}`}
                title={
                  onRoundClick
                    ? lockedRounds?.has(round)
                      ? "クリックでこのラウンド以降の確定を解除"
                      : "クリックでこのラウンドを確定"
                    : undefined
                }
              >
                {lockedRounds?.has(round) ? "🔒 " : ""}
                {roundLabel}
              </button>
              <div className="flex flex-col gap-4">
                {sorted.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    playerMap={playerMap}
                    incomingBySlot={incomingBySlot}
                    onClick={() => onMatchClick?.(m)}
                    canEdit={canEdit}
                    draggingFrom={draggingFrom}
                    onPlayerDragStart={onPlayerDragStart}
                    onPlayerDrop={onPlayerDrop}
                    onDragEnd={onDragEnd}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}