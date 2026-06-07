import { useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { SafeQRCode } from "../components/common/SafeQRCode";

export function TournamentAdminsPage() {
  const { tournament, admins, addAdmin, editAdminName, removeAdmin, isReadOnly } = useAppContext();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const sorted = useMemo(
    () => [...admins].sort((a, b) => a.admin_sequence - b.admin_sequence),
    [admins]
  );

  if (!tournament) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-500">
          大会が選択されていません。大会一覧から大会を選択してください。
        </div>
      </div>
    );
  }

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await addAdmin(trimmed);
      setName("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-800">管理者リスト</h2>
        <p className="text-sm text-gray-500 mt-1">
          大会: {tournament.name} / コード: <span className="font-mono">{tournament.tournament_code}</span>
        </p>
      </div>

      {!isReadOnly && (
        <div className="mb-4 bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">管理者を追加</p>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="管理者名"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={handleAdd}
              disabled={saving || !name.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? "追加中..." : "追加"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            管理者IDは参加者上限の次番号から割り当てられます。
          </p>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-500">
          管理者がまだ登録されていません。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((a) => {
            const qrData = JSON.stringify({
              entity_type: "admin",
              tournament_id: tournament.id,
              tournament_name: tournament.name,
              tournament_code: tournament.tournament_code,
              admin_id: a.admin_id,
              admin_id_4: a.admin_id_4,
              admin_name: a.name,
              admin_code: a.admin_code,
              attributes: a.attributes,
            });

            return (
              <article key={a.admin_id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-800">{a.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Admin #{a.admin_sequence}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 font-mono">
                    ID {a.admin_id_4}
                  </span>
                </div>

                <div className="mt-3">
                  <p className="text-xs text-gray-500">管理者コード</p>
                  <p className="font-mono text-sm text-gray-800 break-all">{a.admin_code || "(未発行)"}</p>
                </div>

                <div className="mt-3 p-3 bg-gray-50 rounded-lg flex items-center justify-center">
                  <SafeQRCode value={qrData} size={132} />
                </div>

                {!isReadOnly && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={async () => {
                        const nextName = prompt("管理者名を入力してください", a.name);
                        if (nextName === null) return;
                        const trimmed = nextName.trim();
                        if (!trimmed) {
                          alert("管理者名を入力してください");
                          return;
                        }
                        await editAdminName(a.admin_id, trimmed);
                      }}
                      className="text-xs px-3 py-1.5 rounded bg-sky-100 text-sky-700 hover:bg-sky-200"
                    >
                      名前を編集
                    </button>
                    <button
                      onClick={async () => {
                        if (sorted.length <= 1) {
                          alert("管理者が1名のみのため削除できません");
                          return;
                        }
                        if (confirm(`管理者「${a.name}」を削除しますか？`)) {
                          try {
                            await removeAdmin(a.admin_id);
                          } catch (err) {
                            alert(err instanceof Error ? err.message : "管理者の削除に失敗しました");
                          }
                        }
                      }}
                      disabled={sorted.length <= 1}
                      className="text-xs px-3 py-1.5 rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      削除
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
