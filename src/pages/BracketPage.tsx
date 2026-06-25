import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { useMessageNotification } from "../hooks/useMessageNotification";
import { BracketSection } from "../components/bracket/BracketSection";
import { QrScannerDialog } from "../components/common/QrScannerDialog";
import type { DragState } from "../components/bracket/BracketSection";
import type { Match, TournamentPlayer, MatchBracket, MatchActionConfirmerType } from "../lib/types";
import { buildIncomingBySlot, getUiMatchState, getUiMatchStateLabel } from "../lib/matchState";
import { extractUserCode, normalizeEventCode } from "../lib/playerCode";
import { buildMatchCardIdFromMatch } from "../lib/matchCardId";

type SearchUiState = "all" | "ready" | "undecided" | "in_progress" | "completed";

type ScannedCodeInfo = {
  code: string;
  type: MatchActionConfirmerType;
  id: string;
  name: string;
};

export function BracketPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { unreadReceivedCount } = useMessageNotification();
  const {
    tournament,
    matches: tournamentMatches,
    participants,
    admins,
    matchActionLogs,
    trees,
    roundLocks,
    isReadOnly,
    recordScore,
    startMatch,
    setMatchReady,
    setMatchCharacters,
    correctScore,
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
  const [p1Forfeit, setP1Forfeit] = useState(false);
  const [p2Forfeit, setP2Forfeit] = useState(false);
  const [forfeitAllMatches, setForfeitAllMatches] = useState(false);
  const [forfeitDialogSlot, setForfeitDialogSlot] = useState<1 | 2 | null>(null);
  const [dqLoserId, setDqLoserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingEdit, setConfirmingEdit] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{
    match: Match; p1Wins: number; p2Wins: number; forfeitPlayerIds: string[]; dqLoserId: string | null;
  } | null>(null);
  const [confirmingBye, setConfirmingBye] = useState(false);
  const [pendingBye, setPendingBye] = useState<{
    match: Match; p1Wins: number; p2Wins: number; forfeitPlayerIds: string[]; dqLoserId: string | null;
  } | null>(null);

  // Match search dialog state
  const [showMatchSearch, setShowMatchSearch] = useState(false);
  const [searchPlayerId, setSearchPlayerId] = useState<string>("all");
  const [searchUiState, setSearchUiState] = useState<SearchUiState>("ready");
  const [searchCodeInput, setSearchCodeInput] = useState("");
  const [confirmAuthCode, setConfirmAuthCode] = useState("");
  const [authenticatedPlayerIds, setAuthenticatedPlayerIds] = useState<string[]>([]);
  const [authenticatedAdminIds, setAuthenticatedAdminIds] = useState<string[]>([]);
  const [lastAuthenticatedAdminId, setLastAuthenticatedAdminId] = useState<string | null>(null);
  const [scanTarget, setScanTarget] = useState<"search" | "auth" | null>(null);
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const [sideRandomizeNotice, setSideRandomizeNotice] = useState<"changed" | "unchanged" | null>(null);
  const [sideRandomizeNoticeVisible, setSideRandomizeNoticeVisible] = useState(false);
  const [showBracketMessageNotice, setShowBracketMessageNotice] = useState(false);

  // Drag-and-drop state
  const [draggingFrom, setDraggingFrom] = useState<DragState | null>(null);
  const dragSourceRef = useRef<DragState | null>(null);
  const previousUnreadRef = useRef(0);
  const handledRemoteDqQueryRef = useRef<string | null>(null);

  const playerMap = new Map<string, TournamentPlayer>(participants.map((p) => [p.player_id, p]));
  const adminMap = new Map(admins.map((a) => [a.admin_id, a]));
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

  useEffect(() => {
    if (unreadReceivedCount > previousUnreadRef.current) {
      setShowBracketMessageNotice(true);
    }
    previousUnreadRef.current = unreadReceivedCount;
  }, [unreadReceivedCount]);

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

  const getParticipantDisplayName = (id: string): string => {
    const participant = playerMap.get(id);
    if (!participant) return id;
    return `${participant.player_id_4}: ${participant.name}`;
  };

  const getAdminDisplayName = (id: string | null): string => {
    if (!id) return "未認証";
    const admin = admins.find((a) => a.admin_id === id);
    if (!admin) return "未認証";
    return `${admin.admin_id_4}: ${admin.name}`;
  };

  const getActionTypeLabel = (actionType: string): string => {
    if (actionType === "forfeit") return "棄権";
    if (actionType === "dq") return "DQ";
    return "結果確定";
  };

  const getConfirmerLabel = (type: MatchActionConfirmerType, name: string): string => {
    if (type === "none") return "認証なし";
    if (type === "admin") return `${name} (管理者)`;
    return `${name} (本人)`;
  };

  const currentEventCode = normalizeEventCode(tournament?.event_code ?? "0000");

  const findByCode = (code: string): ScannedCodeInfo | null => {
    const normalized = extractUserCode(code);
    if (!normalized || !normalized.startsWith(currentEventCode)) return null;

    const participant = participants.find((p) => extractUserCode(p.player_code) === normalized);
    if (participant) {
      return {
        code: normalized,
        type: "participant",
        id: participant.player_id,
        name: participant.name,
      };
    }

    const admin = admins.find((a) => extractUserCode(a.admin_code) === normalized);
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
    const normalized = extractUserCode(raw);
    if (!normalized || !normalized.startsWith(currentEventCode)) return null;
    return participants.find((p) => extractUserCode(p.player_code) === normalized)?.player_id ?? null;
  };

  const resolveConfirmerByInput = (raw: string): ScannedCodeInfo | null => {
    return findByCode(raw);
  };

  const authenticateCodeForMatch = (
    match: Match,
    rawCode: string,
    options?: { silent?: boolean }
  ): { ok: boolean; message?: string } => {
    const confirmer = resolveConfirmerByInput(rawCode);
    if (!confirmer) {
      const message = "有効なコードではありません";
      if (!options?.silent) alert(message);
      return { ok: false, message };
    }

    if (confirmer.type === "participant") {
      if (confirmer.id !== match.player1_id && confirmer.id !== match.player2_id) {
        const message = "この試合の参加者コードを入力してください";
        if (!options?.silent) alert(message);
        return { ok: false, message };
      }
      setAuthenticatedPlayerIds((prev) => (prev.includes(confirmer.id) ? prev : [...prev, confirmer.id]));
      if (!options?.silent) {
        alert(`${getParticipantDisplayName(confirmer.id)} を認証しました`);
      }
      return { ok: true };
    }

    if (!adminMap.has(confirmer.id)) {
      const message = "管理者コードが無効です";
      if (!options?.silent) alert(message);
      return { ok: false, message };
    }
    setAuthenticatedAdminIds([confirmer.id]);
    setLastAuthenticatedAdminId(confirmer.id);
    if (!options?.silent) {
      alert(`${getAdminDisplayName(confirmer.id)} を認証しました`);
    }
    return { ok: true };
  };

  const extractCodeFromQrPayload = (raw: string): string => {
    return extractUserCode(raw);
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
    setP1Forfeit(!!match.player1_id && match.forfeit_player_id === match.player1_id);
    setP2Forfeit(!!match.player2_id && match.forfeit_player_id === match.player2_id);
    setForfeitAllMatches(false);
    setForfeitDialogSlot(null);
    setDqLoserId(null);
    setConfirmAuthCode("");
    setAuthenticatedPlayerIds([]);
    setAuthenticatedAdminIds([]);
    setLastAuthenticatedAdminId(null);
    setConfirmingEdit(false);
    setPendingEdit(null);
    setConfirmingBye(false);
    setPendingBye(null);
    setSideRandomizeNotice(null);
    setSideRandomizeNoticeVisible(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("fromRemoteDq") !== "1") {
      handledRemoteDqQueryRef.current = null;
      return;
    }

    const clearRemoteDqParams = () => {
      navigate("/tournament/bracket", { replace: true });
    };

    const matchCardId = params.get("matchCardId")?.trim() ?? "";
    const dqPlayerId = params.get("dqPlayerId")?.trim() ?? "";
    const dqUserCode = params.get("dqUserCode")?.trim() ?? "";
    const remoteForfeitAllMatches = params.get("forfeitAllMatches") === "1";
    const remoteDqQueryKey = `${matchCardId}|${dqPlayerId}|${dqUserCode}|${remoteForfeitAllMatches ? "1" : "0"}`;

    if (handledRemoteDqQueryRef.current === remoteDqQueryKey) {
      return;
    }
    handledRemoteDqQueryRef.current = remoteDqQueryKey;

    if (!matchCardId || !dqPlayerId || !dqUserCode) {
      clearRemoteDqParams();
      return;
    }

    const targetMatch = tournamentMatches.find((m) => buildMatchCardIdFromMatch(m) === matchCardId);
    if (!targetMatch) {
      clearRemoteDqParams();
      return;
    }

    const currentIncomingBySlot = buildIncomingBySlot(tournamentMatches);
    const uiState = getUiMatchState(targetMatch, currentIncomingBySlot);
    const canPrefillRemoteDq = uiState === "ready" || uiState === "in_progress";
    const isTargetPlayerOnCard =
      targetMatch.player1_id === dqPlayerId || targetMatch.player2_id === dqPlayerId;

    if (!canPrefillRemoteDq || !isTargetPlayerOnCard) {
      clearRemoteDqParams();
      return;
    }

    handleMatchClick(targetMatch);
    setDqLoserId(null);
    setP1Forfeit(targetMatch.player1_id === dqPlayerId);
    setP2Forfeit(targetMatch.player2_id === dqPlayerId);
    setForfeitAllMatches(remoteForfeitAllMatches);
    setConfirmAuthCode(dqUserCode);
    const autoAuth = authenticateCodeForMatch(targetMatch, dqUserCode, { silent: true });
    if (!autoAuth.ok) {
      alert(autoAuth.message ?? "リモート棄権用コードの自動認証に失敗しました");
    }
    clearRemoteDqParams();
  }, [location.search, tournamentMatches, navigate]);

  const computeNewWinner = (
    m: Match,
    p1w: number,
    p2w: number,
    forfeitPlayerIds: string[],
    dqLoser: string | null
  ): string | null => {
    const incoming = incomingBySlot.get(m.id) ?? { slot1: false, slot2: false };
    const p1Id = m.player1_id;
    const p2Id = m.player2_id;
    const p1Forfeit = !!p1Id && forfeitPlayerIds.includes(p1Id);
    const p2Forfeit = !!p2Id && forfeitPlayerIds.includes(p2Id);

    // 棄権とDQが同時に指定された場合はDQを優先
    if (p1w === p2w && dqLoser && (dqLoser === p1Id || dqLoser === p2Id)) {
      return dqLoser === p1Id ? p2Id : p1Id;
    }

    if (p1Forfeit && p2Forfeit) return null;
    if (p1Forfeit) return p2Id;
    if (p2Forfeit) return p1Id;

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

  const buildScoreAuth = (match: Match, forfeitPlayerIds: string[], dqLoser: string | null) => {
    const hasByeForfeit = forfeitPlayerIds.some((id) => {
      if (!id) return false;
      return !playerMap.has(id);
    });

    const resultAuthMode = tournament?.result_auth_mode ?? "none";
    const forfeitAuthMode = tournament?.forfeit_auth_mode ?? "target_player";
    const dqAuthMode = tournament?.dq_auth_mode ?? "admin";
    const requiresDqAuth = !!dqLoser && dqAuthMode !== "none";
    const requiresForfeitAuth = forfeitPlayerIds.length > 0 && !hasByeForfeit && forfeitAuthMode !== "none" && !requiresDqAuth;
    const requiresResultAuth = !dqLoser && forfeitPlayerIds.length === 0 && resultAuthMode !== "none";

    const getAdminConfirmer = (): ScannedCodeInfo | null => {
      const preferredAdminId =
        lastAuthenticatedAdminId && authenticatedAdminIds.includes(lastAuthenticatedAdminId)
          ? lastAuthenticatedAdminId
          : authenticatedAdminIds[0] ?? null;
      if (!preferredAdminId) return null;
      const admin = admins.find((a) => a.admin_id === preferredAdminId);
      if (!admin) return null;
      return {
        code: admin.admin_code,
        type: "admin",
        id: admin.admin_id,
        name: admin.name,
      };
    };

    const getParticipantConfirmer = (playerId: string): ScannedCodeInfo | null => {
      if (!authenticatedPlayerIds.includes(playerId)) return null;
      const participant = participants.find((p) => p.player_id === playerId);
      if (!participant) return null;
      return {
        code: participant.player_code,
        type: "participant",
        id: participant.player_id,
        name: participant.name,
      };
    };

    const adminConfirmer = getAdminConfirmer();
    const p1Confirmer = match.player1_id ? getParticipantConfirmer(match.player1_id) : null;
    const p2Confirmer = match.player2_id ? getParticipantConfirmer(match.player2_id) : null;

    let resultConfirmer: ScannedCodeInfo | null = null;
    let forfeitConfirmer: ScannedCodeInfo | null = null;
    let dqConfirmerLocal: ScannedCodeInfo | null = null;

    if (requiresForfeitAuth) {
      const targetParticipantConfirmer = forfeitPlayerIds
        .map((id) => getParticipantConfirmer(id))
        .find((c): c is ScannedCodeInfo => !!c);
      if (forfeitAuthMode === "admin") {
        if (!adminConfirmer) {
          throw new Error("棄権確定には認証済み管理者が必要です");
        }
        forfeitConfirmer = adminConfirmer;
      } else if (forfeitAuthMode === "auth") {
        forfeitConfirmer = adminConfirmer ?? p1Confirmer ?? p2Confirmer ?? null;
        if (!forfeitConfirmer) {
          throw new Error("棄権確定には認証が必要です");
        }
      } else {
        // target_player / legacy admin_or_participant
        forfeitConfirmer = adminConfirmer ?? targetParticipantConfirmer ?? null;
        if (!forfeitConfirmer) {
          throw new Error("棄権確定には対象プレイヤーまたは管理者の認証が必要です");
        }
      }
    }

    if (requiresDqAuth) {
      const targetParticipantConfirmer = dqLoser ? getParticipantConfirmer(dqLoser) : null;
      if (dqAuthMode === "admin") {
        if (!adminConfirmer) {
          throw new Error("DQ確定には認証済み管理者が必要です");
        }
        dqConfirmerLocal = adminConfirmer;
      } else if (dqAuthMode === "auth") {
        dqConfirmerLocal = adminConfirmer ?? p1Confirmer ?? p2Confirmer ?? null;
        if (!dqConfirmerLocal) {
          throw new Error("DQ確定には認証が必要です");
        }
      } else {
        // target_player / legacy admin_or_participant
        dqConfirmerLocal = adminConfirmer ?? targetParticipantConfirmer ?? null;
        if (!dqConfirmerLocal) {
          throw new Error("DQ確定には対象プレイヤーまたは管理者の認証が必要です");
        }
      }
    }

    if (requiresResultAuth) {
      const winnerId = computeNewWinner(match, p1Wins, p2Wins, [], null);
      const loserId =
        winnerId === match.player1_id
          ? match.player2_id
          : winnerId === match.player2_id
          ? match.player1_id
          : null;
      const winnerConfirmer = winnerId ? getParticipantConfirmer(winnerId) : null;
      const loserConfirmer = loserId ? getParticipantConfirmer(loserId) : null;

      // 管理者認証はどの方式でも常に許可
      if (adminConfirmer) {
        resultConfirmer = adminConfirmer;
      } else if (resultAuthMode === "admin") {
        if (!adminConfirmer) {
          throw new Error("結果確定には認証済み管理者が必要です");
        }
        resultConfirmer = adminConfirmer;
      } else if (resultAuthMode === "both_players") {
        if (!p1Confirmer || !p2Confirmer) {
          throw new Error("結果確定には両プレイヤーの認証が必要です");
        }
        resultConfirmer = winnerConfirmer ?? p1Confirmer;
      } else if (resultAuthMode === "winner") {
        if (!winnerId) {
          throw new Error("勝者認証を使うには勝者が確定する入力が必要です");
        }
        if (!winnerConfirmer) {
          throw new Error("結果確定には勝者側プレイヤーの認証が必要です");
        }
        resultConfirmer = winnerConfirmer;
      } else if (resultAuthMode === "loser") {
        if (!loserId) {
          throw new Error("敗者認証を使うには勝敗が確定する入力が必要です");
        }
        if (!loserConfirmer) {
          throw new Error("結果確定には敗者側プレイヤーの認証が必要です");
        }
        resultConfirmer = loserConfirmer;
      } else if (resultAuthMode === "match_participant") {
        resultConfirmer = p1Confirmer ?? p2Confirmer ?? null;
        if (!resultConfirmer) {
          throw new Error("結果確定には対戦プレイヤーの認証が必要です");
        }
      } else {
        // backward compatibility for existing setting values
        resultConfirmer = adminConfirmer ?? p1Confirmer ?? p2Confirmer ?? null;
        if (!resultConfirmer) {
          throw new Error("結果確定には試合参加者または管理者の認証が必要です");
        }
      }
    }

    return {
      resultConfirmer,
      forfeitConfirmer,
      dqConfirmer: dqConfirmerLocal,
    };
  };

  const handleAuthenticateCode = (rawCode: string): void => {
    if (!selectedMatch) return;
    authenticateCodeForMatch(selectedMatch, rawCode);
  };

  const handleAuthenticateClick = () => {
    const code = confirmAuthCode.trim();
    if (!code) {
      alert("確認コードを入力してください");
      return;
    }
    handleAuthenticateCode(code);
  };

  const handleToggleParticipantAuth = (playerId: string | null) => {
    if (!playerId || playerId.startsWith("dummy-")) return;
    if (!authenticatedPlayerIds.includes(playerId)) return;
    const ok = confirm(`「${getParticipantDisplayName(playerId)}」の認証を解除しますか？`);
    if (!ok) return;
    setAuthenticatedPlayerIds((prev) => prev.filter((id) => id !== playerId));
  };

  const handleToggleAdminAuth = () => {
    if (!lastAuthenticatedAdminId) return;
    const ok = confirm(`管理者「${getAdminDisplayName(lastAuthenticatedAdminId)}」の認証を解除しますか？`);
    if (!ok) return;
    setAuthenticatedAdminIds([]);
    setLastAuthenticatedAdminId(null);
  };

  const handleSave = async () => {
    if (!selectedMatch || !tournament || isReadOnly) return;
    if (!validateRequiredMatchCharacters(selectedMatch)) return;
    const rawForfeitPlayerIds = [
      p1Forfeit ? selectedMatch.player1_id : null,
      p2Forfeit ? selectedMatch.player2_id : null,
    ].filter((id): id is string => !!id);
    const hasDqLoss = !!dqLoserId;
    const forfeitPlayerIds = hasDqLoss ? [] : rawForfeitPlayerIds;
    const forfeitAllMatchPlayerIds = hasDqLoss || !forfeitAllMatches ? [] : rawForfeitPlayerIds;
    const appliedDqLoserId = hasDqLoss ? dqLoserId : null;
    let scoreAuth: { resultConfirmer?: ScannedCodeInfo | null; forfeitConfirmer?: ScannedCodeInfo | null; dqConfirmer?: ScannedCodeInfo | null };
    try {
      scoreAuth = buildScoreAuth(selectedMatch, forfeitPlayerIds, appliedDqLoserId);
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
      const newWinner = computeNewWinner(selectedMatch, p1Wins, p2Wins, forfeitPlayerIds, appliedDqLoserId);
      if (newWinner !== selectedMatch.winner_id) {
        setPendingEdit({ match: selectedMatch, p1Wins, p2Wins, forfeitPlayerIds, dqLoserId: appliedDqLoserId });
        setConfirmingEdit(true);
        return;
      }
      setSaving(true);
      try {
        await correctScore(
          selectedMatch,
          p1Wins,
          p2Wins,
          forfeitPlayerIds,
          appliedDqLoserId,
          p1CharName.trim() || null,
          p2CharName.trim() || null,
          scoreAuth,
          forfeitAllMatchPlayerIds
        );
        closeModal();
      } finally {
        setSaving(false);
      }
      return;
    }

    if (isByeMatch) {
      setPendingBye({ match: selectedMatch, p1Wins, p2Wins, forfeitPlayerIds, dqLoserId: appliedDqLoserId });
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
        forfeitPlayerIds,
        appliedDqLoserId,
        p1CharName.trim() || null,
        p2CharName.trim() || null,
        scoreAuth,
        forfeitAllMatchPlayerIds
      );
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmCorrect = async () => {
    if (!pendingEdit) return;
    if (!validateRequiredMatchCharacters(pendingEdit.match)) return;
    let scoreAuth: { resultConfirmer?: ScannedCodeInfo | null; forfeitConfirmer?: ScannedCodeInfo | null; dqConfirmer?: ScannedCodeInfo | null };
    try {
      scoreAuth = buildScoreAuth(pendingEdit.match, pendingEdit.forfeitPlayerIds, pendingEdit.dqLoserId);
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
        pendingEdit.forfeitPlayerIds,
        pendingEdit.dqLoserId,
        p1CharName.trim() || null,
        p2CharName.trim() || null,
        scoreAuth,
        forfeitAllMatches ? pendingEdit.forfeitPlayerIds : []
      );
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmBye = async () => {
    if (!pendingBye) return;
    if (!validateRequiredMatchCharacters(pendingBye.match)) return;
    let scoreAuth: { resultConfirmer?: ScannedCodeInfo | null; forfeitConfirmer?: ScannedCodeInfo | null; dqConfirmer?: ScannedCodeInfo | null };
    try {
      scoreAuth = buildScoreAuth(pendingBye.match, pendingBye.forfeitPlayerIds, pendingBye.dqLoserId);
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
        pendingBye.forfeitPlayerIds,
        pendingBye.dqLoserId,
        p1CharName.trim() || null,
        p2CharName.trim() || null,
        scoreAuth,
        forfeitAllMatches ? pendingBye.forfeitPlayerIds : []
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
              forfeit_player_id: null,
            }
          : prev
      );
      setP1Wins(0);
      setP2Wins(0);
      setP1CharName("");
      setP2CharName("");
      setP1Forfeit(false);
      setP2Forfeit(false);
      setDqLoserId(null);
      setConfirmAuthCode("");
      setAuthenticatedPlayerIds([]);
      setAuthenticatedAdminIds([]);
      setLastAuthenticatedAdminId(null);
    } finally {
      setSaving(false);
    }
  };

  const applyDq = (loserSlot: 1 | 2) => {
    if (!selectedMatch) return;

    const loserId = loserSlot === 1 ? selectedMatch.player1_id : selectedMatch.player2_id;
    if (!loserId || loserId.startsWith("dummy-")) {
      alert("プレイヤーがいないスロットにはDQを適用できません");
      return;
    }

    // 既に同じプレイヤーがDQ設定済みの場合はキャンセル（トグル）
    if (dqLoserId === loserId) {
      setDqLoserId(null);
      return;
    }

    const winnerId = loserSlot === 1 ? selectedMatch.player2_id : selectedMatch.player1_id;
    const loserName = loserId ? getParticipantDisplayName(loserId) : "不明";
    const winnerName = winnerId ? getParticipantDisplayName(winnerId) : "不明";
    const ok = confirm(
      `「${loserName}」をDQにしますか？\n\n勝者: ${winnerName}\n敗者: ${loserName}\n\nスコアが同点の場合のみDQを適用します。\nスコア入力済みの場合は入力スコアを優先します。`
    );
    if (!ok) return;

    // DQは通常結果入力/棄権とは排他的に扱う
    setP1Forfeit(false);
    setP2Forfeit(false);
    setForfeitAllMatches(false);
    setForfeitDialogSlot(null);
    setDqLoserId(loserId ?? null);
  };

  const applyForfeitWithDialog = (slot: 1 | 2) => {
    if (!selectedMatch) return;
    const current = slot === 1 ? p1Forfeit : p2Forfeit;
    if (current) {
      if (slot === 1) setP1Forfeit(false);
      else setP2Forfeit(false);
      if ((slot === 1 && !p2Forfeit) || (slot === 2 && !p1Forfeit)) {
        setForfeitAllMatches(false);
      }
      return;
    }

    setDqLoserId(null);
    setForfeitAllMatches(false);
    setForfeitDialogSlot(slot);
  };

  const confirmForfeitSelection = () => {
    if (!forfeitDialogSlot) return;
    if (forfeitDialogSlot === 1) setP1Forfeit(true);
    if (forfeitDialogSlot === 2) setP2Forfeit(true);
    setForfeitDialogSlot(null);
  };

  const closeModal = () => {
    setSelectedMatch(null);
    setConfirmingEdit(false);
    setPendingEdit(null);
    setConfirmingBye(false);
    setPendingBye(null);
    setDqLoserId(null);
    setForfeitAllMatches(false);
    setForfeitDialogSlot(null);
    setConfirmAuthCode("");
    setAuthenticatedPlayerIds([]);
    setAuthenticatedAdminIds([]);
    setLastAuthenticatedAdminId(null);
    setP1CharName("");
    setP2CharName("");
    setSideRandomizeNotice(null);
    setSideRandomizeNoticeVisible(false);
  };

  const getPlayerName = (id: string | null, hasIncomingFeeder = false) => {
    if (!id) return hasIncomingFeeder ? "TBD" : "BYE";
    const player = playerMap.get(id);
    if (!player) return id.slice(0, 8) + "…";
    return `${player.player_id_4}: ${player.name}`;
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

  const openCallMessageForPlayer = (playerId: string | null) => {
    if (!playerId || playerId.startsWith("dummy-")) return;
    const selected = selectedMatch;
    if (!selected) return;
    const matchCardId = buildMatchCardIdFromMatch(selected);
    const matchSlot = selected.player1_id === playerId ? 1 : selected.player2_id === playerId ? 2 : null;
    if (!matchSlot) return;
    setDetailPlayerId(null);
    closeModal();
    navigate(
      `/notification?compose=call&playerId=${encodeURIComponent(playerId)}&matchCardId=${encodeURIComponent(
        matchCardId
      )}&matchSlot=${matchSlot}`
    );
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => openCallMessageForPlayer(target.player_id)}
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
              >
                呼び出し
              </button>
              <button
                onClick={() => setDetailPlayerId(null)}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                閉じる
              </button>
            </div>
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

    const sourcePlayerName = getParticipantDisplayName(sourcePlayerId);
    const targetPlayerName = getParticipantDisplayName(targetPlayerId);
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
      handleAuthenticateCode(extractedCode);
    }
    setScanTarget(null);
  };

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
    <div className="h-full flex flex-col overflow-hidden p-6">
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
                navigate("/tournament/setup");
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

      {unreadReceivedCount > 0 && showBracketMessageNotice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-sm text-red-700 font-medium">
            📢 新着メッセージ {unreadReceivedCount} 件
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/notification")}
              className="px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:bg-red-700"
            >
              メッセージを開く
            </button>
            <button
              type="button"
              onClick={() => setShowBracketMessageNotice(false)}
              className="px-3 py-1.5 text-xs rounded bg-white border border-red-200 text-red-700 hover:bg-red-100"
            >
              閉じる
            </button>
          </div>
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
                  type="password"
                  autoComplete="off"
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
                    ? getParticipantDisplayName(m.player1_id)
                    : incoming.slot1
                    ? "TBD"
                    : "BYE";
                  const p2Name = m.player2_id
                    ? getParticipantDisplayName(m.player2_id)
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
                  const p1Authenticated = !!selectedMatch.player1_id && authenticatedPlayerIds.includes(selectedMatch.player1_id);
                  const p2Authenticated = !!selectedMatch.player2_id && authenticatedPlayerIds.includes(selectedMatch.player2_id);
                  const adminAuthenticated = authenticatedAdminIds.length > 0;
                  const p1IsTbd = !selectedMatch.player1_id && incoming.slot1;
                  const p2IsTbd = !selectedMatch.player2_id && incoming.slot2;
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
                      <span
                        onClick={() => handleToggleParticipantAuth(selectedMatch.player1_id)}
                        title={p1Authenticated ? "クリックで認証解除" : undefined}
                        className={`shrink-0 inline-flex items-center justify-center w-10 rounded border px-1 py-0.5 text-[10px] font-bold ${p1SideLabel === "-" ? "bg-gray-100 text-gray-500" : p1SideLabel === "1P" ? "bg-blue-100 text-blue-700" : "bg-indigo-100 text-indigo-700"} ${selectedMatch.player1_id && !selectedMatch.player1_id.startsWith("dummy-") ? (p1Authenticated ? "border-emerald-500 cursor-pointer" : "border-rose-400") : "border-gray-300"}`}
                      >
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
                          onClick={() => applyDq(1)}
                          disabled={!selectedMatch.player1_id || selectedMatch.player1_id.startsWith("dummy-")}
                          className={`text-xs px-2 py-1 rounded disabled:opacity-40 ${dqLoserId === selectedMatch.player1_id ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200"}`}
                        >DQ</button>
                        <button
                          onClick={() => applyForfeitWithDialog(1)}
                          disabled={p1IsTbd}
                          className={`text-xs px-2 py-1 rounded disabled:opacity-40 ${p1Forfeit ? "bg-red-500 text-white" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
                        >棄権</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        onClick={() => handleToggleParticipantAuth(selectedMatch.player2_id)}
                        title={p2Authenticated ? "クリックで認証解除" : undefined}
                        className={`shrink-0 inline-flex items-center justify-center w-10 rounded border px-1 py-0.5 text-[10px] font-bold ${p2SideLabel === "-" ? "bg-gray-100 text-gray-500" : p2SideLabel === "2P" ? "bg-indigo-100 text-indigo-700" : "bg-blue-100 text-blue-700"} ${selectedMatch.player2_id && !selectedMatch.player2_id.startsWith("dummy-") ? (p2Authenticated ? "border-emerald-500 cursor-pointer" : "border-rose-400") : "border-gray-300"}`}
                      >
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
                          onClick={() => applyDq(2)}
                          disabled={!selectedMatch.player2_id || selectedMatch.player2_id.startsWith("dummy-")}
                          className={`text-xs px-2 py-1 rounded disabled:opacity-40 ${dqLoserId === selectedMatch.player2_id ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200"}`}
                        >DQ</button>
                        <button
                          onClick={() => applyForfeitWithDialog(2)}
                          disabled={p2IsTbd}
                          className={`text-xs px-2 py-1 rounded disabled:opacity-40 ${p2Forfeit ? "bg-red-500 text-white" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
                        >棄権</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        onClick={handleToggleAdminAuth}
                        title={adminAuthenticated ? "クリックで認証解除" : undefined}
                        className={`shrink-0 inline-flex items-center justify-center w-10 rounded border px-1 py-0.5 text-[10px] font-bold ${adminAuthenticated ? "border-emerald-500 bg-emerald-100 text-emerald-700 cursor-pointer" : "border-rose-400 bg-rose-100 text-rose-600"}`}
                      >
                        管理者
                      </span>
                      <span className="flex-1 min-w-0 text-sm font-medium text-gray-700 truncate">
                        {getAdminDisplayName(lastAuthenticatedAdminId)}
                      </span>
                      <div className="w-[184px]" />
                    </div>
                    {(p1Forfeit || p2Forfeit) && !dqLoserId && (
                      <div className="rounded border border-red-200 bg-red-50 p-2">
                        <p className="text-xs text-red-700">
                          棄権内容: {forfeitAllMatches ? "全試合を棄権" : "この試合を棄権"}
                        </p>
                      </div>
                    )}
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
                        {dqLoserId
                                          ? tournament.dq_auth_mode === "admin"
                                            ? "確認コード (DQあり: 管理者)"
                                            : tournament.dq_auth_mode === "auth"
                                            ? "確認コード (DQあり: 認証)"
                                            : "確認コード (DQあり: 当該プレイヤー)"
                          : p1Forfeit || p2Forfeit
                                          ? tournament.forfeit_auth_mode === "admin"
                                            ? `確認コード (${forfeitAllMatches ? "全試合棄権" : "棄権"}: 管理者)`
                                            : tournament.forfeit_auth_mode === "auth"
                                            ? `確認コード (${forfeitAllMatches ? "全試合棄権" : "棄権"}: 認証)`
                                            : `確認コード (${forfeitAllMatches ? "全試合棄権" : "棄権"}: 当該プレイヤー)`
                            : tournament.result_auth_mode === "none"
                          ? "確認コード (通常結果入力: 認証不要)"
                          : tournament.result_auth_mode === "admin"
                          ? "確認コード (通常結果入力: 管理者)"
                            : tournament.result_auth_mode === "both_players"
                            ? "確認コード (通常結果入力: 両プレイヤー)"
                            : tournament.result_auth_mode === "winner"
                            ? "確認コード (通常結果入力: 勝者)"
                            : tournament.result_auth_mode === "loser"
                            ? "確認コード (通常結果入力: 敗者)"
                            : tournament.result_auth_mode === "match_participant"
                            ? "確認コード (通常結果入力: 対戦プレイヤー)"
                            : "確認コード (通常結果入力: 試合参加者 or 管理者)"}
                      </label>
                      <div className="flex gap-1">
                        <input
                          type="password"
                          autoComplete="off"
                          value={confirmAuthCode}
                          onChange={(e) => setConfirmAuthCode(e.target.value)}
                          placeholder="コード入力または2次元バーコードスキャン"
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs font-mono"
                        />
                        <button
                          onClick={handleAuthenticateClick}
                          className="px-2 py-1 text-xs rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        >
                          認証
                        </button>
                        <button
                          onClick={() => setScanTarget("auth")}
                          className="px-2 py-1 text-xs rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                        >
                          カメラ
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      コード入力後に「認証」を押すと認証状態が有効になります。結果入力・棄権・DQは排他的に扱われ、同時には実行されません。BYEのみの確定では認証は不要です。
                    </p>
                  </div>
                )}

                <div className="mb-4 space-y-2 rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xs font-semibold text-gray-700">認証履歴</p>
                  {(() => {
                    const logs = matchActionLogs
                      .filter((log) => log.match_id === selectedMatch.id)
                      .sort((a, b) => b.created_at.localeCompare(a.created_at));

                    if (logs.length === 0) {
                      return <p className="text-xs text-gray-500">履歴なし（認証なし）</p>;
                    }

                    return (
                      <div className="max-h-44 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
                        {logs.map((log) => {
                          const targetName = log.target_player_id
                            ? getParticipantDisplayName(log.target_player_id)
                            : "-";
                          const formattedTime = formatDateTime(log.created_at);
                          return (
                            <div key={log.id} className="px-2 py-2 text-xs text-gray-700">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-gray-800">{getActionTypeLabel(log.action_type)}</span>
                                <span className="text-[11px] text-gray-500">{formattedTime}</span>
                              </div>
                              <p className="text-[11px] text-gray-600 mt-0.5">
                                対象: {targetName}
                              </p>
                              <p className="text-[11px] text-gray-600 mt-0.5">
                                認証: {getConfirmerLabel(log.confirmed_by_type, log.confirmed_by_name)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

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

                {forfeitDialogSlot && (
                  <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
                    <div className="w-full max-w-md rounded-xl bg-white border border-gray-200 shadow-xl p-4">
                      <h4 className="text-sm font-bold text-gray-800 mb-2">棄権の確認</h4>
                      <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                        <input
                          type="checkbox"
                          checked={forfeitAllMatches}
                          onChange={(e) => setForfeitAllMatches(e.target.checked)}
                        />
                        全試合の棄権
                      </label>
                      <p className="text-xs text-gray-600 mb-4">
                        {forfeitAllMatches
                          ? "この試合を含む以降の試合をすべて棄権します。"
                          : "この試合のみ棄権します。"}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={confirmForfeitSelection}
                          className="flex-1 px-3 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700"
                        >
                          棄権する
                        </button>
                        <button
                          onClick={() => {
                            setForfeitDialogSlot(null);
                            setForfeitAllMatches(false);
                          }}
                          className="flex-1 px-3 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  </div>
                )}
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

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">

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

      {renderParticipantDetailDialog()}
    </div>
  );
}





