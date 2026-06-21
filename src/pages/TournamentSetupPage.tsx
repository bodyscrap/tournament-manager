import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import type {
  CharacterInputMode,
  MatchActionAuthMode,
  TournamentCharacterSelectionConfig,
  TournamentDefaultPlayerSide,
} from "../lib/types";
import { computePlayerRankings } from "../lib/ranking";
import { buildDuplicateName, parseLinesToUniqueList } from "../lib/characterListUtils";
import { normalizeEventCode, normalizeTournamentCode } from "../lib/playerCode";

type CharacterCategoryDraft = {
  categoryName: string;
  listName: string;
  selectedListId: string;
  listText: string;
  minSelect: number;
  maxSelect: number;
  forbidDuplicateItem: boolean;
};

function createCategoryDraft(index: number): CharacterCategoryDraft {
  return {
    categoryName: `カテゴリ${index}`,
    listName: "",
    selectedListId: "",
    listText: "",
    minSelect: 1,
    maxSelect: 1,
    forbidDuplicateItem: false,
  };
}

function ensureCategoryDraftCount(
  drafts: CharacterCategoryDraft[],
  count: number
): CharacterCategoryDraft[] {
  const next = [...drafts];
  while (next.length < count) {
    next.push(createCategoryDraft(next.length + 1));
  }
  return next.slice(0, count);
}

function buildSelectionConfigFromDrafts(
  drafts: CharacterCategoryDraft[],
  totalMinInput: number,
  totalMaxInput: number
): { config: TournamentCharacterSelectionConfig; flattened: string[] } {
  const categories = drafts.map((draft, i) => {
    const list = parseLinesToUniqueList(draft.listText);
    const maxUpper = Math.max(1, list.length || 1);
    const maxSelect = Math.min(maxUpper, Math.max(1, Math.floor(draft.maxSelect || 1)));
    const minSelect = Math.min(maxSelect, Math.max(0, Math.floor(draft.minSelect || 0)));
    return {
      category_id: `category_${i + 1}`,
      category_name: draft.categoryName.trim() || `カテゴリ${i + 1}`,
      list_name: draft.listName.trim() || null,
      list,
      min_select: minSelect,
      max_select: maxSelect,
      forbid_duplicate_item: draft.forbidDuplicateItem,
    };
  });

  const sumMin = categories.reduce((sum, c) => sum + c.min_select, 0);
  const sumMax = categories.reduce((sum, c) => sum + c.max_select, 0);
  const totalMax = Math.min(sumMax, Math.max(1, Math.floor(totalMaxInput || sumMax || 1)));
  const totalMin = Math.min(totalMax, Math.max(0, Math.floor(totalMinInput || sumMin || 0)));
  const flattened = [...new Set(categories.flatMap((c) => c.list))];

  return {
    config: {
      categories,
      total_min_select: totalMin,
      total_max_select: totalMax,
    },
    flattened,
  };
}

function getDefaultPlayerSideLabel(value: TournamentDefaultPlayerSide): string {
  switch (value) {
    case "upper_2p":
      return "トーナメント表で上が2P";
    case "random":
      return "ランダム";
    default:
      return "トーナメント表で上が1P(デフォルト)";
  }
}

function getAuthModeLabel(value: MatchActionAuthMode): string {
  switch (value) {
    case "none":
      return "認証なし";
    case "admin":
      return "管理者";
    case "match_participant":
      return "対戦プレイヤー";
    case "both_players":
      return "両プレイヤー";
    case "winner":
      return "勝者";
    case "loser":
      return "敗者";
    default:
      return "管理者or本人";
  }
}

