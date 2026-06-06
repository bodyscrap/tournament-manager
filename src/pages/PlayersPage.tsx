import { useState } from "react";
import { useAppContext } from "../context/AppContext";
import { PlayerForm } from "../components/players/PlayerForm";
import { PlayerQRCode } from "../components/players/PlayerQRCode";
import type { Player } from "../lib/types";

export function PlayersPage() {
  const { players, characters, addCharacter, removeCharacter, addPlayer, editPlayer, dqPlayer, removePlayer } =
    useAppContext();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Player | null>(null);
  const [search, setSearch] = useState("");
  const [newCharacter, setNewCharacter] = useState("");

  const filtered = players.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.character_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      p.id.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async (
    name: string,
    character_name: string | null,
    attributes: Record<string, string>
  ) => {
    if (editTarget) {
      await editPlayer(editTarget.id, name, character_name, attributes);
      setEditTarget(null);
    } else {
      await addPlayer(name, character_name, attributes);
      setShowForm(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">プレイヤー管理</h2>
        <button
          onClick={() => { setShowForm(true); setEditTarget(null); }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          ＋ プレイヤー追加
        </button>
      </div>

      {(showForm || editTarget) && (
        <div className="bg-white rounded-xl shadow p-5 mb-6 border border-gray-200">
          <h3 className="text-base font-semibold text-gray-700 mb-4">
            {editTarget ? "プレイヤー編集" : "新規プレイヤー"}
          </h3>
          <PlayerForm
            initial={editTarget ?? undefined}
            characterOptions={characters.map((c) => c.name)}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditTarget(null); }}
          />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <h3 className="text-base font-semibold text-gray-700 mb-3">キャラマスター</h3>
        <div className="flex gap-2 mb-3">
          <input
            value={newCharacter}
            onChange={(e) => setNewCharacter(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key !== "Enter" || !newCharacter.trim()) return;
              try {
                await addCharacter(newCharacter.trim());
                setNewCharacter("");
              } catch {
                alert("キャラ追加に失敗しました。重複名の可能性があります。");
              }
            }}
            placeholder="キャラクター名を追加"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={async () => {
              if (!newCharacter.trim()) return;
              try {
                await addCharacter(newCharacter.trim());
                setNewCharacter("");
              } catch {
                alert("キャラ追加に失敗しました。重複名の可能性があります。");
              }
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
          >
            追加
          </button>
        </div>
        {characters.length === 0 ? (
          <p className="text-xs text-gray-400">キャラが未登録です</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {characters.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
                {c.name}
                <button
                  onClick={() => {
                    if (confirm(`「${c.name}」を削除しますか？`)) removeCharacter(c.id);
                  }}
                  className="text-red-500 hover:text-red-700"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="名前・キャラ・IDで検索..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-8">
            プレイヤーがいません
          </p>
        )}
        {filtered.map((player) => (
          <div
            key={player.id}
            className={`bg-white rounded-xl shadow-sm border p-4 ${
              player.dq ? "border-red-300 bg-red-50" : "border-gray-200"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-800">{player.name}</span>
                  {player.dq && (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                      DQ
                    </span>
                  )}
                  {player.character_name && (
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {player.character_name}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{player.id}</p>
                {Object.entries(player.attributes).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(player.attributes).map(([k, v]) => (
                      <span
                        key={k}
                        className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded"
                      >
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => { setEditTarget(player); setShowForm(false); }}
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
                >
                  編集
                </button>
                <button
                  onClick={() => dqPlayer(player.id, !player.dq)}
                  className={`text-xs px-2 py-1 rounded ${
                    player.dq
                      ? "bg-green-100 hover:bg-green-200 text-green-700"
                      : "bg-orange-100 hover:bg-orange-200 text-orange-700"
                  }`}
                >
                  {player.dq ? "DQ解除" : "DQ"}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`${player.name} を削除しますか？`)) removePlayer(player.id);
                  }}
                  className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded"
                >
                  削除
                </button>
              </div>
            </div>
            <div className="mt-2">
              <PlayerQRCode player={player} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-xs text-gray-400">
        合計: {players.length} 名
      </div>
    </div>
  );
}
