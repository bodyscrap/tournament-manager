import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { BracketSection } from "../components/bracket/BracketSection";
import { QrScannerDialog } from "../components/common/QrScannerDialog";
import type { DragState } from "../components/bracket/BracketSection";
import type { Match, TournamentPlayer, MatchBracket, MatchActionConfirmerType } from "../lib/types";
import { buildIncomingBySlot, getUiMatchState, getUiMatchStateLabel } from "../lib/matchState";

type SearchUiState = "all" | "ready" | "undecided" | "in_progress" | "completed";

type ScannedCodeInfo = {
  code: string;
  type: MatchActionConfirmerType;
  id: string;
  name: string;
};

export function BracketPage() {
  const navigate = useNavigate();
  const {
    tournament,
    matches: tournamentMatches,
    participants,
    admins,
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
    swapMatchSides,
    randomizeMatchSides,
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
  const [newPlayerCharacter, setNewPlayerCharacter] = useState("");
  const [newPlayerTreeId, setNewPlayerTreeId] = useState<string>("");
  const [addingPlayer, setAddingPlayer] = useState(false);

  // Match search dialog state
  const [showMatchSearch, setShowMatchSearch] = useState(false);
  const [searchPlayerId, setSearchPlayerId] = useState<string>("all");
  const [searchUiState, setSearchUiState] = useState<SearchUiState>("ready");
  const [searchCodeInput, setSearchCodeInput] = useState("");
  const [confirmAuthCode, setConfirmAuthCode] = useState("");
  const [scanTarget, setScanTarget] = useState<"search" | "auth" | null>(null);
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const [sideRandomizeNotice, setSideRandomizeNotice] = useState<"changed" | "unchanged" | null>(null);
  const [sideRandomizeNoticeVisible, setSideRandomizeNoticeVisible] = useState(false);

  // Drag-and-drop state
  const [draggingFrom, setDraggingFrom] = useState<DragState | null>(null);
  const dragSourceRef = useRef<DragState | null>(null);

  const playerMap = new Map<string, TournamentPlayer>(participants.map((p) => [p.player_id, p]));
  const adminMap = new Map(admins.map((a) => [a.admin_id, a]));
  const isCharacterListMode = tournament?.character_input_mode === "list_selection";
  const tournamentCharacterOptions = tournament?.character_list ?? [];
  const maxParticipants = tournament?.max_participants ?? 0;

  const incomingBySlot = buildIncomingBySlot(tournamentMatches);
  const treeNameById = new Map(trees.map((t) => [t.id, t.name]));

  useEffect(() => {
    if (!sideRandomizeNotice) return;
    setSideRandomizeNoticeVisible(true);
    const fadeTimer = window.setTimeout(() => setSideRandomizeNoticeVisible(false), 1200);
    const clearTimer = window.setTimeout(() => setSideRandomizeNotice(null), 1800);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [sideRandomizeNotice]);

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

  const findByCode = (code: string): ScannedCodeInfo | null => {
    const normalized = code.trim();
    if (!normalized) return null;

    const participant = participants.find((p) => p.player_code === normalized);
    if (participant) {
      return {
        code: normalized,
        type: "participant",
        id: participant.player_id,
        name: participant.name,
      };
    }

    const admin = admins.find((a) => a.admin_code === normalized);
    if (admin) {
      return {
        code: normalized,
        type: "admin",
        id: admin.admin_id,
        name: admin.name,
      };
    }
    return null;
  };

  const resolveSearchPlayerIdByCode = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return participants.find((p) => p.player_code === trimmed)?.player_id ?? null;
  };

  const resolveConfirmerByInput = (raw: string): ScannedCodeInfo | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return findByCode(trimmed);
  };

  const extractCodeFromQrPayload = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    return trimmed;
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

  const canAddToTree = (treeId: string) => {
    if (isRoundLocked(treeId, "winners", 1)) return false;

    const round1Matches = tournamentMatches.filter(
      (m) => m.tree_id === treeId && m.bracket === "winners" && m.round === 1
    );
    const pendingByeMatch = round1Matches.find((m) => {
      if (m.status !== "pending") return false;
      const incoming = incomingBySlot.get(m.id) ?? { slot1: false, slot2: false };
      const isByeSlot1 = m.player1_id === null && !incoming.slot1;
      const isByeSlot2 = m.player2_id === null && !incoming.slot2;
      return (m.player1_id !== null && isByeSlot2) || (isByeSlot1 && m.player2_id !== null);
    });
    if (pendingByeMatch) return true;

    const round1Capacity = round1Matches.length * 2;
    return round1Capacity < maxParticipants;
  };

  const canOpenAddPlayer =
    participants.length < maxParticipants &&
    trees.some((tree) => canAddToTree(tree.id));

  const handleMatchClick = (match: Match) => {
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
    setConfirmAuthCode("");
    setConfirmingEdit(false);
    setPendingEdit(null);
    setConfirmingBye(false);
    setPendingBye(null);
    setSideRandomizeNotice(null);
    setSideRandomizeNoticeVisible(false);
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

    // 強制敗北とDQが同時に指定された場合は強制敗北を優先
    if (p1w === p2w && forcedLoser && (forcedLoser === p1Id || forcedLoser === p2Id)) {
      return forcedLoser === p1Id ? p2Id : p1Id;
    }

    if (p1Dq && p2Dq) return null;
    if (p1Dq) return p2Id;
    if (p2Dq) return p1Id;

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

  const buildScoreAuth = (dqPlayerIds: string[], forcedLoser: string | null) => {
    const hasByeDq = dqPlayerIds.some((id) => {
      if (!id) return false;
      return !playerMap.has(id);
    });
    const requiresForcedAuth = !!forcedLoser;
    const requiresDqAuth = dqPlayerIds.length > 0 && !hasByeDq && !requiresForcedAuth;

    let dqConfirmer: ScannedCodeInfo | null = null;
    let forcedConfirmer: ScannedCodeInfo | null = null;

    if (requiresDqAuth) {
      dqConfirmer = resolveConfirmerByInput(confirmAuthCode);
      if (!dqConfirmer) {
        throw new Error("DQ確定には対象プレイヤー本人または管理者のコードが必要です");
      }
      const dqPlayerOwn = dqConfirmer.type === "participant" && dqPlayerIds.includes(dqConfirmer.id);
      const isAdmin = dqConfirmer.type === "admin" && adminMap.has(dqConfirmer.id);
      if (!dqPlayerOwn && !isAdmin) {
        throw new Error("DQ確定は対象プレイヤー本人か管理者のみ実行できます");
      }
    }

    if (requiresForcedAuth) {
      forcedConfirmer = resolveConfirmerByInput(confirmAuthCode);
      if (!forcedConfirmer || forcedConfirmer.type !== "admin" || !adminMap.has(forcedConfirmer.id)) {
        throw new Error("強制敗北の確定には管理者コードが必要です");
      }
    }

    return {
      dqConfirmer,
      forcedLossConfirmer: forcedConfirmer,
    };
  };

  const handleSave = async () => {
    if (!selectedMatch || !tournament || isReadOnly) return;
    if (!validateRequiredMatchCharacters(selectedMatch)) return;
    const dqPlayerIds = [
      p1Dq ? selectedMatch.player1_id : null,
      p2Dq ? selectedMatch.player2_id : null,
    ].filter((id): id is string => !!id);
    let scoreAuth: { dqConfirmer?: ScannedCodeInfo | null; forcedLossConfirmer?: ScannedCodeInfo | null };
    try {
      scoreAuth = buildScoreAuth(dqPlayerIds, forcedLoserId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "認証に失敗しました");
      return;
    }
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
          p2CharName.trim() || null,
          scoreAuth
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
        p2CharName.trim() || null,
        scoreAuth
      );
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmCorrect = async () => {
    if (!pendingEdit) return;
    if (!validateRequiredMatchCharacters(pendingEdit.match)) return;
    let scoreAuth: { dqConfirmer?: ScannedCodeInfo | null; forcedLossConfirmer?: ScannedCodeInfo | null };
    try {
      scoreAuth = buildScoreAuth(pendingEdit.dqPlayerIds, pendingEdit.forcedLoserId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "認証に失敗しました");
      return;
    }
    setSaving(true);
    try {
      await correctScore(
        pendingEdit.match,
        pendingEdit.p1Wins,
        pendingEdit.p2Wins,
        pendingEdit.dqPlayerIds,
        pendingEdit.forcedLoserId,
        p1CharName.trim() || null,
        p2CharName.trim() || null,
        scoreAuth
      );
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmBye = async () => {
    if (!pendingBye) return;
    if (!validateRequiredMatchCharacters(pendingBye.match)) return;
    let scoreAuth: { dqConfirmer?: ScannedCodeInfo | null; forcedLossConfirmer?: ScannedCodeInfo | null };
    try {
      scoreAuth = buildScoreAuth(pendingBye.dqPlayerIds, pendingBye.forcedLoserId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "認証に失敗しました");
      return;
    }
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
        p2CharName.trim() || null,
        scoreAuth
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

  const handleSwapSides = async () => {
    if (!selectedMatch || isReadOnly) return;
    setSaving(true);
    try {
      await swapMatchSides(selectedMatch.id);
      setSideRandomizeNotice(null);
      setSideRandomizeNoticeVisible(false);
      setSelectedMatch((prev) =>
        prev
          ? {
              ...prev,
              player1_side: prev.player2_side,
              player2_side: prev.player1_side,
            }
          : prev
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRandomizeSides = async () => {
    if (!selectedMatch || isReadOnly) return;
    const prevP1Side = selectedMatch.player1_side;
    const prevP2Side = selectedMatch.player2_side;
    setSaving(true);
    try {
      const nextSides = await randomizeMatchSides(selectedMatch.id);
      const changed =
        nextSides.player1_side !== prevP1Side ||
        nextSides.player2_side !== prevP2Side;
      setSideRandomizeNotice(changed ? "changed" : "unchanged");
      setSelectedMatch((prev) =>
        prev
          ? {
              ...prev,
              player1_side: nextSides.player1_side,
              player2_side: nextSides.player2_side,
            }
          : prev
      );
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
    if (!loserId || loserId.startsWith("dummy-")) {
      alert("プレイヤーがいないスロットには強制敗北を適用できません");
      return;
    }
    const winnerId = loserSlot === 1 ? selectedMatch.player2_id : selectedMatch.player1_id;
    const loserName = loserId ? (playerMap.get(loserId)?.name ?? loserId) : "不明";
    const winnerName = winnerId ? (playerMap.get(winnerId)?.name ?? winnerId) : "不明";
    const ok = confirm(
      `「${loserName}」を強制敗北にしますか？\n\n勝者: ${winnerName}\n敗者: ${loserName}\n\nスコアが同点の場合のみ強制敗北を適用します。\nスコア入力済みの場合は入力スコアを優先します。`
    );
    if (!ok) return;

    // DQと同時指定された場合でも、同点時は強制敗北を優先する
    setForcedLoserId(loserId ?? null);
  };

  const closeModal = () => {
    setSelectedMatch(null);
    setConfirmingEdit(false);
    setPendingEdit(null);
    setConfirmingBye(false);
    setPendingBye(null);
    setForcedLoserId(null);
    setConfirmAuthCode("");
    setP1CharName("");
    setP2CharName("");
    setSideRandomizeNotice(null);
    setSideRandomizeNoticeVisible(false);
  };

  const getPlayerName = (id: string | null, hasIncomingFeeder = false) => {
    if (!id) return hasIncomingFeeder ? "TBD" : "BYE";
    return playerMap.get(id)?.name ?? id.slice(0, 8) + "…";
  };

  const openParticipantDetail = (playerId: string | null) => {
    if (!playerId || playerId.startsWith("dummy-")) return;
    setDetailPlayerId(playerId);
  };

  const openParticipantEdit = (playerId: string | null) => {
    if (!playerId || playerId.startsWith("dummy-")) return;
    closeModal();
    setDetailPlayerId(null);
    navigate(`/tournament/setup?editParticipantId=${encodeURIComponent(playerId)}`);
  };

  const renderParticipantDetailDialog = () => {
    if (!detailPlayerId || !tournament?.character_selection_config) return null;

    const target = participants.find((p) => p.player_id === detailPlayerId);
    if (!target) return null;

    const totalSelected = tournament.character_selection_config.categories.reduce(
      (sum, cat) => sum + (target.selected_characters?.[cat.category_id]?.length ?? 0),
      0
    );

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-800">参加者詳細</h3>
              <p className="text-sm text-gray-600 mt-1">
                参加者No. {target.seed} / {target.name}
              </p>
            </div>
            <button
              onClick={() => setDetailPlayerId(null)}
              className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              閉じる
            </button>
          </div>

          <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1 mb-3">
            トータル現在の選択: {totalSelected} / {tournament.character_selection_config.total_max_select} (最小 {tournament.character_selection_config.total_min_select})
          </p>

          <div className="space-y-3">
            {tournament.character_selection_config.categories.map((cat) => {
              const selected = target.selected_characters?.[cat.category_id] ?? [];
              return (
                <div key={cat.category_id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <p className="text-sm font-semibold text-gray-700 mb-1">{cat.category_name}</p>
                  <p className="text-xs text-gray-500 mb-2">
                    現在の選択: {selected.length} / {cat.max_select} (最小 {cat.min_select})
                  </p>
                  {selected.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {selected.map((name, index) => (
                        <span
                          key={`${cat.category_id}-${index}-${name}`}
                          className="text-xs bg-blue-100 text-blue-700 rounded px-2 py-1"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">未選択</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const formatDateTime = (value: string | null | undefined) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("ja-JP", { hour12: false });
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
      await addParticipantAndAssign(
        newPlayerName.trim(),
        newPlayerCharacter.trim() || null,
        "winners",
        newPlayerTreeId
      );
      setNewPlayerName("");
      setNewPlayerCharacter("");
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

  const handleDetectedQr = (rawValue: string) => {
    const extractedCode = extractCodeFromQrPayload(rawValue);

    if (scanTarget === "search") {
      setSearchCodeInput(extractedCode);
      const playerId = resolveSearchPlayerIdByCode(extractedCode);
      if (playerId) {
        setSearchPlayerId(playerId);
      }
    } else if (scanTarget === "auth") {
      setConfirmAuthCode(extractedCode);
    }
    setScanTarget(null);
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
                if (!canOpenAddPlayer) return;
                setNewPlayerTreeId(defaultTreeId);
                setShowAddPlayer((v) => !v);
              }}
              disabled={!canOpenAddPlayer}
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

      <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
        カードを開く: カード内の任意の場所をクリック / シード入れ替え: Ctrlを押しながらプレイヤー名をドラッグ&ドロップ
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
              <label className="text-xs text-blue-700">使用キャラ</label>
              {isCharacterListMode ? (
                <select
                  value={newPlayerCharacter}
                  onChange={(e) => setNewPlayerCharacter(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-blue-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 w-48"
                >
                  <option value="">使用キャラを選択</option>
                  {tournamentCharacterOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    type="text"
                    value={newPlayerCharacter}
                    onChange={(e) => setNewPlayerCharacter(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddPlayer()}
                    list="character-master-options-bracket-add-player"
                    placeholder="任意（候補から選択 or 自由入力）"
                    className="px-3 py-1.5 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white w-48"
                  />
                  <datalist id="character-master-options-bracket-add-player">
                    {characters.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </>
              )}
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
              disabled={
                addingPlayer ||
                !newPlayerName.trim() ||
                !newPlayerTreeId ||
                participants.length >= tournament.max_participants ||
                isAddTargetLocked ||
                (isCharacterListMode && !newPlayerCharacter.trim())
              }
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

            <div className="mb-4 p-3 rounded-lg border border-indigo-200 bg-indigo-50">
              <label className="text-xs text-indigo-700 block mb-1">プレイヤーコードで検索 (手入力 / 2次元バーコード)</label>
              <div className="flex gap-2">
                <input
                  value={searchCodeInput}
                  onChange={(e) => setSearchCodeInput(e.target.value)}
                  placeholder="プレイヤーコード"
                  className="flex-1 px-3 py-2 text-sm border border-indigo-300 rounded-lg bg-white font-mono"
                />
                <button
                  onClick={() => {
                    const playerId = resolveSearchPlayerIdByCode(searchCodeInput);
                    if (!playerId) {
                      alert("対応する参加者コードが見つかりません");
                      return;
                    }
                    setSearchPlayerId(playerId);
                  }}
                  className="px-3 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  適用
                </button>
                <button
                  onClick={() => setScanTarget("search")}
                  className="px-3 py-2 text-sm rounded-lg bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100"
                >
                  カメラ
                </button>
              </div>
              <p className="text-[11px] text-indigo-700 mt-1">カメラが使えない場合は手入力/選択で操作できます。</p>
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
                  const canOpen = true;

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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-6">
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
                    {getUiMatchState(selectedMatch, incomingBySlot) === "in_progress" ? (
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
                  const sidePending = getUiMatchState(selectedMatch, incomingBySlot) === "undecided";
                  const p1SideLabel = sidePending ? "-" : selectedMatch.player1_side;
                  const p2SideLabel = sidePending ? "-" : selectedMatch.player2_side;
                  const canEditSides = !isReadOnly && getUiMatchState(selectedMatch, incomingBySlot) === "ready";
                  return (
                    <>
                {isReadOnly ? (
                  <div className="space-y-3 mb-4">
                    <div className="text-center text-sm text-gray-500">
                      閲覧モード（編集不可）
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">結果確定時刻</p>
                      <p className="text-sm text-gray-800 font-medium">{formatDateTime(selectedMatch.result_finalized_at)}</p>
                    </div>

                    <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                      <div className="flex items-center justify-between text-sm gap-2">
                        <span className="font-medium text-gray-700 min-w-0 truncate">
                          {getPlayerName(selectedMatch.player1_id, incoming.slot1)}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openParticipantDetail(selectedMatch.player1_id)}
                            disabled={!selectedMatch.player1_id || selectedMatch.player1_id.startsWith("dummy-")}
                            className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-40"
                          >
                            詳細
                          </button>
                          <button
                            type="button"
                            onClick={() => openParticipantEdit(selectedMatch.player1_id)}
                            disabled={!selectedMatch.player1_id || selectedMatch.player1_id.startsWith("dummy-")}
                            className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-40"
                          >
                            編集
                          </button>
                          <span className="font-mono text-gray-600">{selectedMatch.player1_wins}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-sm gap-2 mt-2">
                        <span className="font-medium text-gray-700 min-w-0 truncate">
                          {getPlayerName(selectedMatch.player2_id, incoming.slot2)}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openParticipantDetail(selectedMatch.player2_id)}
                            disabled={!selectedMatch.player2_id || selectedMatch.player2_id.startsWith("dummy-")}
                            className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-40"
                          >
                            詳細
                          </button>
                          <button
                            type="button"
                            onClick={() => openParticipantEdit(selectedMatch.player2_id)}
                            disabled={!selectedMatch.player2_id || selectedMatch.player2_id.startsWith("dummy-")}
                            className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-40"
                          >
                            編集
                          </button>
                          <span className="font-mono text-gray-600">{selectedMatch.player2_wins}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 mb-4">
                    {canEditSides && (
                      <>
                      <div className="grid grid-cols-3 gap-2 mb-1">
                        <button
                          onClick={handleSwapSides}
                          disabled={saving}
                          className="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                        >
                          1P / 2P 入れ替え
                        </button>
                        <button
                          onClick={handleRandomizeSides}
                          disabled={saving}
                          className="px-3 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                        >
                          1P / 2P ランダム決定
                        </button>
                        <button
                          onClick={handleSetInProgress}
                          disabled={saving}
                          className="px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                        >
                          {saving ? "処理中..." : "試合中にする"}
                        </button>
                      </div>
                      {sideRandomizeNotice && (
                        <p
                          className={`text-[11px] transition-opacity duration-700 ${
                            sideRandomizeNoticeVisible ? "opacity-100" : "opacity-0"
                          } ${
                            sideRandomizeNotice === "changed" ? "text-emerald-700" : "text-amber-700"
                          }`}
                        >
                          {sideRandomizeNotice === "changed"
                            ? "1P/2Pランダム決定を実行しました（サイド変更あり）"
                            : "1P/2Pランダム決定を実行しました（結果は変更なし）"}
                        </p>
                      )}
                      </>
                    )}
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 inline-flex items-center justify-center w-10 rounded border px-1 py-0.5 text-[10px] font-bold ${p1SideLabel === "-" ? "border-gray-300 bg-gray-100 text-gray-500" : p1SideLabel === "1P" ? "border-blue-200 bg-blue-100 text-blue-700" : "border-indigo-200 bg-indigo-100 text-indigo-700"}`}>
                        {p1SideLabel}
                      </span>
                      <span className="flex-1 min-w-0 text-sm font-medium text-gray-700 truncate">
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
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openParticipantDetail(selectedMatch.player1_id)}
                          disabled={!selectedMatch.player1_id || selectedMatch.player1_id.startsWith("dummy-")}
                          className="text-[10px] px-2 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-40"
                        >
                          詳細
                        </button>
                        <button
                          type="button"
                          onClick={() => openParticipantEdit(selectedMatch.player1_id)}
                          disabled={!selectedMatch.player1_id || selectedMatch.player1_id.startsWith("dummy-")}
                          className="text-[10px] px-2 py-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-40"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => applyForcedLoss(1)}
                          disabled={!selectedMatch.player1_id || selectedMatch.player1_id.startsWith("dummy-")}
                          className="text-xs px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-40"
                        >強制敗北</button>
                        <button
                          onClick={() => {
                            setP1Dq((v) => !v);
                          }}
                          className={`text-xs px-2 py-1 rounded ${p1Dq ? "bg-red-500 text-white" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
                        >DQ</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 inline-flex items-center justify-center w-10 rounded border px-1 py-0.5 text-[10px] font-bold ${p2SideLabel === "-" ? "border-gray-300 bg-gray-100 text-gray-500" : p2SideLabel === "2P" ? "border-indigo-200 bg-indigo-100 text-indigo-700" : "border-blue-200 bg-blue-100 text-blue-700"}`}>
                        {p2SideLabel}
                      </span>
                      <span className="flex-1 min-w-0 text-sm font-medium text-gray-700 truncate">
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
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openParticipantDetail(selectedMatch.player2_id)}
                          disabled={!selectedMatch.player2_id || selectedMatch.player2_id.startsWith("dummy-")}
                          className="text-[10px] px-2 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-40"
                        >
                          詳細
                        </button>
                        <button
                          type="button"
                          onClick={() => openParticipantEdit(selectedMatch.player2_id)}
                          disabled={!selectedMatch.player2_id || selectedMatch.player2_id.startsWith("dummy-")}
                          className="text-[10px] px-2 py-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-40"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => applyForcedLoss(2)}
                          disabled={!selectedMatch.player2_id || selectedMatch.player2_id.startsWith("dummy-")}
                          className="text-xs px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-40"
                        >強制敗北</button>
                        <button
                          onClick={() => {
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

                {!isReadOnly && (
                  <div className="mb-4 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-semibold text-gray-700">確認コード</p>
                    <div>
                      <label className="text-xs text-gray-600 block mb-1">
                        {forcedLoserId
                          ? "確認コード (強制敗北あり: 管理者のみ)"
                          : "確認コード (DQ: 対象本人 or 管理者)"}
                      </label>
                      <div className="flex gap-1">
                        <input
                          value={confirmAuthCode}
                          onChange={(e) => setConfirmAuthCode(e.target.value)}
                          placeholder="コード入力または2次元バーコードスキャン"
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs font-mono"
                        />
                        <button
                          onClick={() => setScanTarget("auth")}
                          className="px-2 py-1 text-xs rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                        >
                          カメラ
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      強制敗北とDQが同時指定された場合は強制敗北の認証を優先します。BYEのみの確定ではコード入力は不要です。
                    </p>
                  </div>
                )}

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

      <QrScannerDialog
        open={scanTarget !== null}
        title={
          scanTarget === "search"
            ? "試合検索用2次元バーコードスキャン"
            : "確認コードの2次元バーコードスキャン"
        }
        onClose={() => setScanTarget(null)}
        onDetected={handleDetectedQr}
      />

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

      {renderParticipantDetailDialog()}
    </div>
  );
}