export function TournamentSetupPage() {
  const {
    tournament,
    participants,
    matches,
    players,
    characters,
    characterLists,
    addCharacterList,
    isReadOnly,
    createNew,
    removeTournament,
    addParticipant,
    addParticipantAndAssign,
    editParticipantName,
    setParticipantCharacter,
    setParticipantSelectedCharacters,
    removeParticipant,
    swapSeeds,
    randomizeSeeds,
    generateBracket,
    updateTournamentSettings,
    finalizeTournament,
    trees,
  } = useAppContext();

  const navigate = useNavigate();
  const location = useLocation();

  // --- 新規作成フォーム用 ---
  const [name, setName] = useState("");
  const [createEventCode, setCreateEventCode] = useState("00");
  const [createTournamentCode, setCreateTournamentCode] = useState("0000");
  const [type, setType] = useState<"single_elimination" | "double_elimination">("double_elimination");
  const [maxP, setMaxP] = useState(8);
  const [gfReset, setGfReset] = useState(true);
  const [createDefaultPlayerSide, setCreateDefaultPlayerSide] = useState<TournamentDefaultPlayerSide>("upper_1p");
  const [createResultAuthMode, setCreateResultAuthMode] = useState<MatchActionAuthMode>("none");
  const [createDqAuthMode, setCreateDqAuthMode] = useState<MatchActionAuthMode>("admin_or_participant");
  const [createForcedLossAuthMode, setCreateForcedLossAuthMode] = useState<MatchActionAuthMode>("admin");
  const [createCharacterMode, setCreateCharacterMode] = useState<CharacterInputMode>("free_input");
  const [createCategoryCount, setCreateCategoryCount] = useState(1);
  const [createCategoryDrafts, setCreateCategoryDrafts] = useState<CharacterCategoryDraft[]>([
    createCategoryDraft(1),
  ]);
  const [createTotalMinSelect, setCreateTotalMinSelect] = useState(1);
  const [createTotalMaxSelect, setCreateTotalMaxSelect] = useState(1);
  const [creating, setCreating] = useState(false);
  const [creatingUsedCharacterList, setCreatingUsedCharacterList] = useState(false);

  // --- 設定編集 (setup フェーズ) ---
  const [editSettings, setEditSettings] = useState(false);
  const [editEventCode, setEditEventCode] = useState("00");
  const [editTournamentCode, setEditTournamentCode] = useState("0000");
  const [editType, setEditType] = useState<"single_elimination" | "double_elimination">("single_elimination");
  const [editMaxP, setEditMaxP] = useState(256);
  const [editGfReset, setEditGfReset] = useState(true);
  const [editDefaultPlayerSide, setEditDefaultPlayerSide] = useState<TournamentDefaultPlayerSide>("upper_1p");
  const [editResultAuthMode, setEditResultAuthMode] = useState<MatchActionAuthMode>("none");
  const [editDqAuthMode, setEditDqAuthMode] = useState<MatchActionAuthMode>("admin_or_participant");
  const [editForcedLossAuthMode, setEditForcedLossAuthMode] = useState<MatchActionAuthMode>("admin");
  const [editCharacterMode, setEditCharacterMode] = useState<CharacterInputMode>("free_input");
  const [editCategoryCount, setEditCategoryCount] = useState(1);
  const [editCategoryDrafts, setEditCategoryDrafts] = useState<CharacterCategoryDraft[]>([
    createCategoryDraft(1),
  ]);
  const [editTotalMinSelect, setEditTotalMinSelect] = useState(1);
  const [editTotalMaxSelect, setEditTotalMaxSelect] = useState(1);
  const [savingSettings, setSavingSettings] = useState(false);

  // --- 参加者追加フォーム ---
  const [addName, setAddName] = useState("");
  const [addCharacter, setAddCharacter] = useState("");
  const [addSelectedCharacters, setAddSelectedCharacters] = useState<Record<string, string[]>>({});
  const [adding, setAdding] = useState(false);
  const [participantCharacterDrafts, setParticipantCharacterDrafts] = useState<Record<string, string>>({});

  // --- その他 ---
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
  const [detailParticipantId, setDetailParticipantId] = useState<string | null>(null);
  const [seedRandomizeNotice, setSeedRandomizeNotice] = useState<"changed" | "unchanged" | null>(null);
  const [seedRandomizeNoticeVisible, setSeedRandomizeNoticeVisible] = useState(false);

  const participantIds = new Set(participants.map((p) => p.player_id));
  const sortedParticipants = [...participants].sort((a, b) => a.seed - b.seed);
  const rankings = useMemo(
    () => computePlayerRankings(participants, matches),
    [participants, matches]
  );
  const characterUsageStatsByCategory = useMemo(() => {
    if (!tournament || tournament.character_input_mode === "free_input") return [];
    if (participants.length === 0) return [];
    const categories = tournament.character_selection_config?.categories;

    if (!categories || categories.length === 0) {
      const usageByCharacter = new Map<string, number>();
      for (const p of participants) {
        const name = p.character_name?.trim();
        if (!name) continue;
        usageByCharacter.set(name, (usageByCharacter.get(name) ?? 0) + 1);
      }

      const rows = [...usageByCharacter.entries()]
        .map(([name, playerCount]) => ({
          name,
          playerCount,
          usageRate: (playerCount / participants.length) * 100,
        }))
        .sort((a, b) => {
          if (b.playerCount !== a.playerCount) return b.playerCount - a.playerCount;
          return a.name.localeCompare(b.name, "ja");
        });

      return [{
        categoryId: "legacy_single_select",
        categoryName: "使用キャラ",
        rows,
      }];
    }

    return categories.map((cat) => {
      const usageByCharacter = new Map<string, number>();

      for (const p of participants) {
        const uniqueSelection = new Set<string>();
        const selected = p.selected_characters?.[cat.category_id] ?? [];

        for (const rawName of selected) {
          const name = rawName.trim();
          if (name) uniqueSelection.add(name);
        }

        for (const name of uniqueSelection) {
          usageByCharacter.set(name, (usageByCharacter.get(name) ?? 0) + 1);
        }
      }

      const rows = [...usageByCharacter.entries()]
        .map(([name, playerCount]) => ({
          name,
          playerCount,
          usageRate: (playerCount / participants.length) * 100,
        }))
        .sort((a, b) => {
          if (b.playerCount !== a.playerCount) return b.playerCount - a.playerCount;
          return a.name.localeCompare(b.name, "ja");
        });

      return {
        categoryId: cat.category_id,
        categoryName: cat.category_name,
        rows,
      };
    });
  }, [tournament, participants]);
  const maxCharacterUsageRate = useMemo(() => {
    let maxRate = 0;
    for (const category of characterUsageStatsByCategory) {
      for (const row of category.rows) {
        if (row.usageRate > maxRate) maxRate = row.usageRate;
      }
    }
    return maxRate;
  }, [characterUsageStatsByCategory]);
  const defaultTreeId = trees[0]?.id ?? "";

  useEffect(() => {
    if (!seedRandomizeNotice) return;
    setSeedRandomizeNoticeVisible(true);
    const fadeTimer = window.setTimeout(() => setSeedRandomizeNoticeVisible(false), 1200);
    const clearTimer = window.setTimeout(() => setSeedRandomizeNotice(null), 1800);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [seedRandomizeNotice]);

  const generateRandomTournamentCode = () => {
    const value = Math.floor(Math.random() * 10000);
    return value.toString().padStart(4, "0");
  };

  const generateRandomEventCode = () => {
    const value = Math.floor(Math.random() * 100);
    return value.toString().padStart(2, "0");
  };

  const collectUsedCharacters = (): string[] => {
    const unique = new Set<string>();

    for (const p of participants) {
      const name = p.character_name?.trim();
      if (name) unique.add(name);
    }
    for (const m of matches) {
      const p1 = m.player1_character_name?.trim();
      const p2 = m.player2_character_name?.trim();
      if (p1) unique.add(p1);
      if (p2) unique.add(p2);
    }

    return [...unique].sort((a, b) => a.localeCompare(b, "ja"));
  };

  const toSlotValues = (selected: string[] | undefined, maxSelect: number): string[] => {
    const slots = Array.from({ length: Math.max(1, maxSelect) }, () => "");
    const src = selected ?? [];
    for (let i = 0; i < Math.min(slots.length, src.length); i++) {
      slots[i] = src[i] ?? "";
    }
    return slots;
  };

  const fromSlotValues = (slots: string[]): string[] =>
    slots.map((v) => v.trim()).filter((v) => v.length > 0);

  const countSelections = (selected: Record<string, string[]>): number =>
    Object.values(selected).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);

  const validateSelectionByConfig = (
    selected: Record<string, string[]>,
    config: TournamentCharacterSelectionConfig
  ): string | null => {
    const totalCount = countSelections(selected);
    if (totalCount < config.total_min_select || totalCount > config.total_max_select) {
      return `合計${config.total_min_select}～${config.total_max_select}個選択してください（現在: ${totalCount}個）`;
    }
    for (const cat of config.categories) {
      const items = selected[cat.category_id] ?? [];
      const count = items.length;
      if (count < cat.min_select || count > cat.max_select) {
        return `${cat.category_name}: ${cat.min_select}～${cat.max_select}個選択してください（現在: ${count}個）`;
      }
      if (cat.forbid_duplicate_item) {
        const uniqueCount = new Set(items).size;
        if (uniqueCount !== items.length) {
          return `${cat.category_name}: 同一項目禁止が有効なため、同じ項目を重複選択できません`;
        }
      }
    }
    return null;
  };

  const resetParticipantForm = () => {
    setAddName("");
    setAddCharacter("");
    setAddSelectedCharacters({});
    setEditingParticipantId(null);
  };

  const startParticipantEdit = (playerId: string) => {
    const target = participants.find((p) => p.player_id === playerId);
    if (!target) return;
    setEditingParticipantId(playerId);
    setAddName(target.name ?? "");
    setAddCharacter(target.character_name ?? "");
    setAddSelectedCharacters(target.selected_characters ?? {});
  };

  useEffect(() => {
    if (!tournament) return;
    const params = new URLSearchParams(location.search);
    const participantId = params.get("editParticipantId");
    if (!participantId) return;
    const target = participants.find((p) => p.player_id === participantId);
    if (!target) return;
    startParticipantEdit(participantId);
    navigate("/tournament/setup", { replace: true });
  }, [location.search, navigate, participants, tournament]);

  // ===== ハンドラ =====
  const handleCreate = async () => {
    const tournamentName =
      name.trim() ||
      `大会 ${new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" })}`;
    const tournamentCode = normalizeTournamentCode(createTournamentCode);
    const createDrafts = ensureCategoryDraftCount(createCategoryDrafts, createCategoryCount);
    const { config, flattened } = buildSelectionConfigFromDrafts(
      createDrafts,
      createTotalMinSelect,
      createTotalMaxSelect
    );
    const characterList = createCharacterMode === "list_selection" ? flattened : [];
    const characterListName = createCharacterMode === "list_selection"
      ? (config.categories[0]?.list_name || "カスタムリスト")
      : null;
    const selectionConfig = createCharacterMode === "list_selection" ? config : null;
    setCreating(true);
    try {
      await createNew(
        createEventCode,
        tournamentCode,
        type,
        maxP,
        gfReset,
        tournamentName,
        createCharacterMode,
        characterListName,
        characterList,
        selectionConfig,
        createDefaultPlayerSide,
        createResultAuthMode,
        createDqAuthMode,
        createForcedLossAuthMode
      );
    } finally {
      setCreating(false);
    }
  };

  const handleOpenSettings = () => {
    if (!tournament) return;
    setEditType(tournament.type);
    setEditEventCode(tournament.event_code ?? "00");
    setEditTournamentCode(tournament.tournament_code ?? "0000");
    setEditMaxP(tournament.max_participants);
    setEditGfReset(tournament.grand_final_reset);
    setEditDefaultPlayerSide(tournament.default_player_side ?? "upper_1p");
    setEditResultAuthMode(tournament.result_auth_mode ?? "none");
    setEditDqAuthMode(tournament.dq_auth_mode ?? "admin_or_participant");
    setEditForcedLossAuthMode(tournament.forced_loss_auth_mode ?? "admin");
    setEditCharacterMode(tournament.character_input_mode);
    const config = tournament.character_selection_config;
    const categories = config?.categories?.length
      ? config.categories.slice(0, 3)
      : [
          {
            category_name: "カテゴリ1",
            list_name: tournament.character_list_name,
            list: tournament.character_list,
            min_select: 1,
            max_select: 1,
            forbid_duplicate_item: false,
          },
        ];
    setEditCategoryCount(Math.min(3, Math.max(1, categories.length)));
    setEditCategoryDrafts(
      ensureCategoryDraftCount(
        categories.map((cat, i) => ({
          categoryName: cat.category_name?.trim() || `カテゴリ${i + 1}`,
          listName: cat.list_name ?? "",
          selectedListId: "",
          listText: (cat.list ?? []).join("\n"),
          minSelect: cat.min_select ?? 1,
          maxSelect: cat.max_select ?? 1,
          forbidDuplicateItem: !!cat.forbid_duplicate_item,
        })),
        Math.min(3, Math.max(1, categories.length))
      )
    );
    setEditTotalMinSelect(config?.total_min_select ?? 1);
    setEditTotalMaxSelect(config?.total_max_select ?? Math.max(1, tournament.character_list.length));
    setEditSettings(true);
  };

  const handleSaveSettings = async () => {
    const editDrafts = ensureCategoryDraftCount(editCategoryDrafts, editCategoryCount);
    const { config, flattened } = buildSelectionConfigFromDrafts(
      editDrafts,
      editTotalMinSelect,
      editTotalMaxSelect
    );
    const characterList = editCharacterMode === "list_selection" ? flattened : [];
    const tournamentCode = normalizeTournamentCode(editTournamentCode);
    const characterListName = editCharacterMode === "list_selection"
      ? (config.categories[0]?.list_name || "カスタムリスト")
      : null;
    const selectionConfig = editCharacterMode === "list_selection" ? config : null;
    setSavingSettings(true);
    try {
      await updateTournamentSettings(
        editEventCode,
        tournamentCode,
        editType,
        editMaxP,
        editGfReset,
        editCharacterMode,
        characterListName,
        characterList,
        selectionConfig,
        editDefaultPlayerSide,
        editResultAuthMode,
        editDqAuthMode,
        editForcedLossAuthMode
      );
      setEditSettings(false);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddParticipant = async () => {
    if (!tournament) return;
    if (!addName.trim()) return;
    const editingTarget = editingParticipantId
      ? participants.find((p) => p.player_id === editingParticipantId) ?? null
      : null;

    // For list_selection with category config: validate per-category and total selections
    if (tournament.character_input_mode === "list_selection" && tournament.character_selection_config) {
      const config = tournament.character_selection_config;
      const validationError = validateSelectionByConfig(addSelectedCharacters, config);
      if (validationError) {
        alert(validationError);
        return;
      }

      setAdding(true);
      try {
        // Character name is set to first selected if any, for match setup fallback
        const firstChar = Object.values(addSelectedCharacters).flat()[0] ?? null;
        if (editingTarget) {
          if (editingTarget.name !== addName.trim()) {
            await editParticipantName(editingTarget.player_id, addName.trim());
          }
          if ((editingTarget.character_name ?? null) !== firstChar) {
            await setParticipantCharacter(editingTarget.player_id, firstChar);
          }
          await setParticipantSelectedCharacters(editingTarget.player_id, addSelectedCharacters);
        } else {
          if (tournament.status === "in_progress") {
            if (!defaultTreeId) throw new Error("追加先のブラケットツリーが見つかりません");
            await addParticipantAndAssign(
              addName.trim(),
              firstChar,
              "winners",
              defaultTreeId,
              addSelectedCharacters
            );
          } else {
            await addParticipant(addName.trim(), firstChar, {}, addSelectedCharacters);
          }
        }
        resetParticipantForm();
      } catch (err) {
        alert(err instanceof Error ? err.message : "参加者の追加に失敗しました");
      } finally {
        setAdding(false);
      }
    } else if (tournament.character_input_mode === "list_selection" && !addCharacter.trim()) {
      // Legacy single-select mode
      alert("この大会では使用キャラの設定が必須です");
    } else {
      // Free input mode
      setAdding(true);
      try {
        const nextCharacter = addCharacter.trim() || null;
        if (editingTarget) {
          if (editingTarget.name !== addName.trim()) {
            await editParticipantName(editingTarget.player_id, addName.trim());
          }
          if ((editingTarget.character_name ?? null) !== nextCharacter) {
            await setParticipantCharacter(editingTarget.player_id, nextCharacter);
          }
          if (Object.keys(editingTarget.selected_characters ?? {}).length > 0) {
            await setParticipantSelectedCharacters(editingTarget.player_id, {});
          }
        } else {
          if (tournament.status === "in_progress") {
            if (!defaultTreeId) throw new Error("追加先のブラケットツリーが見つかりません");
            await addParticipantAndAssign(
              addName.trim(),
              nextCharacter,
              "winners",
              defaultTreeId
            );
          } else {
            await addParticipant(addName.trim(), nextCharacter, {});
          }
        }
        resetParticipantForm();
      } catch (err) {
        alert(err instanceof Error ? err.message : "参加者の追加に失敗しました");
      } finally {
        setAdding(false);
      }
    }
  };

  const handleAddFromRoster = async (playerId: string) => {
    if (!tournament) return;
    const p = players.find((pl) => pl.id === playerId);
    if (!p) return;
    const isListMode = tournament.character_input_mode === "list_selection";
    const charInList = p.character_name && tournament.character_list.includes(p.character_name);
    if (isListMode && !charInList) {
      alert(`「${p.name}」はこの大会の使用可能キャラリストに含まれる使用キャラが未設定のため追加できません`);
      return;
    }
    const character = isListMode ? (charInList ? p.character_name : null) : p.character_name;
    try {
      if (tournament.status === "in_progress") {
        if (!defaultTreeId) throw new Error("追加先のブラケットツリーが見つかりません");
        await addParticipantAndAssign(p.name, character, "winners", defaultTreeId, {}, p.id);
      } else {
        await addParticipant(p.name, character, p.attributes, {}, p.id);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "名簿からの参加者追加に失敗しました");
    }
  };

  const handleGenerate = async () => {
    if (participants.length < 2) { alert("参加者が2名以上必要です"); return; }
    if (!confirm("ブラケットを生成します。既存のブラケットは削除されます。よろしいですか？")) return;
    setGenerating(true);
    try { await generateBracket(); } finally { setGenerating(false); }
  };

  const handleSwap = (player_id: string) => {
    if (!swapFrom) {
      setSwapFrom(player_id);
    } else if (swapFrom === player_id) {
      setSwapFrom(null);
    } else {
      swapSeeds(swapFrom, player_id);
      setSwapFrom(null);
    }
  };

  const handleFinalize = async () => {
    if (!confirm("結果を確定します。確定後はこの大会を編集できなくなります。よろしいですか？")) return;
    setFinalizing(true);
    try { await finalizeTournament(); } finally { setFinalizing(false); }
  };

  const handleRandomizeSeeds = async () => {
    const changed = await randomizeSeeds();
    setSeedRandomizeNotice(changed ? "changed" : "unchanged");
    setSwapFrom(null);
  };

  const handleCreateUsedCharacterList = async () => {
    if (
      !tournament ||
      tournament.status !== "finalized" ||
      tournament.character_input_mode !== "free_input"
    ) {
      return;
    }

    const usedCharacters = collectUsedCharacters();
    if (usedCharacters.length === 0) {
      alert("この大会で使用されたキャラクターが見つかりませんでした。");
      return;
    }

    const baseName = `${tournament.name} 使用キャラ`;
    const listName = buildDuplicateName(baseName, characterLists.map((list) => list.name));

    setCreatingUsedCharacterList(true);
    try {
      await addCharacterList(listName, usedCharacters);
      alert(`キャラクターリスト「${listName}」を作成しました。`);
    } catch {
      alert("キャラクターリストの作成に失敗しました。時間をおいて再試行してください。");
    } finally {
      setCreatingUsedCharacterList(false);
    }
  };

  // ===== 新規作成画面 =====
  if (!tournament) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">新規大会作成</h2>
        <div className="bg-white rounded-xl shadow p-6 border border-gray-200 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">イベントコード (2桁)</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={createEventCode}
                onChange={(e) => setCreateEventCode(e.target.value.replace(/\D/g, "").slice(0, 2))}
                placeholder="例: 01"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setCreateEventCode(generateRandomEventCode())}
                className="shrink-0 px-3 py-2 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg"
              >
                ランダム決定
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">先頭ゼロを保持して 2 桁で扱います。</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">大会コード (4桁)</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={createTournamentCode}
                onChange={(e) => setCreateTournamentCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="例: 0046"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setCreateTournamentCode(generateRandomTournamentCode())}
                className="shrink-0 px-3 py-2 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg"
              >
                ランダム決定
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">先頭ゼロを保持して 4 桁で扱います。</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">大会名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 第1回定期大会（省略時は日付）"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">トーナメント形式</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "single_elimination" | "double_elimination")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="single_elimination">シングルエリミネーション</option>
              <option value="double_elimination">ダブルエリミネーション</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">参加上限</label>
            <input
              type="number"
              min={2}
              max={256}
              value={maxP}
              onChange={(e) => setMaxP(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {type === "double_elimination" && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="gfReset" checked={gfReset} onChange={(e) => setGfReset(e.target.checked)} className="w-4 h-4 text-blue-600" />
              <label htmlFor="gfReset" className="text-sm text-gray-700">グランドファイナルリセットを有効にする</label>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">デフォルトプレイヤーサイド</label>
            <select
              value={createDefaultPlayerSide}
              onChange={(e) => setCreateDefaultPlayerSide(e.target.value as TournamentDefaultPlayerSide)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="upper_1p">トーナメント表で上が1P(デフォルト)</option>
              <option value="upper_2p">トーナメント表で上が2P</option>
              <option value="random">ランダム</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">通常結果入力時の認証</label>
            <select
              value={createResultAuthMode}
              onChange={(e) => setCreateResultAuthMode(e.target.value as MatchActionAuthMode)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">認証なし</option>
              <option value="admin">管理者</option>
              <option value="match_participant">対戦プレイヤー</option>
              <option value="both_players">両プレイヤー</option>
              <option value="winner">勝者</option>
              <option value="loser">敗者</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">DQ時の認証</label>
            <select
              value={createDqAuthMode}
              onChange={(e) => setCreateDqAuthMode(e.target.value as MatchActionAuthMode)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">認証なし</option>
              <option value="admin">管理者</option>
              <option value="admin_or_participant">管理者or本人</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">強制敗北時の認証</label>
            <select
              value={createForcedLossAuthMode}
              onChange={(e) => setCreateForcedLossAuthMode(e.target.value as MatchActionAuthMode)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">認証なし</option>
              <option value="admin">管理者</option>
              <option value="admin_or_participant">管理者or本人</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">使用キャラ設定</label>
            <select
              value={createCharacterMode}
              onChange={(e) => setCreateCharacterMode(e.target.value as CharacterInputMode)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="free_input">自由入力</option>
              <option value="list_selection">リストから選択</option>
            </select>
          </div>
          {createCharacterMode === "list_selection" && (
            <div>
              <div className="mb-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ数 (1〜3)</label>
                <select
                  value={createCategoryCount}
                  onChange={(e) => {
                    const count = Math.min(3, Math.max(1, Number(e.target.value) || 1));
                    setCreateCategoryCount(count);
                    setCreateCategoryDrafts((prev) => ensureCategoryDraftCount(prev, count));
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={1}>1カテゴリ</option>
                  <option value={2}>2カテゴリ</option>
                  <option value={3}>3カテゴリ</option>
                </select>
              </div>

              <div className="space-y-3 mb-3">
                {ensureCategoryDraftCount(createCategoryDrafts, createCategoryCount)
                  .slice(0, createCategoryCount)
                  .map((draft, idx) => (
                    <div key={idx} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                      <p className="text-xs font-semibold text-gray-500 mb-2">カテゴリ {idx + 1}</p>
                      <input
                        value={draft.categoryName}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCreateCategoryDrafts((prev) => {
                            const next = ensureCategoryDraftCount(prev, createCategoryCount);
                            next[idx] = { ...next[idx], categoryName: value };
                            return next;
                          });
                        }}
                        placeholder="カテゴリ名"
                        className="w-full mb-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                      <select
                        value={draft.selectedListId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setCreateCategoryDrafts((prev) => {
                            const next = ensureCategoryDraftCount(prev, createCategoryCount);
                            const selected = characterLists.find((list) => list.id === id);
                            next[idx] = {
                              ...next[idx],
                              selectedListId: id,
                              listName: selected?.name ?? next[idx].listName,
                              listText: selected ? selected.characters.join("\n") : next[idx].listText,
                            };
                            return next;
                          });
                        }}
                        className="w-full mb-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">-- 手入力 / カスタム --</option>
                        {characterLists.map((list) => (
                          <option key={list.id} value={list.id}>{list.name}</option>
                        ))}
                      </select>
                      <input
                        value={draft.listName}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCreateCategoryDrafts((prev) => {
                            const next = ensureCategoryDraftCount(prev, createCategoryCount);
                            next[idx] = { ...next[idx], listName: value };
                            return next;
                          });
                        }}
                        placeholder="カテゴリに割り当てるリスト名"
                        className="w-full mb-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                      <textarea
                        value={draft.listText}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCreateCategoryDrafts((prev) => {
                            const next = ensureCategoryDraftCount(prev, createCategoryCount);
                            next[idx] = { ...next[idx], listText: value };
                            return next;
                          });
                        }}
                        rows={4}
                        placeholder="1行に1キャラクター名"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                      <p className="text-[11px] text-gray-500 mt-2 mb-1">
                        このカテゴリで1人が選べる数の範囲を設定します（例: 最小1 / 最大2）。
                      </p>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-600 shrink-0">最小値</span>
                          <input
                            type="number"
                            min={0}
                            value={draft.minSelect}
                            onChange={(e) => {
                              const value = Number(e.target.value) || 0;
                              setCreateCategoryDrafts((prev) => {
                                const next = ensureCategoryDraftCount(prev, createCategoryCount);
                                next[idx] = { ...next[idx], minSelect: value };
                                return next;
                              });
                            }}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="カテゴリ最小選択数"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-600 shrink-0">最大値</span>
                          <input
                            type="number"
                            min={1}
                            value={draft.maxSelect}
                            onChange={(e) => {
                              const value = Number(e.target.value) || 1;
                              setCreateCategoryDrafts((prev) => {
                                const next = ensureCategoryDraftCount(prev, createCategoryCount);
                                next[idx] = { ...next[idx], maxSelect: value };
                                return next;
                              });
                            }}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="カテゴリ最大選択数"
                          />
                        </div>
                      </div>
                      <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={draft.forbidDuplicateItem}
                          onChange={(e) => {
                            const value = e.target.checked;
                            setCreateCategoryDrafts((prev) => {
                              const next = ensureCategoryDraftCount(prev, createCategoryCount);
                              next[idx] = { ...next[idx], forbidDuplicateItem: value };
                              return next;
                            });
                          }}
                          className="w-4 h-4 text-blue-600"
                        />
                        同一項目禁止
                      </label>
                    </div>
                  ))}
              </div>

              <p className="text-[11px] text-gray-500 mb-1">
                すべてのカテゴリを合計して、1人が選べる総数の範囲を設定します。
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 shrink-0">最小値</span>
                  <input
                    type="number"
                    min={0}
                    value={createTotalMinSelect}
                    onChange={(e) => setCreateTotalMinSelect(Number(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="全カテゴリ合計 最小選択数"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 shrink-0">最大値</span>
                  <input
                    type="number"
                    min={1}
                    value={createTotalMaxSelect}
                    onChange={(e) => setCreateTotalMaxSelect(Number(e.target.value) || 1)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="全カテゴリ合計 最大選択数"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">自由入力モード時は単一カテゴリ・単一項目選択(1固定)として扱います。</p>
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {creating ? "作成中..." : "大会を作成"}
          </button>
        </div>
      </div>
    );
  }

  const statusLabel: Record<string, string> = {
    setup: "設定中",
    in_progress: "進行中",
    completed: "完了 (未確定)",
    finalized: "結果確定済",
  };

  const rosterNotAdded = players.filter((p) => !participantIds.has(p.id));
  const isCharacterListMode = tournament.character_input_mode === "list_selection";
  const tournamentCharacterOptions = tournament.character_list;
  const selectionCategoryCount = tournament.character_selection_config?.categories.length ?? 1;
  const selectionTotalMin = tournament.character_selection_config?.total_min_select ?? 1;
  const selectionTotalMax = tournament.character_selection_config?.total_max_select ?? 1;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Read-only banner */}
      {isReadOnly && (
        <div className="mb-5 p-4 bg-gray-100 border border-gray-300 rounded-xl flex items-center gap-3">
          <span className="text-xl">🔒</span>
          <div>
            <p className="font-semibold text-gray-700">結果確定済み — 閲覧のみ</p>
            <p className="text-xs text-gray-500 mt-0.5">この大会は結果が確定されているため編集できません（削除は可能です）</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">{tournament.name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {tournament.type === "single_elimination" ? "シングルエリミネーション" : "ダブルエリミネーション"}{" "}
            / 上限 {tournament.max_participants} 名 /{" "}
            {tournament.character_input_mode === "list_selection" ? "キャラ: リスト選択" : "キャラ: 自由入力"} /{" "}
            {tournament.character_input_mode === "list_selection"
              ? `カテゴリ: ${selectionCategoryCount} / 合計選択: ${selectionTotalMin}-${selectionTotalMax} / 代表リスト: ${tournament.character_list_name ?? "未設定"}`
              : "リスト: なし"} /{" "}
            <span className={`font-medium ${
              tournament.status === "setup" ? "text-yellow-600"
              : tournament.status === "in_progress" ? "text-green-600"
              : tournament.status === "completed" ? "text-blue-600"
              : "text-gray-400"
            }`}>{statusLabel[tournament.status]}</span>
          </p>
          <p className="text-sm text-gray-500 mt-1">
            デフォルトプレイヤーサイド: {getDefaultPlayerSideLabel(tournament.default_player_side ?? "upper_1p")}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            通常結果入力時の認証: {getAuthModeLabel(tournament.result_auth_mode ?? "none")}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            DQ時の認証: {getAuthModeLabel(tournament.dq_auth_mode ?? "admin_or_participant")}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            強制敗北時の認証: {getAuthModeLabel(tournament.forced_loss_auth_mode ?? "admin")}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            イベントコード: <span className="font-mono">{normalizeEventCode(tournament.event_code ?? "00")}</span>
          </p>
          <p className="text-sm text-gray-500 mt-1">
            大会コード: <span className="font-mono">{normalizeTournamentCode(tournament.tournament_code ?? "0000")}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/tournament/player-cards")}
            className="text-xs px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg"
          >
            🪪 参加者カード
          </button>
          <button
            onClick={() => navigate("/tournament/admins")}
            className="text-xs px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg"
          >
            🛡️ 管理者カード
          </button>
          {tournament.status === "setup" && !isReadOnly && (
            <button onClick={handleOpenSettings} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">
              ⚙️ 設定を編集
            </button>
          )}
          {tournament.status === "completed" && (
            <button onClick={handleFinalize} disabled={finalizing} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {finalizing ? "処理中..." : "✅ 結果を確定する"}
            </button>
          )}
          {tournament.status === "finalized" && tournament.character_input_mode === "free_input" && (
            <>
              <button
                onClick={handleCreateUsedCharacterList}
                disabled={creatingUsedCharacterList}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {creatingUsedCharacterList ? "作成中..." : "使用キャラからリスト作成"}
              </button>
              <button onClick={() => navigate("/tournament/bracket")} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium">
                🏆 ブラケットを見る
              </button>
            </>
          )}
          <button
            onClick={() => { if (confirm("大会データをすべて削除しますか？")) removeTournament(); }}
            className="text-xs px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
          >
            削除
          </button>
        </div>
      </div>

      {/* Settings edit modal (setup phase only) */}
      {editSettings && (
        <div className="mb-4 bg-white rounded-xl shadow border border-blue-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-4">大会設定の編集</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">イベントコード (2桁)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  value={editEventCode}
                  onChange={(e) => setEditEventCode(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  placeholder="例: 01"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setEditEventCode(generateRandomEventCode())}
                  className="shrink-0 px-3 py-2 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg"
                >
                  ランダム
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">大会コード (4桁)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={editTournamentCode}
                  onChange={(e) => setEditTournamentCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setEditTournamentCode(generateRandomTournamentCode())}
                  className="shrink-0 px-3 py-2 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg"
                >
                  ランダム決定
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">トーナメント形式</label>
              <select
                value={editType}
                onChange={(e) => setEditType(e.target.value as "single_elimination" | "double_elimination")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="single_elimination">シングルエリミネーション</option>
                <option value="double_elimination">ダブルエリミネーション</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">参加上限</label>
              <input
                type="number" min={2} max={256}
                value={editMaxP}
                onChange={(e) => setEditMaxP(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {editType === "double_elimination" && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="editGfReset" checked={editGfReset} onChange={(e) => setEditGfReset(e.target.checked)} className="w-4 h-4 text-blue-600" />
                <label htmlFor="editGfReset" className="text-sm text-gray-700">グランドファイナルリセットを有効にする</label>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">デフォルトプレイヤーサイド</label>
              <select
                value={editDefaultPlayerSide}
                onChange={(e) => setEditDefaultPlayerSide(e.target.value as TournamentDefaultPlayerSide)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="upper_1p">トーナメント表で上が1P(デフォルト)</option>
                <option value="upper_2p">トーナメント表で上が2P</option>
                <option value="random">ランダム</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">通常結果入力時の認証</label>
              <select
                value={editResultAuthMode}
                onChange={(e) => setEditResultAuthMode(e.target.value as MatchActionAuthMode)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="none">認証なし</option>
                <option value="admin">管理者</option>
                <option value="match_participant">対戦プレイヤー</option>
                <option value="both_players">両プレイヤー</option>
                <option value="winner">勝者</option>
                <option value="loser">敗者</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">DQ時の認証</label>
              <select
                value={editDqAuthMode}
                onChange={(e) => setEditDqAuthMode(e.target.value as MatchActionAuthMode)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="none">認証なし</option>
                <option value="admin">管理者</option>
                <option value="admin_or_participant">管理者or本人</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">強制敗北時の認証</label>
              <select
                value={editForcedLossAuthMode}
                onChange={(e) => setEditForcedLossAuthMode(e.target.value as MatchActionAuthMode)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="none">認証なし</option>
                <option value="admin">管理者</option>
                <option value="admin_or_participant">管理者or本人</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">使用キャラ設定</label>
              <select
                value={editCharacterMode}
                onChange={(e) => setEditCharacterMode(e.target.value as CharacterInputMode)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="free_input">自由入力</option>
                <option value="list_selection">リストから選択</option>
              </select>
            </div>
            {editCharacterMode === "list_selection" && (
              <div>
                <div className="mb-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ数 (1〜3)</label>
                  <select
                    value={editCategoryCount}
                    onChange={(e) => {
                      const count = Math.min(3, Math.max(1, Number(e.target.value) || 1));
                      setEditCategoryCount(count);
                      setEditCategoryDrafts((prev) => ensureCategoryDraftCount(prev, count));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={1}>1カテゴリ</option>
                    <option value={2}>2カテゴリ</option>
                    <option value={3}>3カテゴリ</option>
                  </select>
                </div>

                <div className="space-y-3 mb-3">
                  {ensureCategoryDraftCount(editCategoryDrafts, editCategoryCount)
                    .slice(0, editCategoryCount)
                    .map((draft, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <p className="text-xs font-semibold text-gray-500 mb-2">カテゴリ {idx + 1}</p>
                        <input
                          value={draft.categoryName}
                          onChange={(e) => {
                            const value = e.target.value;
                            setEditCategoryDrafts((prev) => {
                              const next = ensureCategoryDraftCount(prev, editCategoryCount);
                              next[idx] = { ...next[idx], categoryName: value };
                              return next;
                            });
                          }}
                          placeholder="カテゴリ名"
                          className="w-full mb-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                        <select
                          value={draft.selectedListId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setEditCategoryDrafts((prev) => {
                              const next = ensureCategoryDraftCount(prev, editCategoryCount);
                              const selected = characterLists.find((list) => list.id === id);
                              next[idx] = {
                                ...next[idx],
                                selectedListId: id,
                                listName: selected?.name ?? next[idx].listName,
                                listText: selected ? selected.characters.join("\n") : next[idx].listText,
                              };
                              return next;
                            });
                          }}
                          className="w-full mb-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        >
                          <option value="">-- 手入力 / カスタム --</option>
                          {characterLists.map((list) => (
                            <option key={list.id} value={list.id}>{list.name}</option>
                          ))}
                        </select>
                        <input
                          value={draft.listName}
                          onChange={(e) => {
                            const value = e.target.value;
                            setEditCategoryDrafts((prev) => {
                              const next = ensureCategoryDraftCount(prev, editCategoryCount);
                              next[idx] = { ...next[idx], listName: value };
                              return next;
                            });
                          }}
                          placeholder="カテゴリに割り当てるリスト名"
                          className="w-full mb-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                        <textarea
                          value={draft.listText}
                          onChange={(e) => {
                            const value = e.target.value;
                            setEditCategoryDrafts((prev) => {
                              const next = ensureCategoryDraftCount(prev, editCategoryCount);
                              next[idx] = { ...next[idx], listText: value };
                              return next;
                            });
                          }}
                          rows={4}
                          placeholder="1行に1キャラクター名"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                        <p className="text-[11px] text-gray-500 mt-2 mb-1">
                          このカテゴリで1人が選べる数の範囲を設定します（例: 最小1 / 最大2）。
                        </p>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 shrink-0">最小値</span>
                            <input
                              type="number"
                              min={0}
                              value={draft.minSelect}
                              onChange={(e) => {
                                const value = Number(e.target.value) || 0;
                                setEditCategoryDrafts((prev) => {
                                  const next = ensureCategoryDraftCount(prev, editCategoryCount);
                                  next[idx] = { ...next[idx], minSelect: value };
                                  return next;
                                });
                              }}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                              placeholder="カテゴリ最小選択数"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 shrink-0">最大値</span>
                            <input
                              type="number"
                              min={1}
                              value={draft.maxSelect}
                              onChange={(e) => {
                                const value = Number(e.target.value) || 1;
                                setEditCategoryDrafts((prev) => {
                                  const next = ensureCategoryDraftCount(prev, editCategoryCount);
                                  next[idx] = { ...next[idx], maxSelect: value };
                                  return next;
                                });
                              }}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                              placeholder="カテゴリ最大選択数"
                            />
                          </div>
                        </div>
                        <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={draft.forbidDuplicateItem}
                            onChange={(e) => {
                              const value = e.target.checked;
                              setEditCategoryDrafts((prev) => {
                                const next = ensureCategoryDraftCount(prev, editCategoryCount);
                                next[idx] = { ...next[idx], forbidDuplicateItem: value };
                                return next;
                              });
                            }}
                            className="w-4 h-4 text-blue-600"
                          />
                          同一項目禁止
                        </label>
                      </div>
                    ))}
                </div>

                <p className="text-[11px] text-gray-500 mb-1">
                  すべてのカテゴリを合計して、1人が選べる総数の範囲を設定します。
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 shrink-0">最小値</span>
                    <input
                      type="number"
                      min={0}
                      value={editTotalMinSelect}
                      onChange={(e) => setEditTotalMinSelect(Number(e.target.value) || 0)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="全カテゴリ合計 最小選択数"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 shrink-0">最大値</span>
                    <input
                      type="number"
                      min={1}
                      value={editTotalMaxSelect}
                      onChange={(e) => setEditTotalMaxSelect(Number(e.target.value) || 1)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="全カテゴリ合計 最大選択数"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">大会で固定保存されるカテゴリ別キャラ設定です。元のマスターリスト変更は大会に影響しません。</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {savingSettings ? "保存中..." : "保存"}
              </button>
              <button onClick={() => setEditSettings(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Participant list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: current participants */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-700">参加者 ({participants.length} 名)</h3>
            {!isReadOnly && (
              <button onClick={handleRandomizeSeeds} className="text-xs px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 rounded">
                🔀 ランダム抽選
              </button>
            )}
          </div>

          {!isReadOnly && seedRandomizeNotice && (
            <p
              className={`text-[11px] mb-2 transition-opacity duration-700 ${
                seedRandomizeNoticeVisible ? "opacity-100" : "opacity-0"
              } ${seedRandomizeNotice === "changed" ? "text-emerald-700" : "text-amber-700"}`}
            >
              {seedRandomizeNotice === "changed"
                ? "ランダム抽選を実行しました（並び順変更あり）"
                : "ランダム抽選を実行しました（結果は変更なし）"}
            </p>
          )}

          {swapFrom && (
            <p className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded mb-2">
              シード交換中: {participants.find((p) => p.player_id === swapFrom)?.name} → 交換先を選択
            </p>
          )}

          {sortedParticipants.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">参加者を追加してください</p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {sortedParticipants.map((tp) => (
                <div
                  key={tp.player_id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                    isReadOnly ? "border border-transparent"
                    : swapFrom === tp.player_id ? "bg-blue-100 border border-blue-400"
                    : swapFrom ? "hover:bg-blue-50 cursor-pointer border border-transparent"
                    : "hover:bg-gray-50 border border-transparent"
                  }`}
                  onClick={() => !isReadOnly && handleSwap(tp.player_id)}
                >
                  <span className="w-6 text-center text-xs font-mono text-gray-400">{tp.seed}</span>
                  <span className="flex-1 font-medium text-gray-800">{tp.name}</span>
                  {isCharacterListMode && tournament.character_selection_config ? (
                    <span className="text-xs text-gray-400">キャラ設定あり</span>
                  ) : isCharacterListMode ? (
                    // 単一キャラ選択（従来の select）
                    <select
                      value={participantCharacterDrafts[tp.player_id] ?? (tp.character_name ?? "")}
                      disabled={isReadOnly}
                      onClick={(e) => e.stopPropagation()}
                      onChange={async (e) => {
                        const value = e.target.value.trim() || null;
                        if (!value) {
                          alert("この大会では使用キャラの設定が必須です");
                          setParticipantCharacterDrafts((prev) => ({
                            ...prev,
                            [tp.player_id]: tp.character_name ?? "",
                          }));
                          return;
                        }
                        setParticipantCharacterDrafts((prev) => ({
                          ...prev,
                          [tp.player_id]: e.target.value,
                        }));
                        if ((tp.character_name ?? null) === value) return;
                        try {
                          await setParticipantCharacter(tp.player_id, value);
                        } catch (err) {
                          alert(err instanceof Error ? err.message : "使用キャラの更新に失敗しました");
                          setParticipantCharacterDrafts((prev) => ({
                            ...prev,
                            [tp.player_id]: tp.character_name ?? "",
                          }));
                        }
                      }}
                      className="text-xs border border-gray-300 rounded px-2 py-0.5 bg-white disabled:opacity-50"
                    >
                      <option value="">キャラ未設定</option>
                      {tournamentCharacterOptions.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        value={participantCharacterDrafts[tp.player_id] ?? (tp.character_name ?? "")}
                        disabled={isReadOnly}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setParticipantCharacterDrafts((prev) => ({
                            ...prev,
                            [tp.player_id]: e.target.value,
                          }))
                        }
                        onBlur={async (e) => {
                          const value = e.target.value.trim() || null;
                          if ((tp.character_name ?? null) === value) return;
                          await setParticipantCharacter(tp.player_id, value);
                        }}
                        onKeyDown={async (e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const value = (e.currentTarget.value ?? "").trim() || null;
                          if ((tp.character_name ?? null) === value) return;
                          await setParticipantCharacter(tp.player_id, value);
                          e.currentTarget.blur();
                        }}
                        list={`character-options-${tp.player_id}`}
                        className="text-xs border border-gray-300 rounded px-2 py-0.5 bg-white disabled:opacity-50"
                        placeholder="キャラ未設定"
                      />
                      <datalist id={`character-options-${tp.player_id}`}>
                        {characters.map((c) => (
                          <option key={c.id} value={c.name} />
                        ))}
                      </datalist>
                    </>
                  )}
                  {isCharacterListMode && tournament.character_selection_config && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailParticipantId(tp.player_id);
                      }}
                      className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                    >
                      詳細
                    </button>
                  )}
                  {!isReadOnly && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startParticipantEdit(tp.player_id);
                        }}
                        className="text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-700 hover:bg-sky-200"
                      >
                        編集
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeParticipant(tp.player_id); }}
                        className="text-red-400 hover:text-red-600 text-xs ml-1"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-gray-100">
            {!isReadOnly && (
              <button
                onClick={handleGenerate}
                disabled={generating || participants.length < 2}
                className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {generating ? "生成中..." : "🏆 ブラケットを生成"}
              </button>
            )}
          </div>
        </div>

        {/* Right: add participants (hidden when read-only) */}
        {!isReadOnly && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4">
            {/* Direct entry form */}
            <div>
              <h3 className="font-semibold text-gray-700 mb-3">
                {editingParticipantId
                  ? `参加者No. ${participants.find((p) => p.player_id === editingParticipantId)?.seed ?? "-"} の変更`
                  : "参加者を追加"}
              </h3>
              {tournament.status === "in_progress" && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
                  大会進行中です。ここから追加した参加者は Winners Round1 に配置されます。
                </p>
              )}
              <div className="space-y-2">
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddParticipant()}
                  placeholder="名前 *"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {isCharacterListMode && tournament.character_selection_config ? (
                  /* カテゴリ別複選択 UI */
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-3">
                    <p className="text-xs text-gray-600">
                      各カテゴリは枠ごとに選択してください（同じ項目の重複選択可）。
                    </p>
                    <p className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">
                      トータル現在の選択: {countSelections(addSelectedCharacters)} / {tournament.character_selection_config.total_max_select} (最小 {tournament.character_selection_config.total_min_select})
                    </p>
                    {tournament.character_selection_config.categories.map((cat) => {
                      const slotValues = toSlotValues(addSelectedCharacters[cat.category_id], cat.max_select);
                      const selectedCount = fromSlotValues(slotValues).length;

                      return (
                        <div key={cat.category_id} className="border-b border-gray-200 pb-2">
                          <p className="text-xs font-semibold text-gray-600 mb-2">
                            {cat.category_name}
                            {cat.min_select > 0 && <span className="text-red-500"> *</span>}
                            <span className="text-gray-400 ml-1">
                              (現在の選択: {selectedCount} / {cat.max_select})
                            </span>
                          </p>

                          <div className="grid grid-cols-1 gap-1">
                            {slotValues.map((slotValue, slotIndex) => (
                              <select
                                key={`${cat.category_id}-slot-${slotIndex}`}
                                value={slotValue}
                                onChange={(e) => {
                                  const nextSlots = [...slotValues];
                                  if (
                                    cat.forbid_duplicate_item &&
                                    e.target.value &&
                                    nextSlots.some((v, i) => i !== slotIndex && v === e.target.value)
                                  ) {
                                    alert(`${cat.category_name}は同一項目禁止のため重複選択できません`);
                                    return;
                                  }
                                  nextSlots[slotIndex] = e.target.value;
                                  setAddSelectedCharacters((prev) => ({
                                    ...prev,
                                    [cat.category_id]: fromSlotValues(nextSlots),
                                  }));
                                }}
                                className="w-full border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">未選択</option>
                                {cat.list.map((itemName) => (
                                  <option key={`${cat.category_id}-${slotIndex}-${itemName}`} value={itemName}>
                                    {itemName}
                                  </option>
                                ))}
                              </select>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : isCharacterListMode ? (
                  <select
                    value={addCharacter}
                    onChange={(e) => setAddCharacter(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">使用キャラ未設定</option>
                    {tournamentCharacterOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      value={addCharacter}
                      onChange={(e) => setAddCharacter(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddParticipant()}
                      list="character-master-options-add-participant"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="使用キャラ（未設定可 / 候補から選択 or 自由入力）"
                    />
                    <datalist id="character-master-options-add-participant">
                      {characters.map((c) => (
                        <option key={c.id} value={c.name} />
                      ))}
                    </datalist>
                  </>
                )}
                <button
                  onClick={handleAddParticipant}
                  disabled={
                    adding ||
                    !addName.trim() ||
                    (!editingParticipantId && participants.length >= tournament.max_participants) ||
                    (isCharacterListMode && !tournament.character_selection_config && !addCharacter.trim())
                  }
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {adding ? (editingParticipantId ? "変更中..." : "追加中...") : (editingParticipantId ? "決定" : "＋ 追加")}
                </button>
                <button
                  onClick={resetParticipantForm}
                  disabled={adding}
                  className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  キャンセル
                </button>
                <p className="text-xs text-gray-400 text-center">
                  {participants.length} / {tournament.max_participants} 名
                </p>
              </div>
            </div>

            {/* Quick-add from global roster */}
            {rosterNotAdded.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">名簿から追加</h4>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {rosterNotAdded.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleAddFromRoster(p.id)}
                      disabled={
                        participants.length >= tournament.max_participants ||
                        (isCharacterListMode && !(p.character_name && tournamentCharacterOptions.includes(p.character_name)))
                      }
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-blue-50 text-left disabled:opacity-40"
                    >
                      <span className="text-blue-400 text-xs">＋</span>
                      <span className="flex-1 font-medium text-gray-800">{p.name}</span>
                      {p.character_name && <span className="text-xs text-gray-400">{p.character_name}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {(tournament.status === "completed" || tournament.status === "finalized") && rankings.length > 0 && (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-blue-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-700">🏅 最終順位</h3>
            <p className="text-xs text-gray-500">同レベル到達時は総得失ラウンド差で順位付け</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3">順位</th>
                  <th className="py-2 pr-3">選手</th>
                  <th className="py-2 pr-3">シード</th>
                  <th className="py-2 pr-3">到達レベル</th>
                  <th className="py-2 pr-3">得失R差</th>
                  <th className="py-2 pr-3">ラウンド</th>
                  <th className="py-2">マッチ</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((row) => (
                  <tr key={row.player_id} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 pr-3 font-semibold text-gray-800">{row.placement}</td>
                    <td className="py-2 pr-3 text-gray-800">{row.name}</td>
                    <td className="py-2 pr-3 text-gray-500">#{row.seed}</td>
                    <td className="py-2 pr-3 text-gray-600">{row.level_score}</td>
                    <td className={`py-2 pr-3 font-mono ${row.total_round_diff >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {row.total_round_diff >= 0 ? "+" : ""}
                      {row.total_round_diff}
                    </td>
                    <td className="py-2 pr-3 font-mono text-gray-600">
                      {row.total_round_wins}-{row.total_round_losses}
                    </td>
                    <td className="py-2 font-mono text-gray-600">
                      {row.match_wins}-{row.match_losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {tournament.character_input_mode !== "free_input" && (
            <div className="mt-5 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-gray-700">📊 キャラ使用率 statistics</h4>
                <p className="text-xs text-gray-500">同一プレイヤー内の重複選択は1回として集計</p>
              </div>

              {characterUsageStatsByCategory.every((category) => category.rows.length === 0) ? (
                <p className="text-sm text-gray-400">集計対象のキャラクター選択がありません。</p>
              ) : (
                <div className="space-y-4">
                  {characterUsageStatsByCategory.map((category) => (
                    <div key={category.categoryId} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">{category.categoryName}</h5>
                      {category.rows.length === 0 ? (
                        <p className="text-xs text-gray-400">このカテゴリの選択はありません。</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm table-fixed">
                            <colgroup>
                              <col className="w-[46%]" />
                              <col className="w-[18%]" />
                              <col className="w-[36%]" />
                            </colgroup>
                            <thead>
                              <tr className="text-left text-gray-500 border-b border-gray-200">
                                <th className="py-2 pr-3">キャラ</th>
                                <th className="py-2 pr-3 whitespace-nowrap">使用人数</th>
                                <th className="py-2">使用率</th>
                              </tr>
                            </thead>
                            <tbody>
                              {category.rows.map((row) => (
                                <tr key={`${category.categoryId}-${row.name}`} className="border-b border-gray-100 last:border-b-0">
                                  <td className="py-2 pr-3 text-gray-800">
                                    <span className="block truncate" title={row.name}>{row.name}</span>
                                  </td>
                                  <td className="py-2 pr-3 font-mono text-gray-700 whitespace-nowrap">{row.playerCount} 名</td>
                                  <td className="py-2">
                                    <div className="relative h-6 rounded bg-blue-50 border border-blue-100 overflow-hidden">
                                      <div
                                        className="absolute inset-y-0 left-0 bg-blue-400/70"
                                        style={{
                                          width: `${maxCharacterUsageRate > 0 ? (row.usageRate / maxCharacterUsageRate) * 100 : 0}%`,
                                        }}
                                      />
                                      <div className="relative z-10 h-full px-2 flex items-center justify-end font-mono text-gray-700">
                                        {row.usageRate.toFixed(1)}%
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-500 mt-2">
                分母は参加者総数 ({participants.length}名) です。複数キャラ選択により、使用率合計は100%にならない場合があります。
              </p>
            </div>
          )}
        </div>
      )}

      {detailParticipantId && tournament?.character_selection_config && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">キャラ選択詳細</h2>
            {(() => {
              const target = participants.find((p) => p.player_id === detailParticipantId);
              if (!target) {
                return <p className="text-sm text-gray-500">参加者情報が見つかりません。</p>;
              }
              const totalSelected = tournament.character_selection_config.categories.reduce(
                (sum, cat) => sum + (target.selected_characters?.[cat.category_id]?.length ?? 0),
                0
              );
              return (
                <>
                  <p className="text-sm text-gray-600 mb-2">
                    参加者No. {target.seed} / {target.name}
                  </p>
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
                            選択数: {selected.length} / {cat.max_select} (最小 {cat.min_select})
                          </p>
                          {selected.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {selected.map((name, i) => (
                                <span key={`${cat.category_id}-${i}-${name}`} className="text-xs bg-blue-100 text-blue-700 rounded px-2 py-1">
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
                </>
              );
            })()}
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setDetailParticipantId(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-sm"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

