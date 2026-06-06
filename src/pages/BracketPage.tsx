import { useEffect, useRef, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { BracketSection } from "../components/bracket/BracketSection";
import type { DragState } from "../components/bracket/BracketSection";
import type { Match, TournamentPlayer, MatchBracket } from "../lib/types";
import { buildIncomingBySlot, getUiMatchState, getUiMatchStateLabel } from "../lib/matchState";

type SearchUiState = "all" | "ready" | "undecided" | "in_progress" | "completed";

export function BracketPage() {
  const {
    tournament,
    matches: tournamentMatches,
    participants,
    characters,
    trees,
    roundLocks,
    isReadOnly,
    recordScore,
    startMatch,
    setMatchReady,
    setMatchCharacters,
    correctScore,
    addParticipantAndAssign,
    isRoundLocked,
    toggleRoundLock,
    swapMatchPlayers,
  } = useAppContext();

  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [p1Wins, setP1Wins] = useState(0);
  const [p2Wins, setP2Wins] = useState(0);
  const [p1CharName, setP1CharName] = useState("");
  const [p2CharName, setP2CharName] = useState("");
  const [p1Dq, setP1Dq] = useState(false);
  const [p2Dq, setP2Dq] = useState(false);
  const [forcedLoserId, setForcedLoserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingEdit, setConfirmingEdit] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{
    match: Match; p1Wins: number; p2Wins: number; dqPlayerIds: string[]; forcedLoserId: string | null;
  } | null>(null);
  const [confirmingBye, setConfirmingBye] = useState(false);
  const [pendingBye, setPendingBye] = useState<{
    match: Match; p1Wins: number; p2Wins: number; dqPlayerIds: string[]; forcedLoserId: string | null;
  } | null>(null);

  // Add player state
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerTreeId, setNewPlayerTreeId] = useState<string>("");
  const [addingPlayer, setAddingPlayer] = useState(false);

  // Match search dialog state
  const [showMatchSearch, setShowMatchSearch] = useState(false);
  const [searchPlayerId, setSearchPlayerId] = useState<string>("all");
  const [searchUiState, setSearchUiState] = useState<SearchUiState>("ready");

  // Drag-and-drop state
  const [draggingFrom, setDraggingFrom] = useState<DragState | null>(null);
  const dragSourceRef = useRef<DragState | null>(null);

  const playerMap = new Map<string, TournamentPlayer>(participants.map((p) => [p.player_id, p]));
  const isCharacterListMode = tournament?.character_input_mode === "list_selection";
  const tournamentCharacterOptions = tournament?.character_list ?? [];

  const incomingBySlot = buildIncomingBySlot(tournamentMatches);
  const treeNameById = new Map(trees.map((t) => [t.id, t.name]));

  const getMatchDisplayTitle = (m: Match) => {
    const bracketLabel =
      m.bracket === "grand_final"
        ? "グランドファイナル"
        : m.bracket === "grand_final_reset"
        ? "グランドファイナル(リセット)"
        : `${m.bracket === "winners" ? "W" : "L"} Round ${m.round}`;
    const treeLabel = m.tree_id ? treeNameById.get(m.tree_id) ?? "未分類" : "未分類";
    return `${treeLabel} / ${bracketLabel}`;
  };

  const searchedMatches = tournamentMatches
    .filter((m) => {
      const uiState = getUiMatchState(m, incomingBySlot);
      if (searchUiState !== "all" && uiState !== searchUiState) return false;
      if (searchPlayerId === "all") return true;
      return m.player1_id === searchPlayerId || m.player2_id === searchPlayerId;
    })
    .sort((a, b) => {
      const ta = treeNameById.get(a.tree_id) ?? "";
      const tb = treeNameById.get(b.tree_id) ?? "";
      if (ta !== tb) return ta.localeCompare(tb, "ja");
      if (a.bracket !== b.bracket) return a.bracket.localeCompare(b.bracket);
      if (a.round !== b.round) return a.round - b.round;
      return a.position - b.position;
    });

  const getLockedRoundsSet = (treeId: string, bracket: MatchBracket): Set<number> =>
    new Set(
      roundLocks
        .filter((r) => r.tree_id === treeId && r.bracket === bracket)
        .map((r) => r.round)
    );

  const isAddTargetLocked =
    !!newPlayerTreeId && isRoundLocked(newPlayerTreeId, "winners", 1);

  const handleMatchClick = (match: Match) => {
    if (isReadOnly && match.status !== "completed") return;
    setSelectedMatch(match);
    setP1Wins(match.player1_wins);
    setP2Wins(match.player2_wins);
    const p1DefaultChar =
      match.player1_character_name ??
      (match.player1_id ? playerMap.get(match.player1_id)?.character_name ?? null : null);
    const p2DefaultChar =
      match.player2_character_name ??
      (match.player2_id ? playerMap.get(match.player2_id)?.character_name ?? null : null);
    setP1CharName(p1DefaultChar ?? "");
    setP2CharName(p2DefaultChar ?? "");
    setP1Dq(match.dq_player_id === match.player1_id);
    setP2Dq(match.dq_player_id === match.player2_id);
    setForcedLoserId(null);
    setConfirmingEdit(false);
    setPendingEdit(null);
    setConfirmingBye(false);
    setPendingBye(null);
  };

  const computeNewWinner = (
    m: Match,
    p1w: number,
    p2w: number,
    dqPlayerIds: string[],
    forcedLoser: string | null
  ): string | null => {
    const incoming = incomingBySlot.get(m.id) ?? { slot1: false, slot2: false };
    const p1Id = m.player1_id;
    const p2Id = m.player2_id;
    const p1Dq = !!p1Id && dqPlayerIds.includes(p1Id);
    const p2Dq = !!p2Id && dqPlayerIds.includes(p2Id);

    if (p1Dq && p2Dq) return null;
    if (p1Dq) return p2Id;
    if (p2Dq) return p1Id;

    // スコア同点時のみ強制敗北を適用(入力済みスコア優先)
    if (p1w === p2w && forcedLoser && (forcedLoser === p1Id || forcedLoser === p2Id)) {
      return forcedLoser === p1Id ? p2Id : p1Id;
    }

    const p1IsReal = !!p1Id && !p1Id.startsWith("dummy-");
    const p2IsReal = !!p2Id && !p2Id.startsWith("dummy-");
    const slot1IsBye = p1Id === null && !incoming.slot1;
    const slot2IsBye = p2Id === null && !incoming.slot2;

    const p1AutoWin = p1IsReal && (slot2IsBye || (p2Id?.startsWith("dummy-") ?? false));
    const p2AutoWin = p2IsReal && (slot1IsBye || (p1Id?.startsWith("dummy-") ?? false));

    // BYE/DUMMY側スコアを上回らせた場合は実プレイヤー敗北(=勝者なし可)
    if (p1AutoWin && !p2AutoWin && p2w > p1w) return p2Id;
    if (p2AutoWin && !p1AutoWin && p1w > p2w) return p1Id;

    if (p1AutoWin && !p2AutoWin) return p1Id;
    if (p2AutoWin && !p1AutoWin) return p2Id;

    if (p1w > p2w) return p1Id;
    if (p2w > p1w) return p2Id;
    return null;
  };

  const validateRequiredMatchCharacters = (match: Match): boolean => {
    if (!tournament || tournament.character_input_mode !== "list_selection") return true;

    if (match.player1_id && !match.player1_id.startsWith("dummy-")) {
      const p1 = p1CharName.trim();
      if (!p1) {
        alert("プレイヤー1の使用キャラは必須です");
        return false;
      }
      if (!tournament.character_list.includes(p1)) {
        alert("プレイヤー1の使用キャラは使用可能キャラリストから選択してください");
        return false;
      }
    }

    if (match.player2_id && !match.player2_id.startsWith("dummy-")) {
      const p2 = p2CharName.trim();
      if (!p2) {
        alert("プレイヤー2の使用キャラは必須です");
        return false;
      }
      if (!tournament.character_list.includes(p2)) {
        alert("プレイヤー2の使用キャラは使用可能キャラリストから選択してください");
        return false;
      }
    }

    return true;
  };

  const handleSave = async () => {
    if (!selectedMatch || !tournament || isReadOnly) return;
    if (!validateRequiredMatchCharacters(selectedMatch)) return;
    const dqPlayerIds = [
      p1Dq ? selectedMatch.player1_id : null,
      p2Dq ? selectedMatch.player2_id : null,
    ].filter((id): id is string => !!id);
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
      const newWinner = computeNewWinner(selectedMatch, p1Wins, p2Wins, dqPlayerIds, forcedLoserId);
      if (newWinner !== selectedMatch.winner_id) {
        setPendingEdit({ match: selectedMatch, p1Wins, p2Wins, dqPlayerIds, forcedLoserId });
        setConfirmingEdit(true);
        return;
      }
      setSaving(true);
      try {
        await correctScore(
          selectedMatch,
          p1Wins,
          p2Wins,
          dqPlayerIds,
          forcedLoserId,
          p1CharName.trim() || null,
          p2CharName.trim() || null
        );
        closeModal();
      } finally {
        setSaving(false);
      }
      return;
    }

    if (isByeMatch) {
      setPendingBye({ match: selectedMatch, p1Wins, p2Wins, dqPlayerIds, forcedLoserId });
      setConfirmingBye(true);
      return;
    }

    setSaving(true);
    try {
      if (selectedMatch.status === "pending" && uiState === "ready") {
        await startMatch(selectedMatch.id);
      }
      await recordScore(
        selectedMatch,
        p1Wins,
        p2Wins,
        dqPlayerIds,
        forcedLoserId,
        p1CharName.trim() || null,
        p2CharName.trim() || null
      );
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmCorrect = async () => {
    if (!pendingEdit) return;
    if (!validateRequiredMatchCharacters(pendingEdit.match)) return;
    setSaving(true);
    try {
      await correctScore(
        pendingEdit.match,
        pendingEdit.p1Wins,
        pendingEdit.p2Wins,
        pendingEdit.dqPlayerIds,
        pendingEdit.forcedLoserId,
        p1CharName.trim() || null,
        p2CharName.trim() || null
      );
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmBye = async () => {
    if (!pendingBye) return;
    if (!validateRequiredMatchCharacters(pendingBye.match)) return;
    setSaving(true);
    try {
      if (pendingBye.match.status === "pending" && getUiMatchState(pendingBye.match, incomingBySlot) === "ready") {
        await startMatch(pendingBye.match.id);
      }
      await recordScore(
        pendingBye.match,
        pendingBye.p1Wins,
        pendingBye.p2Wins,
        pendingBye.dqPlayerIds,
        pendingBye.forcedLoserId,
        p1CharName.trim() || null,
        p2CharName.trim() || null
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
      await setMatchCharacters(
        selectedMatch,
        p1CharName.trim() || null,
        p2CharName.trim() || null
      );
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
      setP1CharName("");
      setP2CharName("");
      setP1Dq(false);
      setP2Dq(false);
      setForcedLoserId(null);
    } finally {
      setSaving(false);
    }
  };

  const applyForcedLoss = (loserSlot: 1 | 2) => {
    if (!selectedMatch) return;

    const loserId = loserSlot === 1 ? selectedMatch.player1_id : selectedMatch.player2_id;
    const winnerId = loserSlot === 1 ? selectedMatch.player2_id : selectedMatch.player1_id;
    const loserName = loserId ? (playerMap.get(loserId)?.name ?? loserId) : "不明";
    const winnerName = winnerId ? (playerMap.get(winnerId)?.name ?? winnerId) : "不明";
    const ok = confirm(
      `「${loserName}」を強制敗北にしますか？\n\n勝者: ${winnerName}\n敗者: ${loserName}\n\nスコアが同点の場合のみ強制敗北を適用します。\nスコア入力済みの場合は入力スコアを優先します。`
    );
    if (!ok) return;

    // DQを使わず、同点時の補助判定として強制敗北を保持する
    setP1Dq(false);
    setP2Dq(false);
    setForcedLoserId(loserId ?? null);
  };

  const closeModal = () => {
    setSelectedMatch(null);
    setConfirmingEdit(false);
    setPendingEdit(null);
    setConfirmingBye(false);
    setPendingBye(null);
    setForcedLoserId(null);
    setP1CharName("");
    setP2CharName("");
  };

  const getPlayerName = (id: string | null, hasIncomingFeeder = false) => {
    if (!id) return hasIncomingFeeder ? "TBD" : "BYE";
    return playerMap.get(id)?.name ?? id.slice(0, 8) + "…";
  };

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim() || !newPlayerTreeId) return;
    const targetRound = 1;
    if (isRoundLocked(newPlayerTreeId, "winners", targetRound)) {
      alert(`Round ${targetRound} は確定済みのため追加できません`);
      return;
    }
    setAddingPlayer(true);
    try {
      await addParticipantAndAssign(newPlayerName.trim(), "winners", newPlayerTreeId);
      setNewPlayerName("");
      setShowAddPlayer(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "プレイヤー追加に失敗しました");
    } finally {
      setAddingPlayer(false);
    }
  };

  const handlePlayerDragStart = (state: DragState | null) => {
    dragSourceRef.current = state;
    setDraggingFrom(state);
  };

  const handlePlayerDragEnd = () => {
    dragSourceRef.current = null;
    setDraggingFrom(null);
  };

  useEffect(() => {
    const clearSelection = () => {
      dragSourceRef.current = null;
      setDraggingFrom(null);
    };
    window.addEventListener("mouseup", clearSelection);
    return () => window.removeEventListener("mouseup", clearSelection);
  }, []);

  const handlePlayerDrop = async (
    targetMatchId: string,
    targetSlot: 1 | 2,
    sourceFromDrop?: DragState
  ) => {
    const source = sourceFromDrop ?? dragSourceRef.current ?? draggingFrom;
    if (!source) return;
    if (source.matchId === targetMatchId && source.slot === targetSlot) return;

    const isRealPlayerId = (id: string | null): id is string => !!id && !id.startsWith("dummy-");
    const sourceMatch = tournamentMatches.find((m) => m.id === source.matchId);
    const targetMatch = tournamentMatches.find((m) => m.id === targetMatchId);
    if (!sourceMatch || !targetMatch) return;

    const sourcePlayerId =
      source.playerId ?? (source.slot === 1 ? sourceMatch.player1_id : sourceMatch.player2_id);

    const targetPlayerId = targetSlot === 1 ? targetMatch.player1_id : targetMatch.player2_id;
    if (!isRealPlayerId(sourcePlayerId) || !isRealPlayerId(targetPlayerId)) {
      dragSourceRef.current = null;
      setDraggingFrom(null);
      return;
    }

    const sourcePlayerName = playerMap.get(sourcePlayerId)?.name ?? sourcePlayerId;
    const targetPlayerName = playerMap.get(targetPlayerId)?.name ?? targetPlayerId;
    const ok = confirm(
      `プレイヤーを入れ替えますか？\n\n${sourcePlayerName} ⇄ ${targetPlayerName}`
    );
    if (!ok) {
      dragSourceRef.current = null;
      setDraggingFrom(null);
      return;
    }

    await swapMatchPlayers(source.matchId, source.slot, targetMatchId, targetSlot);
    dragSourceRef.current = null;
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
        <p className="text-sm text-gray-500 mb-2">
          参加者: {participants.length} / {tournament.max_participants}
        </p>
        <p className="text-gray-400">
          ブラケットが生成されていません。「大会管理」からブラケットを生成してください。
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
          <button
            onClick={() => setShowMatchSearch(true)}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium"
          >
            🔎 試合検索
          </button>
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
          <span className="text-xs px-3 py-1 rounded-full font-medium bg-blue-50 text-blue-700 border border-blue-200">
            参加者 {participants.length} / {tournament.max_participants}
          </span>
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
              <label className="text-xs text-blue-700">追加先</label>
              <div className="px-3 py-1.5 text-sm border border-blue-300 rounded-lg bg-white text-blue-900">
                ウィナーズ Round 1 固定
              </div>
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

      {/* Match search dialog */}
      {showMatchSearch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 text-lg">試合検索</h3>
              <button
                onClick={() => setShowMatchSearch(false)}
                className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
              >
                閉じる
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-600">プレイヤー</label>
                <select
                  value={searchPlayerId}
                  onChange={(e) => setSearchPlayerId(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="all">全プレイヤー</option>
                  {[...participants]
                    .sort((a, b) => a.seed - b.seed)
                    .map((p) => (
                      <option key={p.player_id} value={p.player_id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-600">状態</label>
                <select
                  value={searchUiState}
                  onChange={(e) => setSearchUiState(e.target.value as SearchUiState)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="all">すべて</option>
                  <option value="ready">準備完了</option>
                  <option value="in_progress">試合中</option>
                  <option value="undecided">未決定</option>
                  <option value="completed">結果確定</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-gray-500 mb-3">
              検索結果: {searchedMatches.length} 件
            </p>

            <div className="overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100">
              {searchedMatches.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">
                  条件に一致する試合がありません
                </div>
              ) : (
                searchedMatches.map((m) => {
                  const incoming = incomingBySlot.get(m.id) ?? { slot1: false, slot2: false };
                  const p1Name = m.player1_id
                    ? playerMap.get(m.player1_id)?.name ?? m.player1_id
                    : incoming.slot1
                    ? "TBD"
                    : "BYE";
                  const p2Name = m.player2_id
                    ? playerMap.get(m.player2_id)?.name ?? m.player2_id
                    : incoming.slot2
                    ? "TBD"
                    : "BYE";
                  const uiState = getUiMatchState(m, incomingBySlot);
                  const canOpen = !isReadOnly || m.status === "completed";

                  return (
                    <div key={m.id} className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500 truncate">{getMatchDisplayTitle(m)}</p>
                        <p className="text-sm font-medium text-gray-800 truncate">{p1Name} vs {p2Name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">状態: {getUiMatchStateLabel(uiState)}</p>
                      </div>
                      <button
                        onClick={() => {
                          setShowMatchSearch(false);
                          handleMatchClick(m);
                        }}
                        disabled={!canOpen}
                        className="shrink-0 px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-40"
                      >
                        開く
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
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
                      {isCharacterListMode ? (
                        <select
                          value={p1CharName}
                          onChange={(e) => setP1CharName(e.target.value)}
                          disabled={!selectedMatch.player1_id}
                          className="w-28 text-xs border border-gray-300 rounded px-2 py-1 bg-white disabled:opacity-50"
                        >
                          <option value="">キャラ未設定</option>
                          {tournamentCharacterOptions.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <input
                            value={p1CharName}
                            onChange={(e) => setP1CharName(e.target.value)}
                            disabled={!selectedMatch.player1_id}
                            list="character-master-options-match-p1"
                            className="w-28 text-xs border border-gray-300 rounded px-2 py-1 bg-white disabled:opacity-50"
                            placeholder="キャラ未設定"
                          />
                          <datalist id="character-master-options-match-p1">
                            {characters.map((c) => (
                              <option key={c.id} value={c.name} />
                            ))}
                          </datalist>
                        </>
                      )}
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
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={() => applyForcedLoss(1)}
                          disabled={!selectedMatch.player1_id || !selectedMatch.player2_id}
                          className="text-xs px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-40"
                        >強制敗北</button>
                        <button
                          onClick={() => {
                            setForcedLoserId(null);
                            setP1Dq((v) => !v);
                          }}
                          className={`text-xs px-2 py-1 rounded ${p1Dq ? "bg-red-500 text-white" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
                        >DQ</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-28 text-sm font-medium text-gray-700 truncate">
                        {getPlayerName(selectedMatch.player2_id, incoming.slot2)}
                      </span>
                      {isCharacterListMode ? (
                        <select
                          value={p2CharName}
                          onChange={(e) => setP2CharName(e.target.value)}
                          disabled={!selectedMatch.player2_id}
                          className="w-28 text-xs border border-gray-300 rounded px-2 py-1 bg-white disabled:opacity-50"
                        >
                          <option value="">キャラ未設定</option>
                          {tournamentCharacterOptions.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <input
                            value={p2CharName}
                            onChange={(e) => setP2CharName(e.target.value)}
                            disabled={!selectedMatch.player2_id}
                            list="character-master-options-match-p2"
                            className="w-28 text-xs border border-gray-300 rounded px-2 py-1 bg-white disabled:opacity-50"
                            placeholder="キャラ未設定"
                          />
                          <datalist id="character-master-options-match-p2">
                            {characters.map((c) => (
                              <option key={c.id} value={c.name} />
                            ))}
                          </datalist>
                        </>
                      )}
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
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={() => applyForcedLoss(2)}
                          disabled={!selectedMatch.player1_id || !selectedMatch.player2_id}
                          className="text-xs px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-40"
                        >強制敗北</button>
                        <button
                          onClick={() => {
                            setForcedLoserId(null);
                            setP2Dq((v) => !v);
                          }}
                          className={`text-xs px-2 py-1 rounded ${p2Dq ? "bg-red-500 text-white" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
                        >DQ</button>
                      </div>
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
              onPlayerDragStart={handlePlayerDragStart}
              onPlayerDrop={handlePlayerDrop}
              onDragEnd={handlePlayerDragEnd}
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
                onPlayerDragStart={handlePlayerDragStart}
                onPlayerDrop={handlePlayerDrop}
                onDragEnd={handlePlayerDragEnd}
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
                onPlayerDragStart={handlePlayerDragStart}
                onPlayerDrop={handlePlayerDrop}
                onDragEnd={handlePlayerDragEnd}
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
                onPlayerDragStart={handlePlayerDragStart}
                onPlayerDrop={handlePlayerDrop}
                onDragEnd={handlePlayerDragEnd}
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
            onPlayerDragStart={handlePlayerDragStart}
            onPlayerDrop={handlePlayerDrop}
            onDragEnd={handlePlayerDragEnd}
          />
        </div>
      )}
    </div>
  );
}
