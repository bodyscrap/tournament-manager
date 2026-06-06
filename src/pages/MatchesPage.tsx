import { useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";
import type { Match, TournamentPlayer } from "../lib/types";
import { buildIncomingBySlot, getUiMatchState, getUiMatchStateLabel } from "../lib/matchState";

export function MatchesPage() {
  const {
    tournament,
    participants,
    matches,
    isReadOnly,
    findActiveMatch,
    findMatchByTwoPlayers,
    startMatch,
    setMatchReady,
    swapMatchSides,
    randomizeMatchSides,
    recordScore,
  } = useAppContext();

  const [searchId1, setSearchId1] = useState("");
  const [searchId2, setSearchId2] = useState("");
  const [searchResult, setSearchResult] = useState<Match | null | "none">(null);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [p1Wins, setP1Wins] = useState(0);
  const [p2Wins, setP2Wins] = useState(0);
  const [p1Dq, setP1Dq] = useState(false);
  const [p2Dq, setP2Dq] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!selectedMatch) return;
    const latest = matches.find((m) => m.id === selectedMatch.id);
    if (latest) setSelectedMatch(latest);
  }, [matches, selectedMatch]);

  const playerMap = new Map<string, TournamentPlayer>(participants.map((p) => [p.player_id, p]));
  const incomingBySlot = buildIncomingBySlot(matches);

  const getPlayerName = (id: string | null, hasIncomingFeeder = false) => {
    if (!id) return hasIncomingFeeder ? "TBD" : "BYE";
    return playerMap.get(id)?.name ?? id.slice(0, 8) + "…";
  };

  const handleSearch = async () => {
    if (!tournament) return;
    setSearching(true);
    setSearchResult(null);
    try {
      let match: Match | null = null;
      if (searchId2.trim()) {
        match = await findMatchByTwoPlayers(searchId1.trim(), searchId2.trim());
      } else {
        match = await findActiveMatch(searchId1.trim());
      }
      setSearchResult(match ?? "none");
    } finally {
      setSearching(false);
    }
  };

  const openMatch = (match: Match) => {
    setSelectedMatch(match);
    setP1Wins(match.player1_wins);
    setP2Wins(match.player2_wins);
    setP1Dq(match.dq_player_id === match.player1_id);
    setP2Dq(match.dq_player_id === match.player2_id);
  };

  const handleSave = async () => {
    if (!selectedMatch || !tournament) return;
    const uiState = getUiMatchState(selectedMatch, incomingBySlot);
    if (uiState === "undecided") {
      alert("このカードは未決定です。TBDが解消されてから試合開始してください。");
      return;
    }

    setSaving(true);
    try {
      if (selectedMatch.status === "pending" && uiState === "ready") {
        await startMatch(selectedMatch.id);
      }
      const dqPlayerIds = [
        p1Dq ? selectedMatch.player1_id : null,
        p2Dq ? selectedMatch.player2_id : null,
      ].filter((id): id is string => !!id);
      await recordScore(selectedMatch, p1Wins, p2Wins, dqPlayerIds);
      setSelectedMatch(null);
      setSearchResult(null);
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
      setP1Dq(false);
      setP2Dq(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSwapSides = async () => {
    if (!selectedMatch || isReadOnly) return;
    setSaving(true);
    try {
      await swapMatchSides(selectedMatch.id);
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

  const handleRandomSides = async () => {
    if (!selectedMatch || isReadOnly) return;
    setSaving(true);
    try {
      await randomizeMatchSides(selectedMatch.id);
    } finally {
      setSaving(false);
    }
  };

  const MatchDisplay = ({ match }: { match: Match }) => (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      {(() => {
        const uiState = getUiMatchState(match, incomingBySlot);
        const incoming = incomingBySlot.get(match.id) ?? { slot1: false, slot2: false };
        return (
          <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase">
          {match.bracket === "winners"
            ? "ウィナーズ"
            : match.bracket === "losers"
            ? "ルーザーズ"
            : match.bracket === "grand_final"
            ? "グランドファイナル"
            : "GF リセット"}{" "}
          Round {match.round}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            uiState === "in_progress"
              ? "bg-yellow-100 text-yellow-700"
              : uiState === "completed"
              ? "bg-green-100 text-green-700"
              : uiState === "ready"
              ? "bg-blue-100 text-blue-700"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {getUiMatchStateLabel(uiState)}
        </span>
      </div>
      <div className="text-sm">
        <div
          className={`py-1 px-2 rounded ${
            match.winner_id === match.player1_id && match.winner_id !== null
              ? "bg-green-50 font-bold text-green-800"
              : "text-gray-700"
          }`}
        >
          <span className="inline-flex items-center px-1.5 py-0.5 mr-1 rounded bg-blue-50 text-blue-700 text-[10px] font-semibold">
            {match.player1_side}
          </span>
          {getPlayerName(match.player1_id, incoming.slot1)}
          {match.player1_character_name && (
            <span className="ml-1 text-[10px] text-gray-500">[{match.player1_character_name}]</span>
          )}
          {match.status !== "pending" && (
            <span className="ml-2 font-mono text-gray-400">{match.player1_wins}W</span>
          )}
          {match.dq_player_id === match.player1_id && (
            <span className="ml-1 text-red-500 text-xs">DQ</span>
          )}
        </div>
        <div className="text-center text-gray-300 text-xs my-0.5">vs</div>
        <div
          className={`py-1 px-2 rounded ${
            match.winner_id === match.player2_id && match.winner_id !== null
              ? "bg-green-50 font-bold text-green-800"
              : "text-gray-700"
          }`}
        >
          <span className="inline-flex items-center px-1.5 py-0.5 mr-1 rounded bg-indigo-50 text-indigo-700 text-[10px] font-semibold">
            {match.player2_side}
          </span>
          {getPlayerName(match.player2_id, incoming.slot2)}
          {match.player2_character_name && (
            <span className="ml-1 text-[10px] text-gray-500">[{match.player2_character_name}]</span>
          )}
          {match.status !== "pending" && (
            <span className="ml-2 font-mono text-gray-400">{match.player2_wins}W</span>
          )}
          {match.dq_player_id === match.player2_id && (
            <span className="ml-1 text-red-500 text-xs">DQ</span>
          )}
        </div>
      </div>
      {uiState !== "undecided" && match.status !== "completed" && !isReadOnly && (
        <button
          onClick={() => openMatch(match)}
          className="mt-3 w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium"
        >
          結果を入力
        </button>
      )}
          </>
        );
      })()}
    </div>
  );

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">試合管理</h2>

      {!tournament && (
        <p className="text-gray-400">大会が選択されていません。</p>
      )}

      {tournament && (
        <>
          {isReadOnly && (
            <div className="mb-4 px-4 py-3 bg-gray-100 border border-gray-300 rounded-xl flex items-center gap-2 text-sm text-gray-600">
              <span>🔒</span>
              <span>結果確定済み — 試合結果の入力はできません</span>
            </div>
          )}

          {/* Search */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
            <h3 className="font-semibold text-gray-700 mb-3">試合を検索</h3>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  プレイヤーID (1名 → アクティブな試合 / 2名 → 最新対戦)
                </label>
                <input
                  value={searchId1}
                  onChange={(e) => setSearchId1(e.target.value)}
                  placeholder="プレイヤーID 1"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
              <div>
                <input
                  value={searchId2}
                  onChange={(e) => setSearchId2(e.target.value)}
                  placeholder="プレイヤーID 2 (省略可)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching || !searchId1.trim()}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {searching ? "検索中..." : "🔍 検索"}
              </button>
            </div>

            {searchResult === "none" && (
              <p className="text-gray-400 text-sm text-center mt-3">
                該当する試合が見つかりませんでした
              </p>
            )}
            {searchResult && searchResult !== "none" && (
              <div className="mt-4">
                <MatchDisplay match={searchResult} />
              </div>
            )}
          </div>

          {/* Player directory for ID lookup */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-700 mb-3">参加者一覧</h3>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {participants.map((p) => (
                <div
                  key={p.player_id}
                  className="flex items-center gap-2 text-sm py-1"
                >
                  <button
                    onClick={() => setSearchId1(p.player_id)}
                    className="text-blue-500 hover:text-blue-700 font-mono text-xs"
                    title="ID1にセット"
                  >
                    →1
                  </button>
                  <button
                    onClick={() => setSearchId2(p.player_id)}
                    className="text-green-500 hover:text-green-700 font-mono text-xs"
                    title="ID2にセット"
                  >
                    →2
                  </button>
                  <span className="font-medium text-gray-800">{p.name}</span>
                  {p.character_name && (
                    <span className="text-xs text-gray-400">{p.character_name}</span>
                  )}
                  <span className="font-mono text-xs text-gray-300 ml-auto">
                    {p.player_id.slice(0, 12)}…
                  </span>
                  {p.dq && (
                    <span className="text-xs bg-red-100 text-red-600 px-1 rounded">DQ</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Result input modal */}
      {selectedMatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-800 mb-4 text-center">結果入力</h3>

            {!isReadOnly && selectedMatch.status !== "completed" && (
              <div className="mb-3">
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={handleSwapSides}
                    disabled={saving}
                    className="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    1P/2Pを入れ替え
                  </button>
                  <button
                    onClick={handleRandomSides}
                    disabled={saving}
                    className="px-3 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    サイドをランダム
                  </button>
                </div>
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

            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-28 text-sm font-medium text-gray-700 truncate">
                  {selectedMatch.player1_side} {getPlayerName(selectedMatch.player1_id)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setP1Wins(Math.max(0, p1Wins - 1))}
                    className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-lg leading-none"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-mono font-bold">{p1Wins}</span>
                  <button
                    onClick={() => setP1Wins(p1Wins + 1)}
                    className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-lg leading-none"
                  >
                    ＋
                  </button>
                </div>
                <button
                  onClick={() => setP1Dq((v) => !v)}
                  className={`text-xs px-2 py-1 rounded ml-auto ${
                    p1Dq
                      ? "bg-red-500 text-white"
                      : "bg-red-100 text-red-600 hover:bg-red-200"
                  }`}
                >
                  DQ
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-28 text-sm font-medium text-gray-700 truncate">
                  {selectedMatch.player2_side} {getPlayerName(selectedMatch.player2_id)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setP2Wins(Math.max(0, p2Wins - 1))}
                    className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-lg leading-none"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-mono font-bold">{p2Wins}</span>
                  <button
                    onClick={() => setP2Wins(p2Wins + 1)}
                    className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-lg leading-none"
                  >
                    ＋
                  </button>
                </div>
                <button
                  onClick={() => setP2Dq((v) => !v)}
                  className={`text-xs px-2 py-1 rounded ml-auto ${
                    p2Dq
                      ? "bg-red-500 text-white"
                      : "bg-red-100 text-red-600 hover:bg-red-200"
                  }`}
                >
                  DQ
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              {!isReadOnly && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {saving ? "保存中..." : "結果を確定"}
                </button>
              )}
              <button
                onClick={() => setSelectedMatch(null)}
                className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
