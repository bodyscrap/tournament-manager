import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import type { MatchBracket } from "../lib/types";
import { computePlayerRankings } from "../lib/ranking";

export function TournamentSetupPage() {
  const {
    tournament,
    participants,
    matches,
    trees,
    players,
    isReadOnly,
    createNew,
    removeTournament,
    addParticipant,
    removeParticipant,
    swapSeeds,
    randomizeSeeds,
    generateBracket,
    updateTournamentSettings,
    finalizeTournament,
    addBracketTree,
    renameBracketTreeItem,
    removeBracketTree,
    addMidTournamentMatch,
  } = useAppContext();

  const navigate = useNavigate();

  // --- 新規作成フォーム用 ---
  const [name, setName] = useState("");
  const [type, setType] = useState<"single_elimination" | "double_elimination">("double_elimination");
  const [maxP, setMaxP] = useState(8);
  const [gfReset, setGfReset] = useState(true);
  const [creating, setCreating] = useState(false);

  // --- 設定編集 (setup フェーズ) ---
  const [editSettings, setEditSettings] = useState(false);
  const [editType, setEditType] = useState<"single_elimination" | "double_elimination">("single_elimination");
  const [editMaxP, setEditMaxP] = useState(256);
  const [editGfReset, setEditGfReset] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // --- 参加者追加フォーム ---
  const [addName, setAddName] = useState("");
  const [addCharacter, setAddCharacter] = useState("");
  const [adding, setAdding] = useState(false);

  // --- その他 ---
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // --- 大会中に試合を追加フォーム ---
  const [midP1, setMidP1] = useState("");
  const [midP2, setMidP2] = useState("");
  const [midRound, setMidRound] = useState(1);
  const [midBracket, setMidBracket] = useState<MatchBracket>("winners");
  const [addingMatch, setAddingMatch] = useState(false);

  // --- ツリー管理 ---
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [newTreeName, setNewTreeName] = useState("");
  const [creatingTree, setCreatingTree] = useState(false);
  const [editingTreeId, setEditingTreeId] = useState<string | null>(null);
  const [editingTreeName, setEditingTreeName] = useState("");

  const participantIds = new Set(participants.map((p) => p.player_id));
  const sortedParticipants = [...participants].sort((a, b) => a.seed - b.seed);
  const rankings = useMemo(
    () => computePlayerRankings(participants, matches),
    [participants, matches]
  );

  // ===== ハンドラ =====
  const handleCreate = async () => {
    const tournamentName =
      name.trim() ||
      `大会 ${new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" })}`;
    setCreating(true);
    try {
      await createNew(type, maxP, gfReset, tournamentName);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenSettings = () => {
    if (!tournament) return;
    setEditType(tournament.type);
    setEditMaxP(tournament.max_participants);
    setEditGfReset(tournament.grand_final_reset);
    setEditSettings(true);
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await updateTournamentSettings(editType, editMaxP, editGfReset);
      setEditSettings(false);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddParticipant = async () => {
    if (!addName.trim()) return;
    setAdding(true);
    try {
      await addParticipant(addName.trim(), addCharacter.trim() || null, {});
      setAddName("");
      setAddCharacter("");
    } finally {
      setAdding(false);
    }
  };

  const handleAddFromRoster = async (playerId: string) => {
    const p = players.find((pl) => pl.id === playerId);
    if (!p) return;
    await addParticipant(p.name, p.character_name, p.attributes, p.id);
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

  const handleCreateTree = async () => {
    const name = newTreeName.trim() || `追加ブラケット ${trees.length + 1}`;
    setCreatingTree(true);
    try {
      const id = await addBracketTree(name);
      setSelectedTreeId(id);
      setNewTreeName("");
    } finally {
      setCreatingTree(false);
    }
  };

  const handleAddMatch = async () => {
    if (!midP1 || !selectedTreeId) return;
    setAddingMatch(true);
    try {
      await addMidTournamentMatch(selectedTreeId, midRound, midBracket, midP1, midP2 || null);
      setMidP1("");
      setMidP2("");
    } finally {
      setAddingMatch(false);
    }
  };

  // ===== 新規作成画面 =====
  if (!tournament) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">新規大会作成</h2>
        <div className="bg-white rounded-xl shadow p-6 border border-gray-200 space-y-4">
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
            <span className={`font-medium ${
              tournament.status === "setup" ? "text-yellow-600"
              : tournament.status === "in_progress" ? "text-green-600"
              : tournament.status === "completed" ? "text-blue-600"
              : "text-gray-400"
            }`}>{statusLabel[tournament.status]}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          {tournament.status === "finalized" && (
            <button onClick={() => navigate("/tournament/bracket")} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium">
              🏆 ブラケットを見る
            </button>
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
              <button onClick={randomizeSeeds} className="text-xs px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 rounded">
                🔀 ランダム抽選
              </button>
            )}
          </div>

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
                  {tp.character_name && <span className="text-xs text-gray-400">{tp.character_name}</span>}
                  {!isReadOnly && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeParticipant(tp.player_id); }}
                      className="text-red-400 hover:text-red-600 text-xs ml-1"
                    >
                      ✕
                    </button>
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
              <h3 className="font-semibold text-gray-700 mb-3">参加者を追加</h3>
              {tournament.status === "in_progress" && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
                  大会進行中です。追加した参加者の試合は下の「試合を追加」から別途作成してください。
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
                <input
                  type="text"
                  value={addCharacter}
                  onChange={(e) => setAddCharacter(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddParticipant()}
                  placeholder="使用キャラ（省略可）"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddParticipant}
                  disabled={adding || !addName.trim() || participants.length >= tournament.max_participants}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {adding ? "追加中..." : "＋ 追加"}
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
                      disabled={participants.length >= tournament.max_participants}
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

      {/* Mid-tournament: tree management + add match */}
      {tournament.status === "in_progress" && !isReadOnly && (
        <div className="mt-6 space-y-4">
          {/* ブラケットツリー一覧 */}
          <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-5">
            <h3 className="font-semibold text-gray-700 mb-3">⚡ ブラケットツリー管理</h3>

            {trees.length === 0 && (
              <p className="text-xs text-gray-400 mb-3">ブラケットツリーがありません。</p>
            )}

            <div className="space-y-2 mb-4">
              {trees.map((tree) => {
                const treeMatchCount = matches.filter((m) => m.tree_id === tree.id).length;
                const isSelected = selectedTreeId === tree.id;
                const isEditing = editingTreeId === tree.id;
                return (
                  <div
                    key={tree.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      isSelected
                        ? "bg-amber-50 border-amber-400"
                        : "bg-gray-50 border-gray-200 hover:bg-amber-50"
                    }`}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingTreeName}
                        onChange={(e) => setEditingTreeName(e.target.value)}
                        onBlur={async () => {
                          if (editingTreeName.trim()) {
                            await renameBracketTreeItem(tree.id, editingTreeName.trim());
                          }
                          setEditingTreeId(null);
                        }}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            if (editingTreeName.trim()) {
                              await renameBracketTreeItem(tree.id, editingTreeName.trim());
                            }
                            setEditingTreeId(null);
                          } else if (e.key === "Escape") {
                            setEditingTreeId(null);
                          }
                        }}
                        className="flex-1 border border-amber-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                    ) : (
                      <button
                        className="flex-1 text-left font-medium text-gray-800"
                        onClick={() => setSelectedTreeId(isSelected ? null : tree.id)}
                      >
                        {tree.name}
                      </button>
                    )}
                    <span className="text-xs text-gray-400 shrink-0">{treeMatchCount} 試合</span>
                    <button
                      onClick={() => { setEditingTreeId(tree.id); setEditingTreeName(tree.name); }}
                      className="text-xs text-gray-400 hover:text-gray-600 px-1"
                      title="名前を変更"
                    >✏️</button>
                    <button
                      onClick={() => {
                        if (confirm(`「${tree.name}」を削除しますか？所属する試合はツリーから切り離されます。`)) {
                          removeBracketTree(tree.id);
                          if (selectedTreeId === tree.id) setSelectedTreeId(null);
                        }
                      }}
                      className="text-xs text-red-400 hover:text-red-600 px-1"
                      title="削除"
                    >✕</button>
                  </div>
                );
              })}
            </div>

            {/* 新しいツリーを作成 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTreeName}
                onChange={(e) => setNewTreeName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateTree()}
                placeholder={`追加ブラケット ${trees.length + 1}`}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <button
                onClick={handleCreateTree}
                disabled={creatingTree}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 shrink-0"
              >
                {creatingTree ? "作成中..." : "＋ ツリー作成"}
              </button>
            </div>
          </div>

          {/* 選択ツリーへ試合を追加 */}
          {selectedTreeId && (
            <div className="bg-white rounded-xl shadow-sm border border-blue-200 p-5">
              <h3 className="font-semibold text-gray-700 mb-1">
                試合を追加 — <span className="text-blue-600">{trees.find((t) => t.id === selectedTreeId)?.name}</span>
              </h3>
              <p className="text-xs text-gray-400 mb-4">このツリーに新しい試合を追加します。</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">プレイヤー 1 *</label>
                  <select
                    value={midP1}
                    onChange={(e) => setMidP1(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">-- 選択 --</option>
                    {sortedParticipants.map((tp) => (
                      <option key={tp.player_id} value={tp.player_id}>
                        {tp.name}{tp.character_name ? ` (${tp.character_name})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">プレイヤー 2（省略でBYE）</label>
                  <select
                    value={midP2}
                    onChange={(e) => setMidP2(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">-- なし (BYE) --</option>
                    {sortedParticipants
                      .filter((tp) => tp.player_id !== midP1)
                      .map((tp) => (
                        <option key={tp.player_id} value={tp.player_id}>
                          {tp.name}{tp.character_name ? ` (${tp.character_name})` : ""}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ラウンド</label>
                  <input
                    type="number"
                    min={1}
                    value={midRound}
                    onChange={(e) => setMidRound(Math.max(1, Number(e.target.value)))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ブラケット種別</label>
                  <select
                    value={midBracket}
                    onChange={(e) => setMidBracket(e.target.value as MatchBracket)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="winners">ウィナーズ</option>
                    <option value="losers">ルーザーズ</option>
                    <option value="grand_final">グランドファイナル</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleAddMatch}
                disabled={addingMatch || !midP1}
                className="mt-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {addingMatch ? "追加中..." : "＋ 試合を追加"}
              </button>
            </div>
          )}
        </div>
      )}

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
        </div>
      )}
    </div>
  );
}

