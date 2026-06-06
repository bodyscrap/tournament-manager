import { useState } from "react";
import { useAppContext } from "../context/AppContext";
import { BracketSection } from "../components/bracket/BracketSection";
import type { DragState } from "../components/bracket/BracketSection";
import type { Match, TournamentPlayer, MatchBracket } from "../lib/types";
import { buildIncomingBySlot, getUiMatchState } from "../lib/matchState";

export function BracketPage() {
  const {
    tournament,
    matches: tournamentMatches,
    participants,
    trees,
    roundLocks,
    isReadOnly,
    recordScore,
    startMatch,
    setMatchReady,
    correctScore,
    addParticipantAndAssign,
    isRoundLocked,
    toggleRoundLock,
    swapMatchPlayers,
  } = useAppContext();

  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [p1Wins, setP1Wins] = useState(0);
  const [p2Wins, setP2Wins] = useState(0);
  const [dqSlot, setDqSlot] = useState<0 | 1 | 2>(0);
  const [saving, setSaving] = useState(false);
  const [confirmingEdit, setConfirmingEdit] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{
    match: Match; p1Wins: number; p2Wins: number; dqPlayerId: string | null;
  } | null>(null);
  const [confirmingBye, setConfirmingBye] = useState(false);
  const [pendingBye, setPendingBye] = useState<{
    match: Match; p1Wins: number; p2Wins: number; dqPlayerId: string | null;
  } | null>(null);

  // Add player state
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerBracket, setNewPlayerBracket] = useState<MatchBracket>("winners");
  const [newPlayerTreeId, setNewPlayerTreeId] = useState<string>("");
  const [addingPlayer, setAddingPlayer] = useState(false);

  // Drag-and-drop state
  const [draggingFrom, setDraggingFrom] = useState<DragState | null>(null);

  const playerMap = new Map<string, TournamentPlayer>(participants.map((p) => [p.player_id, p]));

  const incomingBySlot = buildIncomingBySlot(tournamentMatches);

  const getLowestUnfinishedRound = (treeId: string, bracket: MatchBracket): number => {
    const scoped = tournamentMatches.filter(
      (m) => m.tree_id === treeId && m.bracket === bracket
    );
    const unfinished = scoped.filter((m) => m.status !== "completed");
    if (unfinished.length > 0) return Math.min(...unfinished.map((m) => m.round));
    return 1;
  };

  const getLockedRoundsSet = (treeId: string, bracket: MatchBracket): Set<number> =>
    new Set(
      roundLocks
        .filter((r) => r.tree_id === treeId && r.bracket === bracket)
        .map((r) => r.round)
    );

  const isAddTargetLocked =
    !!newPlayerTreeId && isRoundLocked(newPlayerTreeId, newPlayerBracket, getLowestUnfinishedRound(newPlayerTreeId, newPlayerBracket));

  const handleMatchClick = (match: Match) => {
    if (isReadOnly && match.status !== "completed") return;
    setSelectedMatch(match);
    setP1Wins(match.player1_wins);
    setP2Wins(match.player2_wins);
    setDqSlot(0);
    setConfirmingEdit(false);
    setPendingEdit(null);
    setConfirmingBye(false);
    setPendingBye(null);
  };

  const computeNewWinner = (m: Match, p1w: number, p2w: number, dq: string | null): string | null => {
    if (dq) return dq === m.player1_id ? m.player2_id : m.player1_id;
    if (p1w > p2w) return m.player1_id;
    if (p2w > p1w) return m.player2_id;
    return null;
  };

  const handleSave = async () => {
    if (!selectedMatch || !tournament || isReadOnly) return;
    const dq_player_id =
      dqSlot === 1 ? selectedMatch.player1_id :
      dqSlot === 2 ? selectedMatch.player2_id : null;
    const uiState = getUiMatchState(selectedMatch, incomingBySlot);
    if (uiState === "undecided") {
      alert("このカードは未決定です。TBDが解消されてから試合開始してください。");
      return;
    }
    const incoming = incomingBySlot.get(selectedMatch.id) ?? { slot1: false, slot2: false };
    const isByeMatch =
      (selectedMatch.player1_id !== null && selectedMatch.player2_id === null && !incoming.slot2) ||
      (selectedMatch.player1_id === null && selectedMatch.player2_id !== null && !incoming.slot1);

    if (selectedMatch.status === "completed") {
      const newWinner = computeNewWinner(selectedMatch, p1Wins, p2Wins, dq_player_id);
      if (newWinner !== selectedMatch.winner_id) {
        setPendingEdit({ match: selectedMatch, p1Wins, p2Wins, dqPlayerId: dq_player_id });
        setConfirmingEdit(true);
        return;
      }
      setSaving(true);
      try {
        await correctScore(selectedMatch, p1Wins, p2Wins, dq_player_id);
        closeModal();
      } finally {
        setSaving(false);
      }
      return;
    }

    if (isByeMatch) {
      setPendingBye({ match: selectedMatch, p1Wins, p2Wins, dqPlayerId: dq_player_id });
      setConfirmingBye(true);
      return;
    }

    setSaving(true);
    try {
      if (selectedMatch.status === "pending" && uiState === "ready") {
        await startMatch(selectedMatch.id);
      }
      await recordScore(selectedMatch, p1Wins, p2Wins, dq_player_id);
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmCorrect = async () => {
    if (!pendingEdit) return;
    setSaving(true);
    try {
      await correctScore(pendingEdit.match, pendingEdit.p1Wins, pendingEdit.p2Wins, pendingEdit.dqPlayerId);
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmBye = async () => {
    if (!pendingBye) return;
    setSaving(true);
    try {
      if (pendingBye.match.status === "pending" && getUiMatchState(pendingBye.match, incomingBySlot) === "ready") {
        await startMatch(pendingBye.match.id);
      }
      await recordScore(
        pendingBye.match,
        pendingBye.p1Wins,
        pendingBye.p2Wins,
        pendingBye.dqPlayerId
      );
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleSetInProgress = async () => {
    if (!selectedMatch || isReadOnly) return;
    setSaving(true);
    try {
      await startMatch(selectedMatch.id);
      setSelectedMatch((prev) => (prev ? { ...prev, status: "in_progress" } : prev));
    } finally {
      setSaving(false);
    }
  };

  const handleSetReady = async () => {
    if (!selectedMatch || isReadOnly) return;
    setSaving(true);
    try {
      await setMatchReady(selectedMatch.id);
      setSelectedMatch((prev) =>
        prev
          ? {
              ...prev,
              status: "pending",
              player1_wins: 0,
              player2_wins: 0,
              winner_id: null,
              dq_player_id: null,
            }
          : prev
      );
      setP1Wins(0);
      setP2Wins(0);
      setDqSlot(0);
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setSelectedMatch(null);
    setConfirmingEdit(false);
    setPendingEdit(null);
    setConfirmingBye(false);
    setPendingBye(null);
  };

  const getPlayerName = (id: string | null, hasIncomingFeeder = false) => {
    if (!id) return hasIncomingFeeder ? "TBD" : "BYE";
    return playerMap.get(id)?.name ?? id.slice(0, 8) + "…";
  };

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim() || !newPlayerTreeId) return;
    const targetRound = getLowestUnfinishedRound(newPlayerTreeId, newPlayerBracket);
    if (isRoundLocked(newPlayerTreeId, newPlayerBracket, targetRound)) {
      alert(`Round ${targetRound} は確定済みのため追加できません`);
      return;
    }
    setAddingPlayer(true);
    try {
      await addParticipantAndAssign(newPlayerName.trim(), newPlayerBracket, newPlayerTreeId);
      setNewPlayerName("");
      setShowAddPlayer(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "プレイヤー追加に失敗しました");
    } finally {
      setAddingPlayer(false);
    }
  };

  const handlePlayerDrop = async (targetMatchId: string, targetSlot: 1 | 2) => {
    if (!draggingFrom) return;
    if (draggingFrom.matchId === targetMatchId && draggingFrom.slot === targetSlot) return;
    await swapMatchPlayers(draggingFrom.matchId, draggingFrom.slot, targetMatchId, targetSlot);
    setDraggingFrom(null);
  };

  const handleRoundToggle = async (treeId: string, bracket: MatchBracket, round: number) => {
    if (isReadOnly || !tournament) return;
    const locked = isRoundLocked(treeId, bracket, round);
    const ok = locked
      ? confirm(`Round ${round} の確定を解除しますか？\nこのラウンド以降の確定も解除されます。`)
      : confirm(`Round ${round} を確定しますか？\n確定後はこのラウンドに途中参加を追加できません。`);
    if (!ok) return;
    await toggleRoundLock(treeId, bracket, round);
  };

  // Default tree for add player panel
  const defaultTreeId = trees[0]?.id ?? "";

  if (!tournament) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">ブラケット</h2>
        <p className="text-gray-400">大会が選択されていません。</p>
      </div>
    );
  }

  if (tournamentMatches.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">ブラケット</h2>
        <p className="text-gray-400">
          ブラケットが生成されていません。「大会設定」からブラケットを生成してください。
        </p>
      </div>
    );
  }

  // tree_id = '' の試合は未分類グループとして扱う
  const orphanMatches = tournamentMatches.filter((m) => !m.tree_id);

  return (
    <div className="p-6">
      {isReadOnly && (
        <div className="mb-4 px-4 py-3 bg-gray-100 border border-gray-300 rounded-xl flex items-center gap-2 text-sm text-gray-600">
          <span>🔒</span>
          <span>結果確定済み — 閲覧のみ（試合結果の入力はできません）</span>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          {tournament.name} — ブラケット
        </h2>
        <div className="flex items-center gap-3">
          {tournament.status === "in_progress" && !isReadOnly && (
            <button
              onClick={() => {
                setNewPlayerTreeId(defaultTreeId);
                setShowAddPlayer((v) => !v);
              }}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
            >
              ＋ プレイヤー追加
            </button>
          )}
          <span
            className={`text-xs px-3 py-1 rounded-full font-medium ${
              tournament.status === "in_progress"
                ? "bg-green-100 text-green-700"
                : tournament.status === "completed"
                ? "bg-gray-100 text-gray-500"
                : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {tournament.status === "setup"
              ? "設定中"
              : tournament.status === "in_progress"
              ? "進行中"
              : "終了"}
          </span>
        </div>
      </div>

      {/* Add player panel */}
      {showAddPlayer && tournament.status === "in_progress" && !isReadOnly && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <h3 className="text-sm font-bold text-blue-800 mb-3">新規プレイヤーをブラケットに追加</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-blue-700">プレイヤー名</label>
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddPlayer()}
                placeholder="名前を入力..."
                className="px-3 py-1.5 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white w-48"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-blue-700">ブラケット</label>
              <select
                value={newPlayerBracket}
                onChange={(e) => setNewPlayerBracket(e.target.value as MatchBracket)}
                className="px-3 py-1.5 text-sm border border-blue-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="winners">ウィナーズ</option>
                {tournament.type === "double_elimination" && (
                  <option value="losers">ルーザーズ</option>
                )}
              </select>
            </div>
            {trees.length > 1 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-blue-700">ツリー</label>
                <select
                  value={newPlayerTreeId}
                  onChange={(e) => setNewPlayerTreeId(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-blue-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {trees.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={handleAddPlayer}
              disabled={addingPlayer || !newPlayerName.trim() || !newPlayerTreeId || participants.length >= tournament.max_participants || isAddTargetLocked}
              className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {addingPlayer ? "追加中..." : "追加"}
            </button>
            <button
              onClick={() => setShowAddPlayer(false)}
              className="px-3 py-1.5 text-sm bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 rounded-lg"
            >
              キャンセル
            </button>
          </div>
          <p className="text-xs text-blue-600 mt-2">
            ※ 奇数人数のラウンドがある場合、余剰スロットに自動で割り当てられます
          </p>
          <p className="text-xs text-blue-600 mt-1">
            ※ ラウンド見出しをクリックすると確定/解除できます。確定済みラウンドには追加できません。
          </p>
        </div>
      )}

      {/* Match detail panel */}
      {selectedMatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-800 mb-4 text-center">
              {selectedMatch.bracket === "grand_final"
                ? "グランドファイナル"
                : selectedMatch.bracket === "grand_final_reset"
                ? "グランドファイナル (リセット)"
                : `${selectedMatch.bracket === "winners" ? "ウィナーズ" : "ルーザーズ"} Round ${selectedMatch.round}`}
            </h3>

            {confirmingEdit ? (
              <div>
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm font-bold text-amber-800">⚠️ 勝者が変わります</p>
                  <p className="text-xs text-amber-700 mt-1">
                    以降の関連する試合はリセットされ、やり直しになります。よろしいですか？
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmCorrect}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? "修正中..." : "確認して修正"}
                  </button>
                  <button
                    onClick={() => setConfirmingEdit(false)}
                    className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : confirmingBye ? (
              <div>
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-bold text-blue-800">BYE戦を確定します</p>
                  <p className="text-xs text-blue-700 mt-1">
                    この試合は片側がBYEです。現在の入力内容で結果を確定してよろしいですか？
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmBye}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? "確定中..." : "確認して確定"}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmingBye(false);
                      setPendingBye(null);
                    }}
                    className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <>
                {!isReadOnly && selectedMatch.status !== "completed" && (
                  <div className="mb-3">
                    {getUiMatchState(selectedMatch, incomingBySlot) === "ready" ? (
                      <button
                        onClick={handleSetInProgress}
                        disabled={saving}
                        className="w-full px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        {saving ? "処理中..." : "試合中にする"}
                      </button>
                    ) : getUiMatchState(selectedMatch, incomingBySlot) === "in_progress" ? (
                      <button
                        onClick={handleSetReady}
                        disabled={saving}
                        className="w-full px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        {saving ? "処理中..." : "準備完了に戻す"}
                      </button>
                    ) : null}
                  </div>
                )}
                {(() => {
                  const incoming = incomingBySlot.get(selectedMatch.id) ?? {
                    slot1: false,
                    slot2: false,
                  };
                  return (
                    <>
                {isReadOnly ? (
                  <div className="text-center text-sm text-gray-500 mb-4">
                    この試合は完了しています
                  </div>
                ) : (
                  <div className="space-y-3 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-28 text-sm font-medium text-gray-700 truncate">
                        {getPlayerName(selectedMatch.player1_id, incoming.slot1)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setP1Wins(Math.max(0, p1Wins - 1))}
                          className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-lg leading-none"
                        >−</button>
                        <span className="w-8 text-center font-mono font-bold">{p1Wins}</span>
                        <button
                          onClick={() => setP1Wins(p1Wins + 1)}
                          className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-lg leading-none"
                        >＋</button>
                      </div>
                      <button
                        onClick={() => setDqSlot(dqSlot === 1 ? 0 : 1)}
                        className={`text-xs px-2 py-1 rounded ml-auto ${dqSlot === 1 ? "bg-red-500 text-white" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
                      >DQ</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-28 text-sm font-medium text-gray-700 truncate">
                        {getPlayerName(selectedMatch.player2_id, incoming.slot2)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setP2Wins(Math.max(0, p2Wins - 1))}
                          className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-lg leading-none"
                        >−</button>
                        <span className="w-8 text-center font-mono font-bold">{p2Wins}</span>
                        <button
                          onClick={() => setP2Wins(p2Wins + 1)}
                          className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-lg leading-none"
                        >＋</button>
                      </div>
                      <button
                        onClick={() => setDqSlot(dqSlot === 2 ? 0 : 2)}
                        className={`text-xs px-2 py-1 rounded ml-auto ${dqSlot === 2 ? "bg-red-500 text-white" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
                      >DQ</button>
                    </div>
                  </div>
                )}
                    </>
                  );
                })()}
                <div className="flex gap-2">
                  {!isReadOnly && (
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {saving ? "保存中..." : selectedMatch.status === "completed" ? "結果を修正" : "結果を確定"}
                    </button>
                  )}
                  <button
                    onClick={closeModal}
                    className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
                  >
                    閉じる
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ツリーごとにブラケットを表示 */}
      {trees.map((tree) => {
        const treeMatches = tournamentMatches.filter((m) => m.tree_id === tree.id);
        if (treeMatches.length === 0) return null;

        const winners = treeMatches.filter((m) => m.bracket === "winners");
        const losers = treeMatches.filter((m) => m.bracket === "losers");
        const grandFinal = treeMatches.filter((m) => m.bracket === "grand_final");
        const gfReset = treeMatches.filter((m) => m.bracket === "grand_final_reset");

        return (
          <div key={tree.id} className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-lg font-bold text-gray-700">{tree.name}</h3>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {treeMatches.length} 試合
              </span>
            </div>

            <BracketSection
              matches={winners}
              allMatches={treeMatches}
              playerMap={playerMap}
              bracket="winners"
              title="ウィナーズ"
              lockedRounds={getLockedRoundsSet(tree.id, "winners")}
              onRoundClick={(round) => handleRoundToggle(tree.id, "winners", round)}
              onMatchClick={handleMatchClick}
              canEdit={!isReadOnly && tournament.status === "in_progress"}
              draggingFrom={draggingFrom}
              onPlayerDragStart={setDraggingFrom}
              onPlayerDrop={handlePlayerDrop}
              onDragEnd={() => setDraggingFrom(null)}
            />
            {losers.length > 0 && (
              <BracketSection
                matches={losers}
                allMatches={treeMatches}
                playerMap={playerMap}
                bracket="losers"
                title="ルーザーズ"
                lockedRounds={getLockedRoundsSet(tree.id, "losers")}
                onRoundClick={(round) => handleRoundToggle(tree.id, "losers", round)}
                onMatchClick={handleMatchClick}
                canEdit={!isReadOnly && tournament.status === "in_progress"}
                draggingFrom={draggingFrom}
                onPlayerDragStart={setDraggingFrom}
                onPlayerDrop={handlePlayerDrop}
                onDragEnd={() => setDraggingFrom(null)}
              />
            )}
            {grandFinal.length > 0 && (
              <BracketSection
                matches={grandFinal}
                allMatches={treeMatches}
                playerMap={playerMap}
                bracket="grand_final"
                title="グランドファイナル"
                lockedRounds={getLockedRoundsSet(tree.id, "grand_final")}
                onRoundClick={(round) => handleRoundToggle(tree.id, "grand_final", round)}
                onMatchClick={handleMatchClick}
                canEdit={!isReadOnly && tournament.status === "in_progress"}
                draggingFrom={draggingFrom}
                onPlayerDragStart={setDraggingFrom}
                onPlayerDrop={handlePlayerDrop}
                onDragEnd={() => setDraggingFrom(null)}
              />
            )}
            {gfReset.length > 0 && (
              <BracketSection
                matches={gfReset}
                allMatches={treeMatches}
                playerMap={playerMap}
                bracket="grand_final_reset"
                title="グランドファイナル (リセット)"
                lockedRounds={getLockedRoundsSet(tree.id, "grand_final_reset")}
                onRoundClick={(round) => handleRoundToggle(tree.id, "grand_final_reset", round)}
                onMatchClick={handleMatchClick}
                canEdit={!isReadOnly && tournament.status === "in_progress"}
                draggingFrom={draggingFrom}
                onPlayerDragStart={setDraggingFrom}
                onPlayerDrop={handlePlayerDrop}
                onDragEnd={() => setDraggingFrom(null)}
              />
            )}
          </div>
        );
      })}

      {/* ツリー未所属の試合（旧データ対応） */}
      {orphanMatches.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-lg font-bold text-gray-500">未分類</h3>
          </div>
          <BracketSection
            matches={orphanMatches}
            allMatches={orphanMatches}
            playerMap={playerMap}
            bracket="winners"
            title="試合一覧"
            lockedRounds={getLockedRoundsSet("", "winners")}
            onRoundClick={(round) => handleRoundToggle("", "winners", round)}
            onMatchClick={handleMatchClick}
            canEdit={!isReadOnly && tournament.status === "in_progress"}
            draggingFrom={draggingFrom}
            onPlayerDragStart={setDraggingFrom}
            onPlayerDrop={handlePlayerDrop}
            onDragEnd={() => setDraggingFrom(null)}
          />
        </div>
      )}
    </div>
  );
}
