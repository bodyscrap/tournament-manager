import { useState } from "react";
import type { Player } from "../../lib/types";

interface Props {
  initial?: Player;
  onSave: (
    name: string,
    character_name: string | null,
    attributes: Record<string, string>
  ) => Promise<void>;
  onCancel: () => void;
}

export function PlayerForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [charName, setCharName] = useState(initial?.character_name ?? "");
  const [attrKey, setAttrKey] = useState("");
  const [attrVal, setAttrVal] = useState("");
  const [attributes, setAttributes] = useState<Record<string, string>>(
    initial?.attributes ?? {}
  );
  const [saving, setSaving] = useState(false);

  const addAttr = () => {
    if (!attrKey.trim()) return;
    setAttributes((prev) => ({ ...prev, [attrKey.trim()]: attrVal.trim() }));
    setAttrKey("");
    setAttrVal("");
  };

  const removeAttr = (key: string) => {
    setAttributes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), charName.trim() || null, attributes);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          プレイヤー名 <span className="text-red-500">*</span>
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="例: 田中太郎"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          使用キャラクター
        </label>
        <input
          value={charName}
          onChange={(e) => setCharName(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="例: リュウ"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          追加属性
        </label>
        <div className="flex gap-2 mb-2">
          <input
            value={attrKey}
            onChange={(e) => setAttrKey(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="キー (例: チーム)"
          />
          <input
            value={attrVal}
            onChange={(e) => setAttrVal(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="値 (例: 東京)"
          />
          <button
            type="button"
            onClick={addAttr}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
          >
            追加
          </button>
        </div>
        {Object.entries(attributes).map(([k, v]) => (
          <div
            key={k}
            className="flex items-center gap-2 text-sm bg-gray-50 px-2 py-1 rounded mb-1"
          >
            <span className="font-medium">{k}:</span>
            <span className="flex-1">{v}</span>
            <button
              type="button"
              onClick={() => removeAttr(k)}
              className="text-red-500 hover:text-red-700 text-xs"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50"
        >
          {saving ? "保存中..." : initial ? "更新" : "追加"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
