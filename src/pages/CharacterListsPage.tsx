import { useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import type { CharacterList } from "../lib/types";
import { buildDuplicateName, parseLinesToUniqueList } from "../lib/characterListUtils";

function toLinesText(values: string[]): string {
  return values.join("\n");
}

export function CharacterListsPage() {
  const {
    characterLists,
    addCharacterList,
    editCharacterList,
    removeCharacterList,
  } = useAppContext();

  const [editing, setEditing] = useState<CharacterList | null>(null);
  const [name, setName] = useState("");
  const [listText, setListText] = useState("");
  const [saving, setSaving] = useState(false);

  const sortedLists = useMemo(
    () => [...characterLists].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [characterLists]
  );

  const resetForm = () => {
    setEditing(null);
    setName("");
    setListText("");
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const items = parseLinesToUniqueList(listText);
    setSaving(true);
    try {
      if (editing) {
        await editCharacterList(editing.id, trimmedName, items);
      } else {
        await addCharacterList(trimmedName, items);
      }
      resetForm();
    } catch {
      alert("保存に失敗しました。リスト名の重複がないか確認してください。");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (list: CharacterList) => {
    setEditing(list);
    setName(list.name);
    setListText(toLinesText(list.characters));
  };

  const duplicateList = async (list: CharacterList) => {
    const duplicateName = buildDuplicateName(
      `${list.name} コピー`,
      characterLists.map((v) => v.name),
      ""
    );
    setSaving(true);
    try {
      await addCharacterList(duplicateName, list.characters);
    } catch {
      alert("複製に失敗しました。時間をおいて再試行してください。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">使用キャラクターリスト</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-4">
            {editing ? "リストを編集" : "新規リスト作成"}
          </h3>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">リスト名</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: S4公式 / 店舗大会ローカルルール"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">キャラクター一覧</label>
              <textarea
                value={listText}
                onChange={(e) => setListText(e.target.value)}
                rows={10}
                placeholder="1行に1キャラクター名"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">重複や空行は保存時に自動で整理されます。</p>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {saving ? "保存中..." : editing ? "更新" : "作成"}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
              >
                クリア
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-4">登録済みリスト ({sortedLists.length})</h3>

          {sortedLists.length === 0 ? (
            <p className="text-sm text-gray-400">まだリストがありません。</p>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {sortedLists.map((list) => (
                <div key={list.id} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-800">{list.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{list.characters.length} キャラクター</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => duplicateList(list)}
                        disabled={saving}
                        className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded disabled:opacity-50"
                      >
                        複製
                      </button>
                      <button
                        onClick={() => startEdit(list)}
                        className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
                      >
                        編集
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`「${list.name}」を削除しますか？`)) return;
                          await removeCharacterList(list.id);
                          if (editing?.id === list.id) resetForm();
                        }}
                        className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                  {list.characters.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {list.characters.slice(0, 10).map((name) => (
                        <span key={name} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                          {name}
                        </span>
                      ))}
                      {list.characters.length > 10 && (
                        <span className="text-xs text-gray-400">+{list.characters.length - 10}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
